import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import pkg from '../../package.json' with { type: 'json' };
import { isYes } from '../cli/confirm';
import { COMMAND_GROUPS, type CommandGroup, createProgram } from '../cli/program';
import { runCommand } from '../cli/run';
import type { Runtime } from '../cli/runtime';
import { Output } from '../ui/output';
import { supportsUnicode } from '../ui/symbols';
import { renderBanner } from './banner';
import { createCompleter, namesOf, SHELL_COMMANDS } from './completer';
import { tokenize } from './tokenize';

export interface ShellOptions {
  readonly input: Readable;
  readonly output: Writable & { readonly isTTY?: boolean };
  /** 명령마다 새 취소 신호를 받아 실행 환경을 만듭니다. */
  readonly createRuntime: (signal: AbortSignal) => Runtime;
  readonly groups?: readonly CommandGroup[];
  /** 기본값은 output이 터미널인지 여부입니다. */
  readonly terminal?: boolean;
}

/** 대화형 셸을 실행합니다. exit, quit, Ctrl+D, 또는 빈 줄에서 Ctrl+C를 두 번 누르면 끝납니다. */
export async function startShell(options: ShellOptions): Promise<number> {
  const { input, output, createRuntime, groups = COMMAND_GROUPS } = options;
  const runtime = createRuntime(new AbortController().signal);
  const ui = new Output(runtime);
  const program = createProgram(runtime, groups);
  const knownCommands = new Set<string>([...SHELL_COMMANDS, ...program.commands.flatMap(namesOf)]);
  const unicode = supportsUnicode(runtime.env, runtime.platform);

  const rl = readline.createInterface({
    input,
    output,
    prompt: `${ui.colors.cyan(unicode ? 'unt ❯' : 'unt>')} `,
    completer: createCompleter(program),
    terminal: options.terminal ?? output.isTTY === true,
  });

  let running: AbortController | undefined;
  let exitArmed = false;

  /** 명령이 확인을 받을 때 셸의 readline으로 묻습니다. Ctrl+C를 누르면 질문도 취소됩니다. */
  const ask = (question: string, signal: AbortSignal) =>
    new Promise<boolean>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason as Error);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      rl.question(question, { signal }, (answer) => {
        signal.removeEventListener('abort', onAbort);
        resolve(isYes(answer));
      });
    });

  rl.on('SIGINT', () => {
    // 실행 중인 명령이 있으면 그 명령만 취소하고 셸은 계속 둡니다.
    if (running) {
      running.abort();
      return;
    }
    if (exitArmed && rl.line === '') {
      rl.close();
      return;
    }
    exitArmed = rl.line === '';
    rl.write(null, { ctrl: true, name: 'e' });
    rl.write(null, { ctrl: true, name: 'u' });
    output.write(
      exitArmed ? `\n${ui.colors.dim("(press Ctrl+C again or type 'exit' to quit)")}\n` : '\n',
    );
    rl.prompt();
  });

  async function execute(line: string): Promise<'exit' | undefined> {
    let args: string[];
    try {
      args = tokenize(line);
    } catch (error) {
      ui.error(error instanceof Error ? error.message : String(error));
      return undefined;
    }

    const [name, ...rest] = args;
    if (name === undefined) {
      return undefined;
    }
    if (name === 'exit' || name === 'quit') {
      return 'exit';
    }
    if (name === 'clear') {
      readline.cursorTo(output, 0, 0);
      readline.clearScreenDown(output);
      return undefined;
    }
    if (!knownCommands.has(name) && !name.startsWith('-')) {
      ui.error(`unknown command '${name}' (type 'help' to see the commands)`);
      return undefined;
    }

    running = new AbortController();
    const { signal } = running;
    try {
      await runCommand(
        name === 'help' ? [...rest, '--help'] : args,
        {
          ...createRuntime(signal),
          confirm: (question) => ask(question, signal),
        },
        groups,
      );
    } finally {
      running = undefined;
    }
    return undefined;
  }

  output.write(`${renderBanner(pkg.version, ui.colors, unicode)}\n`);
  rl.prompt();
  for await (const line of rl) {
    exitArmed = false;
    if ((await execute(line)) === 'exit') {
      break;
    }
    rl.prompt();
  }
  rl.close();
  return 0;
}
