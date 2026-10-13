import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePorts, parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { isReservedAddress } from '../core/lookup/reserved';
import { type IpFamily, resolveHost, type ResolvedHost } from '../core/resolve';
import { type Banner, createBannerReader } from '../core/scan/banner';
import { serviceName, TOP_PORTS } from '../core/scan/ports';
import { createTcpProbe, type PortResult, type PortState, scanPorts } from '../core/scan/scanner';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';
import { truncateDisplay } from '../ui/width';

const BANNER_WIDTH = 50;
/** 진행 상황 줄을 다시 그리는 최소 간격입니다. */
const PROGRESS_INTERVAL_MS = 100;

interface ScanOptions {
  readonly ports?: readonly number[];
  readonly all?: boolean;
  readonly banner?: boolean;
  readonly yes?: boolean;
  readonly timeout: number;
  readonly concurrency: number;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
}

/** 테스트에서 공개 주소를 흉내 낼 수 있도록 이름 풀이와 주소 판단을 바깥에서 받습니다. */
export interface ScanServices {
  readonly resolve: (host: string, family: 0 | IpFamily) => Promise<ResolvedHost>;
  /** 인터넷에 공개된 주소면 true입니다. 공개 주소는 검사하기 전에 확인을 받습니다. */
  readonly isPublic: (address: string, family: IpFamily) => boolean;
}

export function createScanCommand(
  runtime: Runtime,
  services: ScanServices = {
    resolve: resolveHost,
    isPublic: (address, family) => !isReservedAddress(address, family),
  },
): Command {
  return new Command('scan')
    .description('scan a host for open TCP ports')
    .argument('<host>', 'host name or IP address')
    .addOption(
      new Option(
        '-p, --ports <list>',
        'ports to scan, such as 22,80,443 or 1-1024, or - for all (default: the 1000 most common ports)',
      ).argParser(parsePorts),
    )
    .option('-a, --all', 'show closed and filtered ports too')
    .option('-b, --banner', 'read what each open port says about itself')
    .option('-y, --yes', 'scan a public address without asking')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each port')
        .argParser(parsePositiveInteger)
        .default(1500),
    )
    .addOption(
      new Option('--concurrency <n>', 'ports to try at the same time')
        .argParser(parsePositiveInteger)
        .default(500),
    )
    .addOption(new Option('-4, --ipv4', 'use IPv4 only').conflicts('ipv6'))
    .addOption(new Option('-6, --ipv6', 'use IPv6 only'))
    .action(async (host: string, options: ScanOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = await services.resolve(host, options.ipv4 ? 4 : options.ipv6 ? 6 : 0);
      const ports = options.ports ?? TOP_PORTS;
      if (options.yes !== true && services.isPublic(target.address, target.family)) {
        await confirmPublicTarget(target, runtime, output);
      }
      output.success(`${describeTarget(target)}, ${plural(ports.length, 'port')}`);

      const startedAt = performance.now();
      const progress = createProgress(runtime, output, ports.length);
      const results = await scanPorts({
        ports,
        concurrency: options.concurrency,
        signal: runtime.signal,
        probe: createTcpProbe({
          address: target.address,
          timeoutMs: options.timeout,
          signal: runtime.signal,
          readBanner:
            options.banner === true
              ? createBannerReader({
                  host: target.host,
                  timeoutMs: options.timeout,
                  signal: runtime.signal,
                })
              : undefined,
        }),
        onResult: progress.update,
      });
      progress.clear();
      const elapsed = performance.now() - startedAt;

      const count = (state: PortState) => results.filter((result) => result.state === state).length;
      const shown = options.all === true ? results : results.filter(isOpen);
      const interrupted = results.length < ports.length;
      const report = {
        host,
        address: target.address,
        total: ports.length,
        scanned: results.length,
        open: count('open'),
        closed: count('closed'),
        filtered: count('filtered'),
        elapsed: Math.round(elapsed),
        ports: shown.map((result) => ({
          port: result.port,
          state: result.state,
          service: serviceName(result.port) ?? null,
          ...(options.banner === true && isOpen(result)
            ? { banner: result.banner?.text ?? null, tls: result.banner?.tls ?? null }
            : {}),
        })),
      };

      output.result(report, () => {
        if (shown.length > 0) {
          output.table(shown, resultColumns(output, options.banner === true));
        } else if (report.scanned > 0) {
          output.hint('No open ports found.');
        }
        if (!interrupted && report.open === 0 && report.closed === 0) {
          output.hint(
            'No port answered. The host may be down, or a firewall may be dropping the connections.',
          );
        }
        const counts = `${report.open} open, ${report.closed} closed, ${report.filtered} filtered`;
        output.summary(
          interrupted
            ? `stopped after ${report.scanned} of ${plural(report.total, 'port')}: ${counts}`
            : `${counts} in ${formatDuration(elapsed)}`,
        );
      });
      runtime.exitCode = interrupted ? 1 : 0;
    });
}

