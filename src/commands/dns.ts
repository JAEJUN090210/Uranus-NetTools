import { isIP } from 'node:net';

import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parseIpAddress, parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { query } from '../core/dns/client';
import {
  chooseServer,
  DEFAULT_TYPES,
  type LookupReport,
  lookupTypes,
  PUBLIC_RESOLVERS,
  type Resolution,
  type TypeResult,
} from '../core/dns/lookup';
import { traceDelegation, type TraceStep } from '../core/dns/trace';
import { isRecordType, RECORD_TYPES, recordType, type ResourceRecord } from '../core/dns/wire';
import { DOH_SERVERS } from '../core/lookup/dns';
import { ptrQueryName } from '../core/lookup/reverse-name';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';

interface DnsOptions {
  readonly type?: readonly string[];
  readonly server?: string;
  readonly compare?: boolean;
  readonly trace?: boolean;
  readonly timeout: number;
}

/** 테스트에서 실제 네트워크 대신 가짜를 넣을 수 있도록 조회 수단을 한데 모았습니다. */
export interface DnsServices {
  readonly chooseServer: typeof chooseServer;
  readonly lookupTypes: typeof lookupTypes;
  readonly trace: typeof traceDelegation;
  readonly resolvers: readonly { readonly name: string; readonly address: string }[];
  readonly fetch?: typeof fetch;
}

const defaultServices: DnsServices = {
  chooseServer,
  lookupTypes,
  trace: traceDelegation,
  resolvers: PUBLIC_RESOLVERS,
};

export function createDnsCommand(
  runtime: Runtime,
  services: DnsServices = defaultServices,
): Command {
  return new Command('dns')
    .description('look up the DNS records of a domain')
    .argument('<name>', 'domain name, or an IP address for a reverse lookup')
    .addOption(
      new Option('-t, --type <types...>', 'record types to ask for (default: the main records)')
        .argParser(collectTypes)
        .conflicts('trace'),
    )
    .addOption(
      new Option('-s, --server <address>', 'DNS server to ask instead of the system one').argParser(
        parseIpAddress,
      ),
    )
    .addOption(
      new Option('--compare', 'compare the answers of the system and public DNS servers').conflicts(
        'trace',
      ),
    )
    .option('--trace', 'follow the delegation from the root servers down')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each query')
        .argParser(parsePositiveInteger)
        .default(3000),
    )
    .action(async (input: string, options: DnsOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = parseTarget(input);
      const types = chooseTypes(target, options);

      if (options.trace === true) {
        await runTrace(target, types, options, runtime, output, services);
        return;
      }
      if (options.compare === true) {
        await runCompare(target, types, options, runtime, output, services);
        return;
      }
      await runLookup(target, types, options, runtime, output, services);
    });
}

interface Target {
  /** 질의에 쓰는 이름입니다. IP를 주면 in-addr.arpa 이름으로 바뀝니다. */
  readonly queryName: string;
  /** 사용자가 입력한 것입니다. */
  readonly input: string;
  readonly reverse: boolean;
}

function parseTarget(input: string): Target {
  const literal = isIP(input);
  if (literal === 4 || literal === 6) {
    return { queryName: ptrQueryName(input, literal), input, reverse: true };
  }
  const name = input.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
  if (name === '' || /\s/.test(name)) {
    throw new UserError(`${input} is not a domain name or IP address`);
  }
  return { queryName: name, input: name, reverse: false };
}

function collectTypes(value: string, previous: string[] = []): string[] {
  const name = value.toUpperCase();
  if (!isRecordType(name)) {
    const known = Object.keys(RECORD_TYPES).join(', ');
    throw new UserError(`${value} is not a record type I know (try one of ${known})`);
  }
  return [...previous, name];
}

function chooseTypes(target: Target, options: DnsOptions): readonly string[] {
  if (options.type !== undefined && options.type.length > 0) {
    return options.type;
  }
  // IP를 주면 역방향 조회이므로 PTR만 봅니다.
  return target.reverse ? ['PTR'] : DEFAULT_TYPES;
}

/** 시스템 DNS(또는 --server)에 묻고, 닿지 못하면 DNS-over-HTTPS로 대체합니다. */
function resolutionFor(
  options: DnsOptions,
  runtime: Runtime,
  output: Output,
  services: DnsServices,
  server?: string,
): Resolution {
  const settings = { timeoutMs: options.timeout, signal: runtime.signal };
  if (server !== undefined) {
    return { server, settings };
  }
  const chosen = services.chooseServer(options.server, (message) => {
    output.hint(message);
  });
  if (chosen.server !== undefined) {
    return { server: chosen.server, settings };
  }
  const [doh] = DOH_SERVERS;
  if (doh === undefined) {
    throw new UserError('no DNS server to ask');
  }
  return {
    server: doh.name,
    settings,
    doh: {
      name: doh.name,
      url: `https://${doh.name}/resolve`,
      http: {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        accept: 'application/dns-json',
        ...(services.fetch === undefined ? {} : { fetch: services.fetch }),
      },
    },
  };
}

