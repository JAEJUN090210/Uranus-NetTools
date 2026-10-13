export interface TextStream {
  write(text: string): unknown;
  readonly isTTY?: boolean;
  hasColors?(): boolean;
}

/** 명령이 실행되는 환경입니다. 테스트와 대화형 셸에서는 다른 값을 넣어 씁니다. */
export interface Runtime {
  readonly stdout: TextStream;
  readonly stderr: TextStream;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  /** Ctrl+C를 누르면 abort됩니다. 오래 걸리는 명령은 이 신호를 보고 결과를 정리하며 끝내야 합니다. */
  readonly signal: AbortSignal;
  /**
   * 사용자에게 예/아니오를 묻습니다. 입력이 터미널이 아니면(파이프, 스크립트) 물을 수 없으므로 없습니다.
   * Ctrl+C로 취소되면 AbortError로 거부됩니다.
   */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** 명령이 실패를 알릴 때 설정하는 종료 코드입니다. */
  exitCode: number;
}

export function createProcessRuntime(
  signal: AbortSignal,
  confirm?: (question: string) => Promise<boolean>,
): Runtime {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    platform: process.platform,
    signal,
    confirm,
    exitCode: 0,
  };
}
