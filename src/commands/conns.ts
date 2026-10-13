import { isIP } from 'node:net';

import { Command, Option } from 'commander';

import { parsePort, parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { type Connection, isEstablished, isListening, listConnections } from '../core/conns/list';
import { listPrograms } from '../core/conns/programs';
import { createDnsTools } from '../core/lookup/dns';
import { isReservedAddress } from '../core/lookup/reserved';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';
import { truncateDisplay } from '../ui/width';

/** 이름을 한 번에 너무 많이 조회하지 않도록 제한합니다. */
const RESOLVE_CONCURRENCY = 16;
const NAME_WIDTH = 32;

interface ConnsOptions {
  readonly listen?: boolean;
  readonly established?: boolean;
  readonly port?: number;
  readonly tcp?: boolean;
  readonly udp?: boolean;
  readonly names?: boolean;
  readonly resolve?: boolean;
  readonly timeout: number;
}

/** 테스트에서 실제 시스템 대신 가짜를 넣을 수 있도록 모아 둡니다. */
export interface ConnsServices {
  readonly list: typeof listConnections;
  readonly programs: typeof listPrograms;
  readonly reverse: (
    timeoutMs: number,
    signal: AbortSignal,
    onFallback: (message: string) => void,
  ) => (address: string) => Promise<string | undefined>;
}

const defaultServices: ConnsServices = {
  list: listConnections,
  programs: listPrograms,
  reverse: createReverseLookup,
};

export function createConnsCommand(
  runtime: Runtime,
  services: ConnsServices = defaultServices,
): Command {
  return new Command('conns')
    .description('show listening ports and active connections')
    .addOption(
      new Option('-l, --listen', 'show only the listening sockets').conflicts('established'),
    )
    .option('-e, --established', 'show only the sockets with a live connection')
    .addOption(
      new Option('-p, --port <port>', 'show only sockets using this port').argParser(parsePort),
    )
    .addOption(new Option('--tcp', 'show only TCP sockets').conflicts('udp'))
    .option('--udp', 'show only UDP sockets')
    .option('--names', 'look up the name of the program owning each socket')
    .option('--resolve', 'look up the host names of the remote addresses')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each system command')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .action(async (options: ConnsOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const system = {
        platform: runtime.platform,
        env: runtime.env,
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onCommand: (line: string) => {
          output.debug(`running ${line}`);
        },
      };

      const all = await services.list(system);
      const shown = all.filter((connection) => matches(connection, options));

      const programs =
        options.names === true ? await services.programs(system) : new Map<number, string>();
      const names =
        options.resolve === true
          ? await resolveRemotes(shown, options, runtime, services, output)
          : new Map<string, string>();

      const rows = shown.map((connection) => toRow(connection, programs, names));
      const listening = shown.filter(isListening).length;

      output.result(
        {
          total: all.length,
          shown: shown.length,
          listening,
          connections: rows.map((row) => ({
            protocol: row.protocol,
            local: row.local,
            remote: row.remote ?? null,
            remoteName: row.remoteName ?? null,
            state: row.state ?? null,
            pid: row.pid ?? null,
            program: row.program ?? null,
          })),
        },
        () => {
          if (rows.length === 0) {
            output.hint('No socket matches.');
          } else {
            output.table(rows, columns(output, options));
          }
          output.summary(
            `${plural(listening, 'listening port')}, ${plural(shown.length - listening, 'connection')}`,
          );
        },
      );
      runtime.exitCode = 0;
    });
}

function matches(connection: Connection, options: ConnsOptions): boolean {
  if (options.listen === true && !isListening(connection)) {
    return false;
  }
  if (options.established === true && !isEstablished(connection)) {
    return false;
  }
  if (options.tcp === true && connection.protocol !== 'tcp') {
    return false;
  }
  if (options.udp === true && connection.protocol !== 'udp') {
    return false;
  }
  // 포트는 내 쪽과 상대 쪽 어디에 있어도 맞는 것으로 봅니다.
  return (
    options.port === undefined ||
    connection.local.port === options.port ||
    connection.remote?.port === options.port
  );
}

interface Row {
  readonly protocol: string;
  readonly local: string;
  readonly remote?: string;
  readonly remoteName?: string;
  readonly state?: string;
  readonly pid?: number;
  readonly program?: string;
}