async function runLookup(
  target: Target,
  types: readonly string[],
  options: DnsOptions,
  runtime: Runtime,
  output: Output,
  services: DnsServices,
): Promise<void> {
  const resolution = resolutionFor(options, runtime, output, services, options.server);
  output.hint(`Asking ${resolution.doh?.name ?? resolution.server} about ${target.input}...`);
  const report = await services.lookupTypes(target.queryName, types, resolution);

  const found = report.results.flatMap((result) => result.records);
  output.result(toJson(target, report), () => {
    if (found.length > 0) {
      output.table(found, recordColumns(output));
    }
    printProblems(output, report.results);
    if (found.length === 0) {
      output.summary(`no records for ${target.input}`);
    } else {
      output.summary(
        `${plural(found.length, 'record')} from ${report.server} in ${formatMs(slowest(report.results))}`,
      );
    }
  });
  runtime.exitCode = found.length > 0 ? 0 : 1;
}

async function runCompare(
  target: Target,
  types: readonly string[],
  options: DnsOptions,
  runtime: Runtime,
  output: Output,
  services: DnsServices,
): Promise<void> {
  const system = services.chooseServer(options.server);
  const servers = [
    ...(system.server === undefined ? [] : [{ name: 'system', address: system.server }]),
    ...services.resolvers,
  ];
  if (servers.length === 0) {
    throw new UserError('no DNS servers to compare');
  }
  output.hint(`Asking ${plural(servers.length, 'server')} about ${target.input}...`);

  const reports = await Promise.all(
    servers.map(async (server) => ({
      server,
      report: await services.lookupTypes(
        target.queryName,
        types,
        resolutionFor(options, runtime, output, services, server.address),
      ),
    })),
  );

  const rows = reports.map(({ server, report }) => {
    const records = report.results.flatMap((result) => result.records);
    return {
      name: server.name,
      address: server.address,
      // 서버마다 순서가 달라도 같은 답인지 보려면 정렬해서 비교해야 합니다.
      answer: [...new Set(records.map((record) => `${record.typeName} ${record.data}`))].sort(),
      elapsed: slowest(report.results),
      failed: report.results.filter((result) => result.error !== undefined).length,
    };
  });
  // 답하지 못한 서버는 "다른 답"이 아니라 못 물어본 것이므로 비교에서 빼고 따로 알려 줍니다.
  const answered = rows.filter((row) => row.answer.length > 0);
  const silent = rows.filter((row) => row.answer.length === 0);
  const fingerprints = new Set(answered.map((row) => row.answer.join('\n')));
  const agree = fingerprints.size <= 1;

  output.result(
    {
      name: target.input,
      types,
      agree: fingerprints.size === 1,
      servers: rows.map((row) => ({
        name: row.name,
        address: row.address,
        records: row.answer,
        answered: row.answer.length > 0,
        elapsed: row.answer.length > 0 ? Math.round(row.elapsed) : null,
      })),
    },
    () => {
      output.table(rows, compareColumns(output));
      for (const row of silent) {
        output.warn(`${row.name} (${row.address}) did not answer`);
      }
      if (answered.length < 2) {
        output.summary(
          answered.length === 0
            ? 'no server answered'
            : `only ${answered[0]?.name ?? 'one server'} answered, nothing to compare`,
        );
        return;
      }
      output.summary(
        agree
          ? `all ${answered.length} servers that answered agree`
          : `the servers do not agree (${fingerprints.size} different answers)`,
      );
    },
  );
  runtime.exitCode = agree && answered.length > 0 ? 0 : 1;
}