/** 공개 주소는 남의 시스템일 수 있으므로 검사하기 전에 확인을 받습니다. */
async function confirmPublicTarget(
  target: ResolvedHost,
  runtime: Runtime,
  output: Output,
): Promise<void> {
  if (runtime.confirm === undefined) {
    throw new UserError(
      `${target.address} is a public address; add --yes to scan it if you have permission`,
    );
  }
  output.warn(
    `${target.address} is a public address. Only scan hosts you own or have permission to test.`,
  );
  if (!(await runtime.confirm(`Scan ${describeTarget(target)}? [y/N] `))) {
    throw new UserError('scan cancelled');
  }
}

/** 터미널이면 진행 상황 한 줄을 제자리에서 고쳐 그립니다. */
function createProgress(runtime: Runtime, output: Output, total: number) {
  const live = !output.json && !output.quiet && runtime.stdout.isTTY === true;
  let open = 0;
  let drawnAt = Number.NEGATIVE_INFINITY;
  const draw = (done: number) => {
    const text = `scanning ${done}/${total} ports · ${open} open`;
    runtime.stdout.write(`\r\u001b[2K${output.colors.dim(text)}`);
  };
  if (live) {
    draw(0);
  }
  return {
    update: (result: PortResult, done: number) => {
      if (isOpen(result)) {
        open++;
      }
      const now = performance.now();
      if (live && now - drawnAt >= PROGRESS_INTERVAL_MS) {
        drawnAt = now;
        draw(done);
      }
    },
    clear: () => {
      if (live) {
        runtime.stdout.write('\r\u001b[2K');
      }
    },
  };
}

function isOpen(result: PortResult): boolean {
  return result.state === 'open';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function describeTarget(target: ResolvedHost): string {
  return target.host === target.address ? target.address : `${target.host} (${target.address})`;
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  const total = Math.round(seconds);
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

function colorState(output: Output, state: PortState): string {
  switch (state) {
    case 'open':
      return output.colors.green(state);
    case 'closed':
      return output.colors.dim(state);
    case 'filtered':
      return output.colors.yellow(state);
  }
}

function formatBanner(output: Output, banner: Banner | undefined): string {
  const parts = [banner?.tls, banner?.text].filter((part) => part !== undefined);
  if (parts.length === 0) {
    return '-';
  }
  return truncateDisplay(parts.join(' · '), BANNER_WIDTH, output.unicode ? '…' : '...');
}

function resultColumns(output: Output, banner: boolean): Column<PortResult>[] {
  const columns: Column<PortResult>[] = [
    { header: 'PORT', value: (result) => `${result.port}/tcp`, align: 'right' },
    { header: 'STATE', value: (result) => colorState(output, result.state) },
    { header: 'SERVICE', value: (result) => serviceName(result.port) ?? '-' },
  ];
  if (banner) {
    columns.push({ header: 'BANNER', value: (result) => formatBanner(output, result.banner) });
  }
  return columns;
}
