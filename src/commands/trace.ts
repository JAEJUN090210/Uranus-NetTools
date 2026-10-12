import { Command, Option } from 'commander';

import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { resolveHost, type ResolvedHost } from '../core/resolve';
import type { Hop, HopAddress } from '../core/trace/parse';
import { runTrace } from '../core/trace/tracer';
import { Output } from '../ui/output';
import { padDisplay } from '../ui/width';

interface TraceOptions {
  readonly maxHops: number;
  readonly timeout: number;
  readonly numeric?: boolean;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
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
    .action(async (host: string, options: TraceOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = await resolveHost(host, options.ipv4 ? 4 : options.ipv6 ? 6 : 0);
      output.success(`${describeTarget(target)}, max ${options.maxHops} hops`);

      const hops = await runTrace(target, {
        maxHops: options.maxHops,
        timeoutMs: options.timeout,
        resolveNames: options.numeric !== true,
        platform: runtime.platform,
        env: runtime.env,
        signal: runtime.signal,
        onHop: (hop) => {
          output.line(formatHop(hop, output));
        },
        onCommand: (commandLine) => {
          output.debug(`running ${commandLine}`);
        },
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
          output.summary(
            `did not reach ${target.address} within ${plural(options.maxHops, 'hop')}`,
          );
        }
      });
      runtime.exitCode = reachedAt === undefined ? 1 : 0;
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
