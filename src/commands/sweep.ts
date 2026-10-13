import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { isReservedAddress } from '../core/lookup/reserved';
import type { ProbeOutcome } from '../core/ping/pinger';
import { createSystemProbe } from '../core/ping/system';
import { probeTcp } from '../core/ping/tcp';
import { readArpTable } from '../core/sweep/arp';
import { createHostnameLookup, type HostnameLookup } from '../core/sweep/hostname';
import { vendorOf } from '../core/sweep/oui';
import { localSubnets, parseTargets, type Targets } from '../core/sweep/range';
import { type Host, type HostProbe, type Liveness, sweepHosts } from '../core/sweep/sweeper';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';
import { truncateDisplay } from '../ui/width';

// /16(65,536개)까지 허용합니다. 그보다 넓으면 범위를 나눠 실행하게 합니다.
const MAX_ADDRESSES = 65_536;
// ICMP가 막힌 호스트도 찾도록 연결해 보는, LAN에서 흔한 포트입니다.
// 호스트마다 이 포트들에 동시에 연결하므로, 개수를 늘리면 동시 소켓이 많아져 Windows에서 오히려 느려집니다.
const TCP_PORTS = [445, 139, 80, 443, 22, 3389];
const HOST_WIDTH = 28;
const VENDOR_WIDTH = 24;
const PROGRESS_INTERVAL_MS = 100;

interface SweepOptions {
  readonly timeout: number;
  readonly concurrency: number;
  readonly hostnames: boolean;
  readonly yes?: boolean;
}

/** 테스트에서 실제 네트워크 대신 가짜를 넣을 수 있도록 조회 수단을 한데 모았습니다. */
export interface SweepServices {
  readonly localSubnets: typeof localSubnets;
  /** 인터넷에 공개된 주소면 true입니다. 공개 범위는 검사하기 전에 확인을 받습니다. */
  readonly isPublic: (address: string) => boolean;
  readonly probe: (timeoutMs: number, runtime: Runtime) => HostProbe;
  readonly readArp: (
    timeoutMs: number,
    runtime: Runtime,
    onCommand: (line: string) => void,
  ) => Promise<Map<string, string>>;
  readonly hostname: (timeoutMs: number, runtime: Runtime) => HostnameLookup;
  readonly vendor: (mac: string) => string | undefined;
}

const defaultServices: SweepServices = {
  localSubnets,
  isPublic: (address) => !isReservedAddress(address, 4),
  probe: (timeoutMs, runtime) => createProbe(timeoutMs, runtime),
  readArp: (timeoutMs, runtime, onCommand) =>
    readArpTable({
      platform: runtime.platform,
      env: runtime.env,
      signal: runtime.signal,
      timeoutMs,
      onCommand,
    }),
  hostname: (timeoutMs, runtime) => createHostnameLookup({ timeoutMs, signal: runtime.signal }),
  vendor: vendorOf,
};

export function createSweepCommand(
  runtime: Runtime,
  services: SweepServices = defaultServices,
): Command {
  return new Command('sweep')
    .description('find active hosts on a local network')
    .argument('[range]', 'CIDR block or range, such as 192.168.0.0/24 (default: the local subnet)')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each probe')
        .argParser(parsePositiveInteger)
        .default(1000),
    )
    .addOption(
      new Option('--concurrency <n>', 'hosts to probe at the same time')
        .argParser(parsePositiveInteger)
        .default(64),
    )
    .option('--no-hostnames', 'do not look up host names (faster)')
    .option('-y, --yes', 'sweep a public range without asking')
    .action(async (range: string | undefined, options: SweepOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const targets = range === undefined ? autoSubnet(services, output) : parse(range);
      if (options.yes !== true && isPublic(targets, services)) {
        await confirmPublicRange(targets, runtime, output);
      }
      output.success(`${targets.description}, ${plural(targets.addresses.length, 'address')}`);

      const startedAt = performance.now();
      const progress = createProgress(runtime, output, targets.addresses.length);
      const { hosts, complete } = await sweepHosts({
        addresses: targets.addresses,
        concurrency: options.concurrency,
        signal: runtime.signal,
        probe: services.probe(options.timeout, runtime),
        arp: () =>
          services.readArp(options.timeout, runtime, (line) => {
            output.debug(`running ${line}`);
          }),
        hostname: options.hostnames ? services.hostname(options.timeout, runtime) : undefined,
        vendor: services.vendor,
        onProgress: progress.update,
      });
      progress.clear();
      const elapsed = performance.now() - startedAt;

      const report = {
        range: targets.description,
        total: targets.addresses.length,
        scanned: complete ? targets.addresses.length : progress.done(),
        up: hosts.length,
        elapsed: Math.round(elapsed),
        hosts: hosts.map((host) => ({
          address: host.address,
          hostname: host.hostname ?? null,
          mac: host.mac ?? null,
          vendor: host.vendor ?? null,
          via: host.via,
          time: host.time ?? null,
        })),
      };

      output.result(report, () => {
        if (hosts.length > 0) {
          output.table(hosts, hostColumns(output));
        } else {
          output.hint('No hosts answered.');
        }
        output.summary(
          complete
            ? `${plural(hosts.length, 'host')} up in ${formatDuration(elapsed)}`
            : `stopped after ${progress.done()} of ${plural(targets.addresses.length, 'address')}: ${plural(hosts.length, 'host')} up`,
        );
      });
      runtime.exitCode = complete ? 0 : 1;
    });
}

