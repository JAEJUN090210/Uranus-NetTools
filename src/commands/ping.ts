import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePort, parsePositiveInteger, parsePositiveNumber } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { type Probe, type ProbeOutcome, runPingLoop } from '../core/ping/pinger';
import { type PingStats, summarize } from '../core/ping/stats';
import { createSystemProbe } from '../core/ping/system';
import { probeTcp } from '../core/ping/tcp';
import { type IpFamily, resolveHost, type ResolvedHost } from '../core/resolve';
import { Output } from '../ui/output';
import { renderSparkline } from '../ui/sparkline';
import type { Column } from '../ui/table';

const DEFAULT_TCP_PORT = 443;

interface PingOptions {
  readonly count: number;
  readonly continuous?: boolean;
  readonly interval: number;
  readonly timeout: number;
  readonly tcp?: boolean;
  readonly port?: number;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
}

interface PingSettings {
  readonly count: number | undefined;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly mode: 'icmp' | 'tcp';
  readonly port: number;
  readonly family: 0 | IpFamily;
}

interface PingReport {
  readonly host: string;
  readonly address: string | null;
  readonly mode: 'icmp' | 'tcp';
  readonly port?: number;
  readonly error?: string;
  readonly probes: readonly Probe[];
  readonly stats: PingStats;
}

export function createPingCommand(runtime: Runtime): Command {
  return new Command('ping')
    .description('ping hosts with ICMP or TCP and show latency statistics')
    .argument('<hosts...>', 'host names or IP addresses')
    .addOption(
      new Option('-c, --count <n>', 'probes per host').argParser(parsePositiveInteger).default(4),
    )
    .addOption(new Option('-t, --continuous', 'keep pinging until Ctrl+C').conflicts('count'))
    .addOption(
      new Option('-i, --interval <seconds>', 'seconds between probes')
        .argParser(parsePositiveNumber)
        .default(1),
    )
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each reply')
        .argParser(parsePositiveInteger)
        .default(2000),
    )
    .option('--tcp', 'measure the TCP handshake time instead of ICMP')
    .addOption(
      new Option('-p, --port <port>', `TCP port, implies --tcp (default: ${DEFAULT_TCP_PORT})`)
        .argParser(parsePort)
        .implies({ tcp: true }),
    )
    .addOption(new Option('-4, --ipv4', 'use IPv4 only').conflicts('ipv6'))
    .addOption(new Option('-6, --ipv6', 'use IPv6 only'))
    .action(async (hosts: string[], options: PingOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const settings: PingSettings = {
        count: options.continuous ? undefined : options.count,
        intervalMs: options.interval * 1000,
        timeoutMs: options.timeout,
        mode: options.tcp ? 'tcp' : 'icmp',
        port: options.port ?? DEFAULT_TCP_PORT,
        family: options.ipv4 ? 4 : options.ipv6 ? 6 : 0,
      };
      const [first] = hosts;
      const reports =
        hosts.length === 1 && first !== undefined
          ? [await pingSingle(first, settings, runtime, output)]
          : await pingMultiple(hosts, settings, runtime, output);
      runtime.exitCode = reports.every((report) => report.stats.received > 0) ? 0 : 1;
    });
}

async function pingSingle(
  host: string,
  settings: PingSettings,
  runtime: Runtime,
  output: Output,
): Promise<PingReport> {
  const target = await resolveHost(host, settings.family);
  output.success(describeTarget(target, settings));
  if (settings.count === undefined) {
    output.hint('Press Ctrl+C to stop.');
  }

  const probes = await runPingLoop({
    count: settings.count,
    intervalMs: settings.intervalMs,
    signal: runtime.signal,
    probe: createProbe(target, settings, runtime, output),
    onProbe: (probe) => {
      printProbe(output, probe, settings);
    },
  });

  const report = toReport(target, settings, probes);
  output.result(report, () => {
    printSummary(output, report);
  });
  return report;
}

async function pingMultiple(
  hosts: readonly string[],
  settings: PingSettings,
  runtime: Runtime,
  output: Output,
): Promise<PingReport[]> {
  const repeat = settings.count === undefined ? 'until Ctrl+C' : `${settings.count} times each`;
  output.hint(`Pinging ${hosts.length} hosts ${repeat}...`);

  const reports = await Promise.all(
    hosts.map(async (host): Promise<PingReport> => {
      let target: ResolvedHost;
      try {
        target = await resolveHost(host, settings.family);
      } catch (error) {
        if (!(error instanceof UserError)) {
          throw error;
        }
        return { ...toReport({ host }, settings, []), error: error.message };
      }
      const probes = await runPingLoop({
        count: settings.count,
        intervalMs: settings.intervalMs,
        signal: runtime.signal,
        probe: createProbe(target, settings, runtime, output),
      });
      return toReport(target, settings, probes);
    }),
  );

  output.result(reports, () => {
    output.table(reports, reportColumns(output));
  });
  return reports;
}

