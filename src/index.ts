import { EXIT_INTERRUPTED, runCommand } from './cli/run';
import { createProcessRuntime } from './cli/runtime';

const controller = new AbortController();

// 첫 Ctrl+C는 실행 중인 명령이 결과를 정리하며 끝나게 하고, 두 번째 Ctrl+C는 바로 종료합니다.
process.on('SIGINT', () => {
  if (controller.signal.aborted) {
    process.exit(EXIT_INTERRUPTED);
  }
  controller.abort();
});

const args = process.argv.slice(2);

// 인자 없이 실행하면 도움말을 보여줍니다.
runCommand(args.length > 0 ? args : ['--help'], createProcessRuntime(controller.signal)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
