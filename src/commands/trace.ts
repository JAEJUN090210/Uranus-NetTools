import { isIP } from 'node:net';

import { Command, Option } from 'commander';

import { parsePositiveInteger, parsePositiveNumber } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import type { ProbeOutcome } from '../core/ping/pinger';
import { createSystemProbe } from '../core/ping/system';
import { resolveHost, type ResolvedHost } from '../core/resolve';
import type { Hop, HopAddress } from '../core/trace/parse';
import { runTrace } from '../core/trace/tracer';
import { type HopStats, watchHops } from '../core/trace/watch';
import { Output } from '../ui/output';
import { type Column, renderTable } from '../ui/table';
import { padDisplay } from '../ui/width';

interface TraceOptions {
  readonly maxHops: number;
  readonly timeout: number;
  readonly numeric?: boolean;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
  readonly watch?: boolean;
  readonly count?: number;
  readonly interval: number;
}

const TIME_WIDTH = 9;

export function createTraceCommand(runtime: Runtime): Command {
  return new Command('trace')
    .description('trace the route to a host')
    .argument('<host>', 'host name or IP address')
    .addOption(
      new Option('-m, --max-hops <n>', 'maximum number of hops')
        .argParser(parsePositiveInteger)
        .default(30),
    )
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each reply')
        .argParser(parsePositiveInteger)
        .default(2000),
    )
    .option('-n, --numeric', 'show IP addresses only, without looking up host names')
    .addOption(new Option('-4, --ipv4', 'use IPv4 only').conflicts('ipv6'))
    .addOption(new Option('-6, --ipv6', 'use IPv6 only'))
    .option('--watch', 'keep measuring every hop and update the table live, like mtr')
    .addOption(
      new Option('-c, --count <rounds>', 'rounds to measure in watch mode, implies --watch')
        .argParser(parsePositiveInteger)
        .implies({ watch: true }),
    )
    .addOption(
      new Option(
        '-i, --interval <seconds>',
        'seconds between rounds in watch mode, implies --watch',
      )
        .argParser(parsePositiveNumber)
        .default(1)
        .implies({ watch: true }),
    )
    .action(async (host: string, options: TraceOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = await resolveHost(host, options.ipv4 ? 4 : options.ipv6 ? 6 : 0);
      output.success(`${describeTarget(target)}, max ${options.maxHops} hops`);
      if (options.watch === true) {
        await traceWatch(host, target, options, runtime, output);
      } else {
        await traceOnce(host, target, options, runtime, output);
      }
    });
}

function discover(
  target: ResolvedHost,
  options: TraceOptions,
  runtime: Runtime,
  output: Output,
  onHop: (hop: Hop) => void,
): Promise<Hop[]> {
  return runTrace(target, {
    maxHops: options.maxHops,
    timeoutMs: options.timeout,
    resolveNames: options.numeric !== true,
    platform: runtime.platform,
    env: runtime.env,
    signal: runtime.signal,
    onHop,
    onCommand: (commandLine) => {
      output.debug(`running ${commandLine}`);
    },
  });
}

async function traceOnce(
  host: string,
  target: ResolvedHost,
  options: TraceOptions,
  runtime: Runtime,
  output: Output,
): Promise<void> {
  const hops = await discover(target, options, runtime, output, (hop) => {
    output.line(formatHop(hop, output));
  });

  const reachedAt = hops.find((hop) =>
    hop.addresses.some((address) => address.address === target.address),
  )?.hop;
  const report = {
    host,
    address: target.address,
    maxHops: options.maxHops,
    reached: reachedAt !== undefined,
    hops: hops.map((hop) => ({ ...hop, times: hop.times.map((time) => time ?? null) })),
  };
  output.result(report, () => {
    if (reachedAt !== undefined) {
      output.summary(`reached in ${plural(reachedAt, 'hop')}`);
    } else if (runtime.signal.aborted) {
      output.summary(`stopped after ${plural(hops.length, 'hop')}`);
    } else {
      output.summary(`did not reach ${target.address} within ${plural(options.maxHops, 'hop')}`);
    }
  });
  runtime.exitCode = reachedAt === undefined ? 1 : 0;
}

/**
 * pathping처럼 경로를 한 번 찾은 뒤 라운드마다 모든 경유지에 ping을 보냅니다.
 * Node.js는 관리자 권한 없이 TTL을 지정한 ICMP를 보낼 수 없어서 경유지 라우터에 직접 ping합니다.
 */
