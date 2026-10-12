import { UserError } from '../../cli/errors';
import type { IpFamily, ResolvedHost } from '../resolve';
import { isCommandNotFound, streamLines } from '../stream';
import {
  type Hop,
  type HopAddress,
  parseTracepathLine,
  parseTracerouteHop,
  parseWindowsHop,
} from './parse';

export type TraceTool = 'tracert' | 'traceroute' | 'traceroute6' | 'tracepath';

export interface TraceSettings {
  readonly maxHops: number;
  readonly timeoutMs: number;
  readonly resolveNames: boolean;
}

export interface TraceCommand {
  readonly file: TraceTool;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

/** 시도할 순서대로 traceroute 도구를 고릅니다. Linux는 traceroute가 기본으로 없는 배포판이 많아 tracepath를 대신 씁니다. */
export function traceToolsFor(platform: NodeJS.Platform, family: IpFamily): TraceTool[] {
  if (platform === 'win32') {
    return ['tracert'];
  }
  if (platform === 'darwin') {
    return [family === 6 ? 'traceroute6' : 'traceroute'];
  }
  return ['traceroute', 'tracepath'];
}

export function buildTraceCommand(
  tool: TraceTool,
  target: Pick<ResolvedHost, 'address' | 'family'>,
  settings: TraceSettings,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): TraceCommand {
  const hops = String(settings.maxHops);
  const family = `-${target.family}`;
  if (tool === 'tracert') {
    const numeric = settings.resolveNames ? [] : ['-d'];
    const args = [...numeric, '-h', hops, '-w', String(settings.timeoutMs), family, target.address];
    return { file: tool, args };
  }

  // 출력 형식이 번역되지 않도록 C 로캘로 실행합니다.
  const unixEnv = { ...env, LC_ALL: 'C' };
  if (tool === 'tracepath') {
    // -b는 호스트 이름과 IP를 함께 보여줍니다.
    const names = settings.resolveNames ? '-b' : '-n';
    return { file: tool, args: [names, '-m', hops, family, target.address], env: unixEnv };
  }
  const seconds = String(Math.max(1, Math.ceil(settings.timeoutMs / 1000)));
  const numeric = settings.resolveNames ? [] : ['-n'];
  // macOS의 traceroute에는 -4/-6이 없고, IPv6는 traceroute6을 따로 씁니다.
  const familyFlag = tool === 'traceroute' && platform !== 'darwin' ? [family] : [];
  return {
    file: tool,
    args: [...numeric, '-m', hops, '-w', seconds, '-q', '3', ...familyFlag, target.address],
    env: unixEnv,
  };
}

export interface HopCollector {
  readonly line: (line: string) => void;
  /** 아직 넘기지 않은 경유지를 마저 넘깁니다. */
  readonly flush: () => void;
}

export function createHopCollector(tool: TraceTool, report: (hop: Hop) => void): HopCollector {
  if (tool !== 'tracepath') {
    const parse = tool === 'tracert' ? parseWindowsHop : parseTracerouteHop;
    return {
      line: (line) => {
        const hop = parse(line);
        if (hop) {
          report(hop);
        }
      },
      flush: () => undefined,
    };
  }

  // tracepath는 probe마다 한 줄씩 출력하므로 같은 홉 번호의 줄을 모아 경유지 하나로 만듭니다.
  let current: { hop: number; times: (number | undefined)[]; addresses: HopAddress[] } | undefined;
  const flush = () => {
    if (current) {
      report(current);
      current = undefined;
    }
  };
  return {
    line: (line) => {
      const probe = parseTracepathLine(line);
      if (!probe) {
        return;
      }
      if (current?.hop !== probe.hop) {
        flush();
        current = { hop: probe.hop, times: [], addresses: [] };
      }
      current.times.push(probe.time);
      const { address } = probe;
      if (address && !current.addresses.some((known) => known.address === address.address)) {
        current.addresses.push(address);
      }
    },
    flush,
  };
}

export interface TraceRunOptions extends TraceSettings {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onHop: (hop: Hop) => void;
  readonly onCommand?: (commandLine: string) => void;
}

/** 시스템 traceroute를 실행하며 경유지를 하나씩 알려줍니다. 취소되면 그때까지의 경유지를 돌려줍니다. */
export async function runTrace(target: ResolvedHost, options: TraceRunOptions): Promise<Hop[]> {
  const hops: Hop[] = [];
  const report = (hop: Hop) => {
    hops.push(hop);
    options.onHop(hop);
  };

  for (const tool of traceToolsFor(options.platform, target.family)) {
    const command = buildTraceCommand(tool, target, options, options.platform, options.env);
    const collector = createHopCollector(tool, report);
    options.onCommand?.([command.file, ...command.args].join(' '));
    try {
      await streamLines(command.file, command.args, {
        signal: options.signal,
        env: command.env,
        onLine: collector.line,
      });
      collector.flush();
      return hops;
    } catch (error) {
      collector.flush();
      if (options.signal.aborted) {
        return hops;
      }
      if (!isCommandNotFound(error)) {
        throw error;
      }
    }
  }

  throw new UserError(
    options.platform === 'linux'
      ? 'traceroute is not installed (install the traceroute or iputils-tracepath package)'
      : 'the system traceroute command was not found',
  );
}
