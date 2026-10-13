import { PassThrough } from 'node:stream';

import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import type { Runtime } from '../../src/cli/runtime';
import { startShell } from '../../src/repl/shell';
import { Output } from '../../src/ui/output';

const CTRL_C = '\u0003';

function createShell({ terminal = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let screen = '';
  output.on('data', (chunk: Buffer) => {
    screen += chunk.toString();
  });

  const waiting = Promise.withResolvers<undefined>();
  const asking = Promise.withResolvers<undefined>();
  const groups: readonly CommandGroup[] = [
    {
      heading: 'Testing:',
      commands: [
        (runtime) =>
          new Command('echo').argument('<text>').action((text: string) => {
            new Output(runtime).success(text);
          }),
        (runtime) =>
          new Command('wait').action(async () => {
            waiting.resolve(undefined);
            await new Promise((resolve) => {
              runtime.signal.addEventListener('abort', resolve, { once: true });
            });
            new Output(runtime).summary('stopped');
          }),
        (runtime) =>
          new Command('ask').action(async () => {
            asking.resolve(undefined);
            const yes = await runtime.confirm?.('Continue? [y/N] ');
            new Output(runtime).success(`answer: ${yes === true ? 'yes' : 'no'}`);
          }),
      ],
    },
  ];
  const createRuntime = (signal: AbortSignal): Runtime => ({
    stdout: output,
    stderr: output,
    env: {},
    platform: 'linux',
    signal,
    exitCode: 0,
  });

  const done = startShell({ input, output, createRuntime, groups, terminal });
  return {
    input,
    done,
    waiting: waiting.promise,
    asking: asking.promise,
    screen: () => screen,
  };
}

describe('startShell', () => {
  it('shows the banner and runs commands until exit', async () => {
    const shell = createShell();

    shell.input.write('echo hello\nexit\n');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain('NetTools v');
    expect(shell.screen()).toContain('unt ❯ ');
    expect(shell.screen()).toContain('✔ hello');
  });

  it('shows help for the whole program or a single command', async () => {
    const shell = createShell();

    shell.input.write('help\nhelp echo\nquit\n');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain('Usage: unt [options]');
    expect(shell.screen()).toContain('Usage: unt echo');
  });

  it('keeps running after unknown commands, bad input and command errors', async () => {
    const shell = createShell();

    shell.input.write('nope\necho "oops\necho\necho "still alive"\nexit\n');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain("unknown command 'nope'");
    expect(shell.screen()).toContain('unterminated double quote');
    expect(shell.screen()).toContain("missing required argument 'text'");
    expect(shell.screen()).toContain('✔ still alive');
  });

  it('exits at the end of input', async () => {
    const shell = createShell();

    shell.input.end('echo bye\n');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain('✔ bye');
  });

  it('cancels only the running command on Ctrl+C', async () => {
    const shell = createShell({ terminal: true });

    shell.input.write('wait\r');
    await shell.waiting;
    shell.input.write(CTRL_C);
    shell.input.write('echo after\r');
    shell.input.write('exit\r');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain('▸ stopped');
    expect(shell.screen()).toContain('✔ after');
  });

  // 질문이 나오기 전에 입력한 줄은 질문이 아니라 다음 명령으로 가므로, 답마다 셸을 새로 엽니다.
  it.each([
    ['y', 'yes'],
    ['', 'no'],
  ])('lets commands ask a yes/no question (answer %j)', async (answer, result) => {
    const shell = createShell();

    shell.input.write('ask\n');
    await shell.asking;
    shell.input.write(`${answer}\n`);
    shell.input.write('exit\n');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain('Continue? [y/N] ');
    expect(shell.screen()).toContain(`✔ answer: ${result}`);
  });

  it('cancels a question on Ctrl+C and keeps the shell running', async () => {
    const shell = createShell({ terminal: true });

    shell.input.write('ask\r');
    await shell.asking;
    shell.input.write(CTRL_C);
    shell.input.write('echo after\r');
    shell.input.write('exit\r');

    expect(await shell.done).toBe(0);
    expect(shell.screen()).not.toContain('answer:');
    expect(shell.screen()).toContain('✔ after');
  });

  it('exits when Ctrl+C is pressed twice on an empty line', async () => {
    const shell = createShell({ terminal: true });

    shell.input.write(CTRL_C);
    shell.input.write(CTRL_C);

    expect(await shell.done).toBe(0);
    expect(shell.screen()).toContain("press Ctrl+C again or type 'exit' to quit");
  });
});
