import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface StreamOptions {
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
  readonly onLine: (line: string) => void;
}

/**
 * 외부 명령을 실행하면서 표준 출력을 한 줄씩 넘겨줍니다. 끝나면 종료 코드를 돌려주고,
 * 명령을 찾지 못했거나 취소되면 예외를 던집니다. 인코딩은 runProcess와 같은 이유로 latin1입니다.
 */
export function streamLines(
  file: string,
  args: readonly string[],
  options: StreamOptions,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: options.env,
      signal: options.signal,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    child.stdout.setEncoding('latin1');
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', options.onLine);
    child.once('error', reject);
    child.once('close', (code) => {
      resolve(code);
    });
  });
}

export function isCommandNotFound(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