function parse(range: string): Targets {
  try {
    return parseTargets(range, MAX_ADDRESSES);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
}

/** 범위를 주지 않으면 지금 연결된 서브넷을 씁니다. 여러 개면 첫 번째를 쓰고 나머지는 알려 줍니다. */
function autoSubnet(services: SweepServices, output: Output): Targets {
  const subnets = services.localSubnets();
  const [first, ...rest] = subnets;
  if (first === undefined) {
    throw new UserError('no local IPv4 network found; give a range such as 192.168.0.0/24');
  }
  if (rest.length > 0) {
    const others = rest.map((subnet) => subnet.description).join(', ');
    output.hint(`Using ${first.interface} (${first.description}); also found ${others}.`);
  }
  return first;
}

/** ICMP ping을 먼저 보내고, 응답이 없으면 흔한 TCP 포트에 연결을 시도합니다. */
function createProbe(timeoutMs: number, runtime: Runtime): HostProbe {
  return async (address: string): Promise<Liveness> => {
    const ping = createSystemProbe(
      { host: address, address, family: 4 },
      {
        timeoutMs,
        platform: runtime.platform,
        env: runtime.env,
        signal: runtime.signal,
      },
    );
    let icmp: ProbeOutcome;
    try {
      icmp = await ping();
    } catch {
      return undefined; // 취소됨
    }
    if (icmp.time !== undefined) {
      return { via: 'icmp', time: icmp.time };
    }
    return tcpLiveness(address, timeoutMs, runtime.signal);
  };
}

/** 여러 포트에 동시에 연결해 봅니다. 하나라도 연결되면 응답 시간과 함께, 거부되면 시간 없이 살아 있다고 봅니다. */
async function tcpLiveness(
  address: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Liveness> {
  const outcomes = await Promise.all(
    TCP_PORTS.map((port) =>
      probeTcp(address, port, timeoutMs, signal).catch((): ProbeOutcome => ({
        error: 'cancelled',
      })),
    ),
  );
  const connected = outcomes.find((outcome) => outcome.time !== undefined);
  if (connected?.time !== undefined) {
    return { via: 'tcp', time: connected.time };
  }
  // 포트가 닫혀 거부 응답이 오면 포트는 막혔어도 호스트는 켜져 있는 것입니다.
  return outcomes.some((outcome) => outcome.error === 'refused') ? { via: 'tcp' } : undefined;
}

function isPublic(targets: Targets, services: SweepServices): boolean {
  const { addresses } = targets;
  const first = addresses[0];
  const last = addresses.at(-1);
  return (
    (first !== undefined && services.isPublic(first)) ||
    (last !== undefined && services.isPublic(last))
  );
}

async function confirmPublicRange(
  targets: Targets,
  runtime: Runtime,
  output: Output,
): Promise<void> {
  if (runtime.confirm === undefined) {
    throw new UserError(
      `${targets.description} is a public range; add --yes to sweep it if you have permission`,
    );
  }
  output.warn(
    `${targets.description} is a public range. Only sweep networks you own or have permission to test.`,
  );
  if (!(await runtime.confirm(`Sweep ${plural(targets.addresses.length, 'address')}? [y/N] `))) {
    throw new UserError('sweep cancelled');
  }
}

function createProgress(runtime: Runtime, output: Output, total: number) {
  const live = !output.json && !output.quiet && runtime.stdout.isTTY === true;
  let done = 0;
  let found = 0;
  let drawnAt = Number.NEGATIVE_INFINITY;
  const draw = () => {
    const text = `sweeping ${done}/${total} · ${found} up`;
    runtime.stdout.write(`\r\u001b[2K${output.colors.dim(text)}`);
  };
  if (live) {
    draw();
  }
  return {
    update: (scanned: number, _total: number, up: number) => {
      done = scanned;
      found = up;
      const now = performance.now();
      if (live && now - drawnAt >= PROGRESS_INTERVAL_MS) {
        drawnAt = now;
        draw();
      }
    },
    clear: () => {
      if (live) {
        runtime.stdout.write('\r\u001b[2K');
      }
    },
    done: () => done,
  };
}

function plural(count: number, word: string): string {
  const plural = word === 'address' ? 'addresses' : `${word}s`;
  return `${count.toLocaleString('en')} ${count === 1 ? word : plural}`;
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  const total = Math.round(seconds);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

function formatTime(host: Host, output: Output): string {
  if (host.time !== undefined) {
    return `${host.time.toFixed(1)} ms`;
  }
  // 응답 시간이 없는 호스트는 왜 찾았는지(포트 거부 또는 ARP만) 밝혀 둡니다.
  return output.colors.dim(host.via === 'arp' ? 'arp' : 'open');
}

function hostColumns(output: Output): Column<Host>[] {
  const ellipsis = output.unicode ? '…' : '...';
  return [
    { header: 'IP', value: (host) => host.address },
    {
      header: 'HOST',
      value: (host) =>
        host.hostname === undefined
          ? output.colors.dim('-')
          : truncateDisplay(host.hostname, HOST_WIDTH, ellipsis),
    },
    { header: 'MAC', value: (host) => host.mac ?? output.colors.dim('-') },
    {
      header: 'VENDOR',
      value: (host) =>
        host.vendor === undefined
          ? output.colors.dim('-')
          : truncateDisplay(host.vendor, VENDOR_WIDTH, ellipsis),
    },
    { header: 'TIME', value: (host) => formatTime(host, output), align: 'right' },
  ];
}
