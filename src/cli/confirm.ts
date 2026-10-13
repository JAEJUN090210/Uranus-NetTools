import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

/** y나 yes(대소문자 무관)만 동의로 봅니다. 그냥 Enter를 누르면 거절입니다. */
export function isYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

export interface TerminalConfirmOptions {
  readonly input: Readable;
  readonly output: Writable;
  readonly signal: AbortSignal;
  /** 질문하는 동안에는 터미널이 raw 모드라 Ctrl+C가 SIGINT 대신 이 콜백으로 전달됩니다. */
  readonly onInterrupt: () => void;
}

/** 한 번 실행 모드에서 터미널로 예/아니오를 묻는 함수를 만듭니다. 취소되면 AbortError로 거부됩니다. */
export function createTerminalConfirm(
  options: TerminalConfirmOptions,
): (question: string) => Promise<boolean> {
  return async (question) => {
    const rl = createInterface({ input: options.input, output: options.output });
    rl.on('SIGINT', options.onInterrupt);
    try {
      return isYes(await rl.question(question, { signal: options.signal }));
    } finally {
      rl.close();
    }
  };
}