function createProbe(
  target: ResolvedHost,
  settings: PingSettings,
  runtime: Runtime,
  output: Output,
): () => Promise<ProbeOutcome> {
  if (settings.mode === 'tcp') {
    return () => probeTcp(target.address, settings.port, settings.timeoutMs, runtime.signal);
  }
  return createSystemProbe(target, {
    timeoutMs: settings.timeoutMs,
    platform: runtime.platform,
    env: runtime.env,
    signal: runtime.signal,
    onCommand: (commandLine) => {
      output.debug(`running ${commandLine}`);
    },
  });
}

function toReport(
  target: Pick<ResolvedHost, 'host'> & Partial<ResolvedHost>,
  settings: PingSettings,
  probes: readonly Probe[],
): PingReport {
  return {
    host: target.host,
    address: target.address ?? null,
    mode: settings.mode,
    ...(settings.mode === 'tcp' ? { port: settings.port } : {}),
    probes,
    stats: summarize(probes),
  };
}

function describeTarget(target: ResolvedHost, settings: PingSettings): string {
  const name =
    target.host === target.address ? target.address : `${target.host} (${target.address})`;
  return settings.mode === 'tcp' ? `${name} TCP port ${settings.port}` : name;
}

function describeError(error: string | undefined): string {
  return error === 'refused' ? 'refused (port closed)' : (error ?? 'no reply');
}

function formatMs(value: number): string {
  return `${value.toFixed(1)} ms`;
}

function printProbe(output: Output, probe: Probe, settings: PingSettings): void {
  if (probe.time === undefined) {
    output.failure(`seq=${probe.seq}  ${describeError(probe.error)}`);
    return;
  }
  const parts = [`seq=${probe.seq}`];
  if (probe.ttl !== undefined) {
    parts.push(`ttl=${probe.ttl}`);
  }
  if (settings.mode === 'tcp') {
    parts.push('connected');
  }
  parts.push(formatMs(probe.time));
  output.line(`  ${parts.join('  ')}`);
}

function printSummary(output: Output, report: PingReport): void {
  const { stats } = report;
  output.summary(`${stats.sent} sent, ${stats.received} received, ${Math.round(stats.loss)}% loss`);
  if (stats.min !== undefined && stats.avg !== undefined && stats.max !== undefined) {
    const parts = [
      `min/avg/max ${stats.min.toFixed(1)}/${stats.avg.toFixed(1)}/${stats.max.toFixed(1)} ms`,
    ];
    if (stats.jitter !== undefined) {
      parts.push(`jitter ${formatMs(stats.jitter)}`);
    }
    if (stats.p95 !== undefined) {
      parts.push(`p95 ${formatMs(stats.p95)}`);
    }
    output.line(`  ${parts.join('  ')}`);
  }
  if (output.unicode && report.probes.length > 1) {
    output.line(`  ${sparkline(output, report.probes)}`);
  }
}

function sparkline(output: Output, probes: readonly Probe[]): string {
  return renderSparkline(
    probes.map((probe) => probe.time),
    output.colors.red(output.symbols.failure),
  );
}

function colorLoss(output: Output, loss: number): string {
  const text = `${Math.round(loss)}%`;
  if (loss === 0) {
    return output.colors.green(text);
  }
  return loss === 100 ? output.colors.red(text) : output.colors.yellow(text);
}

function reportColumns(output: Output): Column<PingReport>[] {
  const time = (value: number | undefined) => (value === undefined ? '-' : formatMs(value));
  const columns: Column<PingReport>[] = [
    { header: 'HOST', value: (report) => report.host },
    {
      header: 'ADDRESS',
      value: (report) => report.address ?? output.colors.red(report.error ?? 'unresolved'),
    },
    {
      header: 'RECV',
      value: (report) =>
        report.error === undefined ? `${report.stats.received}/${report.stats.sent}` : '-',
      align: 'right',
    },
    {
      header: 'LOSS',
      value: (report) => (report.error === undefined ? colorLoss(output, report.stats.loss) : '-'),
      align: 'right',
    },
    { header: 'AVG', value: (report) => time(report.stats.avg), align: 'right' },
    { header: 'JITTER', value: (report) => time(report.stats.jitter), align: 'right' },
    { header: 'P95', value: (report) => time(report.stats.p95), align: 'right' },
  ];
  if (output.unicode) {
    columns.push({ header: 'HISTORY', value: (report) => sparkline(output, report.probes) });
  }
  return columns;
}
