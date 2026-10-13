import { runProcess } from '../process';
import { isCommandNotFound } from '../stream';

export interface ProgramOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly onCommand?: (commandLine: string) => void;
}

/**
 * 프로세스 번호로 프로그램 이름을 찾는 표를 만듭니다.
 * 권한이 없어 보이지 않는 프로세스는 표에 없고, 그 경우 이름 없이 번호만 보여 줍니다.
 */
export async function listPrograms(options: ProgramOptions): Promise<Map<number, string>> {
  const [file, args, parse] =
    options.platform === 'win32'
      ? (['tasklist', ['/fo', 'csv', '/nh'], parseTasklist] as const)
      : (['ps', ['-axo', 'pid=,comm='], parsePs] as const);

  options.onCommand?.(`${file} ${args.join(' ')}`);
  try {
    const { stdout } = await runProcess(file, args, {
      timeout: options.timeoutMs,
      signal: options.signal,
      env: options.env,
    });
    return parse(stdout);
  } catch (error) {
    if (!isCommandNotFound(error)) {
      throw error;
    }
    // 이름을 못 찾아도 주소와 번호는 그대로 보여 줍니다.
    return new Map();
  }
}

/** tasklist /fo csv: "\"chrome.exe\",\"1234\",\"Console\",\"1\",\"123,456 K\"" */
export function parseTasklist(output: string): Map<number, string> {
  const programs = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = /^"([^"]*)","(\d+)"/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      programs.set(Number(match[2]), match[1]);
    }
  }
  return programs;
}

/** ps -axo pid=,comm=: "  800 /usr/sbin/sshd" (이름만 남기려고 경로는 떼어 냅니다) */
export function parsePs(output: string): Map<number, string> {
  const programs = new Map<number, string>();
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    const command = match?.[2]?.trim();
    if (match?.[1] === undefined || command === undefined || command === '') {
      continue;
    }
    programs.set(Number(match[1]), command.split('/').at(-1) ?? command);
  }
  return programs;
}
