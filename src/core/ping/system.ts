import { UserError } from '../../cli/errors';
import { runProcess } from '../process';
import type { IpFamily, ResolvedHost } from '../resolve';
import type { ProbeOutcome } from './pinger';

export interface PingCommand {
  readonly file: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

/** probe 하나를 보내는 OS별 ping 명령을 만듭니다. 한 번에 하나씩 보내야 시간 초과와 취소를 다루기 쉽습니다. */
export function buildPingCommand(
  address: string,
  family: IpFamily,
  timeoutMs: number,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): PingCommand {
  if (platform === 'win32') {
    return { file: 'ping', args: ['-n', '1', '-w', String(timeoutMs), `-${family}`, address] };
  }
  // 출력 형식이 번역되지 않도록 C 로캘로 실행합니다.
  const unixEnv = { ...env, LC_ALL: 'C' };
  if (platform === 'darwin') {
    // macOS의 ping은 IPv6를 지원하지 않고, -W가 밀리초 단위입니다.
    return family === 6
      ? { file: 'ping6', args: ['-c', '1', '-n', address], env: unixEnv }
      : { file: 'ping', args: ['-c', '1', '-n', '-W', String(timeoutMs), address], env: unixEnv };
  }
  // Linux(iputils, BusyBox)의 -W는 초 단위입니다.
  const timeoutSeconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  return {
    file: 'ping',
    args: ['-c', '1', '-n', '-W', timeoutSeconds, `-${family}`, address],
    env: unixEnv,
  };
}

// Windows는 OS 언어에 따라 문장이 번역되지만(예: "1.1.1.1의 응답: 바이트=32 시간=8ms TTL=57"),
// "TTL=" 과 "=8ms", "<1ms" 같은 부분은 어떤 언어에서도 그대로입니다.
const TIME_PATTERN = /([=<])\s*(\d+(?:[.,]\d+)?)\s*ms\b/i;
const TTL_PATTERN = /\bttl[=:]\s*(\d+)/i;
const MS_TOKEN = /ms\b/gi;

/** ping 출력에서 응답 줄을 찾아 왕복 시간과 TTL을 꺼냅니다. 응답이 없으면 undefined입니다. */
export function parsePingReply(output: string): { time: number; ttl?: number } | undefined {
  for (const line of output.split(/\r?\n/)) {
    // 최소/최대/평균이 함께 있는 통계 줄은 ms가 여러 번 나오므로 건너뜁니다.
    if (line.match(MS_TOKEN)?.length !== 1) {
      continue;
    }
    const time = TIME_PATTERN.exec(line);
    if (!time) {
      continue;
    }
    const [, operator, value = '0'] = time;
    const milliseconds = Number(value.replace(',', '.'));
    const ttl = TTL_PATTERN.exec(line)?.[1];
    // Windows는 1ms 미만을 "<1ms"로만 알려주므로 중간값으로 기록합니다.
    const reply = { time: operator === '<' ? milliseconds / 2 : milliseconds };
    return ttl === undefined ? reply : { ...reply, ttl: Number(ttl) };
  }
  return undefined;
}

export interface SystemProbeOptions {
  readonly timeoutMs: number;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onCommand?: (commandLine: string) => void;
}

export function createSystemProbe(
  target: ResolvedHost,
  options: SystemProbeOptions,
): () => Promise<ProbeOutcome> {
  const command = buildPingCommand(
    target.address,
    target.family,
    options.timeoutMs,
    options.platform,
    options.env,
  );
  return async () => {
    options.onCommand?.([command.file, ...command.args].join(' '));
    try {
      const { stdout } = await runProcess(command.file, command.args, {
        // ping이 스스로 시간 초과를 처리하지 못할 때를 대비한 여유 시간입니다.
        timeout: options.timeoutMs + 1000,
        signal: options.signal,
        env: command.env,
      });
      return parsePingReply(stdout) ?? { error: 'timeout' };
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new UserError(`the system '${command.file}' command was not found (try --tcp)`);
      }
      throw error;
    }
  };
}
