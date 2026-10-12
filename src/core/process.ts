import { execFile } from 'node:child_process';

export interface ProcessOptions {
  readonly timeout: number;
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  readonly stdout: string;
  /** 시간 초과로 강제 종료되면 null입니다. */
  readonly exitCode: number | null;
}

/**
 * 외부 명령을 실행하고 표준 출력을 모읍니다.
 * 0이 아닌 종료 코드와 시간 초과는 결과로 돌려주고, 명령을 찾지 못했거나 취소됐을 때만 예외를 던집니다.
 * Windows 명령은 콘솔 코드 페이지(한국어는 CP949)로 출력하므로, 깨지지 않는 ASCII 부분만 믿고 latin1로 읽습니다.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout,
        signal: options.signal,
        env: options.env,
        encoding: 'latin1',
        windowsHide: true,
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ stdout, exitCode: 0 });
          return;
        }
        const failure: Error = error;
        if (failure.name === 'AbortError') {
          reject(failure);
        } else if (typeof error.code === 'number') {
          resolve({ stdout, exitCode: error.code });
        } else if (error.killed === true) {
          resolve({ stdout, exitCode: null });
        } else {
          reject(failure);
        }
      },
    );
  });
}