async function traceWatch(
  host: string,
  target: ResolvedHost,
  options: TraceOptions,
  runtime: Runtime,
  output: Output,
): Promise<void> {
  output.hint('Discovering the route...');
  const hops = await discover(target, options, runtime, output, () => undefined);

  const probes = new Map<string, () => Promise<ProbeOutcome>>();
  const probe = ({ address }: HopAddress) => {
    let send = probes.get(address);
    if (send === undefined) {
      const family = isIP(address) === 6 ? 6 : 4;
      send = createSystemProbe(
        { host: address, address, family },
        {
          timeoutMs: options.timeout,
          platform: runtime.platform,
          env: runtime.env,
          signal: runtime.signal,
        },
      );
      probes.set(address, send);
    }
    return send();
  };

  // 터미널에서는 이전에 그린 표 위로 커서를 올려 지운 뒤 다시 그립니다.
  const columns = watchColumns(output);
  const live = !output.json && runtime.stdout.isTTY === true;
  let drawnLines = 0;
  const draw = (stats: readonly HopStats[], round: number) => {
    const progress =
      options.count === undefined
        ? `round ${round} · press Ctrl+C to stop`
        : `round ${round}/${options.count}`;
    const text = `${output.colors.dim(progress)}\n${renderTable(stats, columns, output.colors)}`;
    const erase = drawnLines > 0 ? `\u001b[${drawnLines}F\u001b[J` : '';
    runtime.stdout.write(`${erase}${text}\n`);
    drawnLines = text.split('\n').length;
  };

  const { stats, rounds } = await watchHops(hops, {
    intervalMs: options.interval * 1000,
    rounds: options.count,
    signal: runtime.signal,
    probe,
    onRound: live ? draw : undefined,
  });

  const report = {
    host,
    address: target.address,
    rounds,
    hops: stats.map((hop) => ({
      hop: hop.hop,
      address: hop.address?.address ?? null,
      name: hop.address?.name,
      sent: hop.sent,
      received: hop.received,
      loss: hop.loss,
      last: hop.last,
      avg: hop.avg,
      best: hop.best,
      worst: hop.worst,
    })),
  };
  output.result(report, () => {
    if (!live) {
      output.table(stats, columns);
    }
    output.summary(`${plural(rounds, 'round')} over ${plural(hops.length, 'hop')}`);
  });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function describeTarget(target: ResolvedHost): string {
  return target.host === target.address ? target.address : `${target.host} (${target.address})`;
}

function describeAddress(address: HopAddress): string {
  return address.name === undefined ? address.address : `${address.name} (${address.address})`;
}

/** 이름 길이가 제각각이라 응답 시간을 앞에 고정 폭으로 두고 주소를 맨 뒤에 붙입니다. */
function formatHop(hop: Hop, output: Output): string {
  const times = hop.times
    .map((time) =>
      padDisplay(time === undefined ? '*' : `${time.toFixed(1)} ms`, TIME_WIDTH, 'right'),
    )
    .join('');
  const [first, ...others] = hop.addresses;
  const more = others.length > 0 ? output.colors.dim(` (+${others.length} more)`) : '';
  const where = first === undefined ? '' : `  ${describeAddress(first)}${more}`;
  return `${String(hop.hop).padStart(4)}${times}${where}`;
}

function formatLoss(output: Output, hop: HopStats): string {
  if (hop.address === undefined || hop.sent === 0) {
    return '-';
  }
  const text = `${Math.round(hop.loss)}%`;
  if (hop.loss === 0) {
    return output.colors.green(text);
  }
  return hop.loss === 100 ? output.colors.red(text) : output.colors.yellow(text);
}

function watchColumns(output: Output): Column<HopStats>[] {
  const ms = (value: number | undefined) => (value === undefined ? '-' : value.toFixed(1));
  return [
    { header: 'HOP', value: (hop) => String(hop.hop), align: 'right' },
    {
      header: 'ADDRESS',
      value: (hop) =>
        hop.address === undefined ? output.colors.dim('???') : describeAddress(hop.address),
    },
    { header: 'LOSS', value: (hop) => formatLoss(output, hop), align: 'right' },
    { header: 'SENT', value: (hop) => String(hop.sent), align: 'right' },
    { header: 'LAST', value: (hop) => ms(hop.last), align: 'right' },
    { header: 'AVG', value: (hop) => ms(hop.avg), align: 'right' },
    { header: 'BEST', value: (hop) => ms(hop.best), align: 'right' },
    { header: 'WORST', value: (hop) => ms(hop.worst), align: 'right' },
  ];
}