function toRow(
  connection: Connection,
  programs: ReadonlyMap<number, string>,
  names: ReadonlyMap<string, string>,
): Row {
  const program = connection.pid === undefined ? undefined : programs.get(connection.pid);
  const remoteName =
    connection.remote === undefined ? undefined : names.get(connection.remote.address);
  return {
    protocol: connection.protocol,
    local: format(connection.local),
    ...(connection.remote === undefined ? {} : { remote: format(connection.remote) }),
    ...(remoteName === undefined ? {} : { remoteName }),
    ...(connection.state === undefined ? {} : { state: connection.state }),
    ...(connection.pid === undefined ? {} : { pid: connection.pid }),
    ...(program === undefined ? {} : { program }),
  };
}

/** IPv6 주소는 포트와 구분되게 대괄호로 감쌉니다. */
function format(endpoint: { address: string; port: number }): string {
  const address = endpoint.address.includes(':') ? `[${endpoint.address}]` : endpoint.address;
  return `${address}:${endpoint.port}`;
}

/** 상대 주소의 이름을 조회합니다. 같은 주소는 한 번만 묻습니다. */
async function resolveRemotes(
  connections: readonly Connection[],
  options: ConnsOptions,
  runtime: Runtime,
  services: ConnsServices,
  output: Output,
): Promise<Map<string, string>> {
  const addresses = [
    ...new Set(
      connections
        .map((connection) => connection.remote?.address)
        .filter((address): address is string => address !== undefined && !isWildcard(address)),
    ),
  ];
  const names = new Map<string, string>();
  const lookup = services.reverse(options.timeout, runtime.signal, (message) => {
    output.hint(message);
  });
  let next = 0;
  const work = async () => {
    while (!runtime.signal.aborted) {
      const address = addresses[next++];
      if (address === undefined) {
        return;
      }
      const name = await lookup(address);
      if (name !== undefined) {
        names.set(address, name);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, addresses.length) }, work));
  return names;
}

function isWildcard(address: string): boolean {
  return address === '0.0.0.0' || address === '::' || address === '*';
}

/**
 * 역방향 DNS로 이름을 찾는 함수를 만듭니다.
 * 시스템 DNS에 닿지 못하는 환경(일부 VPN)에서는 ip 명령과 같은 DNS-over-HTTPS 경로로 넘어갑니다.
 */
function createReverseLookup(
  timeoutMs: number,
  signal: AbortSignal,
  onFallback: (message: string) => void,
): (address: string) => Promise<string | undefined> {
  const dns = createDnsTools(timeoutMs, signal, onFallback);
  return async (address) => {
    const family = isIP(address) === 6 ? 6 : 4;
    try {
      const [name] = await dns.reverse(address, isReservedAddress(address, family));
      return name === '' ? undefined : name;
    } catch {
      return undefined;
    }
  };
}

function stateColor(output: Output, state: string | undefined): string {
  if (state === undefined) {
    return output.colors.dim('-');
  }
  const upper = state.toUpperCase();
  if (upper === 'LISTENING' || upper === 'LISTEN') {
    return output.colors.cyan(state);
  }
  return upper === 'ESTABLISHED' ? output.colors.green(state) : output.colors.dim(state);
}

function columns(output: Output, options: ConnsOptions): Column<Row>[] {
  const list: Column<Row>[] = [
    { header: 'PROTO', value: (row) => row.protocol },
    { header: 'LOCAL', value: (row) => row.local },
    {
      header: 'REMOTE',
      value: (row) =>
        row.remoteName === undefined
          ? (row.remote ?? output.colors.dim('-'))
          : `${row.remote ?? ''} ${output.colors.dim(`(${truncateDisplay(row.remoteName, NAME_WIDTH, output.unicode ? '…' : '...')})`)}`,
    },
    { header: 'STATE', value: (row) => stateColor(output, row.state) },
    {
      header: 'PID',
      value: (row) => (row.pid === undefined ? '' : String(row.pid)),
      align: 'right',
    },
  ];
  if (options.names === true) {
    list.push({ header: 'PROGRAM', value: (row) => row.program ?? '' });
  }
  return list;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