async function runTrace(
  target: Target,
  types: readonly string[],
  options: DnsOptions,
  runtime: Runtime,
  output: Output,
  services: DnsServices,
): Promise<void> {
  const [first = 'A'] = types;
  const type = recordType(first);
  output.hint(`Tracing the delegation of ${target.input} from the root servers...`);

  const settings = { timeoutMs: options.timeout, signal: runtime.signal };
  const steps = await services.trace(target.queryName, type, {
    ...settings,
    onStep: (step) => {
      if (!output.json) {
        output.line(formatStep(step, output));
      }
    },
    // 위임이 글루 레코드 없이 다른 영역의 이름을 쓰면 그 이름을 따로 조회합니다.
    resolveNameserver: async (name) => {
      const resolution = resolutionFor(options, runtime, output, services);
      if (resolution.doh !== undefined) {
        return undefined;
      }
      try {
        const { message } = await query(resolution.server, name, RECORD_TYPES.A, settings);
        return message.answers.find((record) => record.type === RECORD_TYPES.A)?.data;
      } catch {
        return undefined;
      }
    },
  });

  const last = steps.at(-1);
  const answers = last?.answers ?? [];
  output.result(
    {
      name: target.input,
      type: first,
      steps: steps.map((step) => ({
        server: step.server,
        serverName: step.serverName ?? null,
        zone: step.zone,
        elapsed: Math.round(step.elapsed),
        nameservers: step.nameservers,
        answers: (step.answers ?? []).map(toRecordJson),
      })),
    },
    () => {
      if (answers.length > 0) {
        output.line('');
        output.table(answers, recordColumns(output));
      }
      output.summary(
        answers.length > 0
          ? `answered by ${last?.serverName ?? last?.server ?? 'the last server'} after ${plural(steps.length, 'step')}`
          : `no answer after ${plural(steps.length, 'step')}`,
      );
    },
  );
  runtime.exitCode = answers.length > 0 ? 0 : 1;
}

function formatStep(step: TraceStep, output: Output): string {
  const from = output.colors.dim(`${step.serverName ?? step.server} (${formatMs(step.elapsed)})`);
  if (step.answers !== undefined) {
    return `${output.colors.green(step.zone)}  answer from ${from}`;
  }
  const names = step.nameservers.slice(0, 3).join(', ');
  const more = step.nameservers.length > 3 ? ` +${step.nameservers.length - 3} more` : '';
  return `${output.colors.cyan(step.zone)}  ${plural(step.nameservers.length, 'name server')}: ${names}${more}  ${from}`;
}

function printProblems(output: Output, results: readonly TypeResult[]): void {
  for (const result of results) {
    if (result.error !== undefined) {
      output.warn(`${result.type}: ${result.error}`);
    } else if (result.status !== undefined && result.status !== 'NXDOMAIN') {
      output.warn(`${result.type}: the server answered ${result.status}`);
    }
  }
}

function toJson(target: Target, report: LookupReport) {
  return {
    name: target.input,
    query: target.queryName,
    server: report.server,
    transport: report.transport,
    types: report.results.map((result) => ({
      type: result.type,
      status: result.status ?? 'NOERROR',
      elapsed: result.elapsed === undefined ? null : Math.round(result.elapsed),
      error: result.error ?? null,
      records: result.records.map(toRecordJson),
    })),
  };
}

function toRecordJson(record: ResourceRecord) {
  return { name: record.name, type: record.typeName, ttl: record.ttl, data: record.data };
}

function slowest(results: readonly TypeResult[]): number {
  return Math.max(0, ...results.map((result) => result.elapsed ?? 0));
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

/** TTL은 초 단위입니다. 큰 값은 분·시간·일로 바꿔 읽기 쉽게 적습니다. */
function formatTtl(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  return seconds < 86_400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86_400)}d`;
}

// TXT나 SOA는 아주 길 수 있으므로 DATA를 마지막 열에 둬서 다른 열의 줄맞춤이 흐트러지지 않게 합니다.
function recordColumns(output: Output): Column<ResourceRecord>[] {
  return [
    { header: 'TYPE', value: (record) => output.colors.cyan(record.typeName) },
    { header: 'TTL', value: (record) => formatTtl(record.ttl), align: 'right' },
    { header: 'DATA', value: (record) => record.data },
  ];
}

interface CompareRow {
  readonly name: string;
  readonly address: string;
  readonly answer: readonly string[];
  readonly elapsed: number;
  readonly failed: number;
}

function compareColumns(output: Output): Column<CompareRow>[] {
  return [
    { header: 'SERVER', value: (row) => row.name },
    { header: 'ADDRESS', value: (row) => row.address },
    {
      header: 'TIME',
      value: (row) => (row.answer.length === 0 ? '-' : formatMs(row.elapsed)),
      align: 'right',
    },
    {
      header: 'RECORDS',
      value: (row) =>
        row.answer.length === 0
          ? output.colors.yellow(row.failed > 0 ? 'no answer' : 'none')
          : row.answer.join(', '),
    },
  ];
}
