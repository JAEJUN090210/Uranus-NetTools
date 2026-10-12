import { EXIT_INTERRUPTED, runCommand } from './cli/run';
import { createProcessRuntime } from './cli/runtime';
import { startShell } from './repl/shell';

function runOnce(args: readonly string[]): Promise<number> {
  const controller = new AbortController();
  // 첫 Ctrl+C는 실행 중인 명령이 결과를 정리하며 끝나게 하고, 두 번째 Ctrl+C는 바로 종료합니다.
  process.on('SIGINT', () => {
    if (controller.signal.aborted) {
      process.exit(EXIT_INTERRUPTED);
    }
    controller.abort();
  });
  return runCommand(args, createProcessRuntime(controller.signal));
}

const args = process.argv.slice(2);
// 인자 없이 터미널에서 실행하면 대화형 셸을 열고, 파이프나 스크립트에서는 도움말을 보여줍니다.
const interactive = args.length === 0 && process.stdin.isTTY && process.stdout.isTTY;

const finished = interactive
  ? startShell({
      input: process.stdin,
      output: process.stdout,
      createRuntime: createProcessRuntime,
    })
  : runOnce(args.length > 0 ? args : ['--help']);

finished.then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
