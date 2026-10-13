import type { Runtime } from '../../src/cli/runtime';

export interface TestRuntimeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly tty?: boolean;
  readonly signal?: AbortSignal;
  readonly confirm?: (question: string) => Promise<boolean>;
}

/** 출력 내용을 문자열로 모으는 테스트용 실행 환경을 만듭니다. */
export function createTestRuntime(options: TestRuntimeOptions = {}) {
  let stdout = '';
  let stderr = '';
  const tty = options.tty ?? false;
  const runtime: Runtime = {
    stdout: {
      write: (text: string) => {
        stdout += text;
      },
      isTTY: tty,
      hasColors: () => tty,
    },
    stderr: {
      write: (text: string) => {
        stderr += text;
      },
      isTTY: tty,
      hasColors: () => tty,
    },
    env: options.env ?? {},
    platform: options.platform ?? 'linux',
    signal: options.signal ?? new AbortController().signal,
    confirm: options.confirm,
    exitCode: 0,
  };
  return { runtime, stdout: () => stdout, stderr: () => stderr };
}
