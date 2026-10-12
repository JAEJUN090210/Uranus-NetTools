import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };
import { UserError } from '../../src/cli/errors';
import type { CommandGroup } from '../../src/cli/program';
import { EXIT_INTERRUPTED, runCommand } from '../../src/cli/run';
import { Output } from '../../src/ui/output';
import { createTestRuntime, type TestRuntimeOptions } from '../helpers/runtime';

const groups: readonly CommandGroup[] = [
  {
    heading: 'Testing:',
    commands: [
      (runtime) =>
        new Command('echo')
          .description('print the text back')
          .argument('<text>')
          .action((text: string, _options: unknown, command: Command) => {
            const output = new Output(runtime, command.optsWithGlobals());
            output.result({ text }, () => {
              output.success(text);
              output.hint('done');
            });
            output.debug('echo finished');
          }),
      () =>
        new Command('fail').action(() => {
          throw new UserError('host not found');
        }),
      () =>
        new Command('crash').action(() => {
          throw new Error('boom');
        }),
      () =>
        new Command('cancel').action(() => {
          throw new DOMException('cancelled', 'AbortError');
        }),
      (runtime) =>
        new Command('partial').action(() => {
          runtime.exitCode = 2;
        }),
    ],
  },
];

async function run(args: string[], options?: TestRuntimeOptions) {
  const { runtime, stdout, stderr } = createTestRuntime(options);
  const code = await runCommand(args, runtime, groups);
  return { code, stdout: stdout(), stderr: stderr() };
}

describe('runCommand', () => {
  it('prints the package version for --version', async () => {
    const { code, stdout } = await run(['--version']);

    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('groups commands and lists the global options in --help', async () => {
    const { code, stdout } = await run(['--help']);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage: unt');
    expect(stdout).toContain('Testing:');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--quiet');
    expect(stdout).toContain('--verbose');
  });

  it('prints human-readable output by default', async () => {
    const { code, stdout } = await run(['echo', 'hello']);

    expect(code).toBe(0);
    expect(stdout).toBe('✔ hello\ndone\n');
  });

  it.each([{ args: ['--json', 'echo', 'hello'] }, { args: ['echo', 'hello', '--json'] }])(
    'accepts global options anywhere: $args',
    async ({ args }) => {
      const { stdout } = await run(args);

      expect(JSON.parse(stdout) as unknown).toEqual({ text: 'hello' });
    },
  );

  it('hides hints with --quiet', async () => {
    const { stdout } = await run(['echo', 'hello', '--quiet']);

    expect(stdout).toBe('✔ hello\n');
  });

  it('prints debug messages to stderr with --verbose', async () => {
    const { stdout, stderr } = await run(['echo', 'hello', '--verbose']);

    expect(stdout).toBe('✔ hello\ndone\n');
    expect(stderr).toBe('debug: echo finished\n');
  });

  it('rejects --quiet together with --verbose', async () => {
    const { code, stderr } = await run(['echo', 'hello', '--quiet', '--verbose']);

    expect(code).toBe(1);
    expect(stderr).toContain('cannot be used with');
  });

  it('reports a missing argument of a subcommand without exiting the process', async () => {
    const { code, stderr } = await run(['echo']);

    expect(code).toBe(1);
    expect(stderr).toContain("missing required argument 'text'");
  });

  it('prints user errors without a stack trace', async () => {
    const { code, stderr } = await run(['fail']);

    expect(code).toBe(1);
    expect(stderr).toBe('✖ host not found\n');
  });

  it('prints errors as JSON with --json', async () => {
    const { stderr } = await run(['fail', '--json']);

    expect(stderr).toBe('{"error":"host not found"}\n');
  });

  it('shows the stack trace of unexpected errors only with --verbose', async () => {
    const quiet = await run(['crash']);
    const verbose = await run(['crash', '--verbose']);

    expect(quiet.stderr).toBe('✖ boom\n');
    expect(verbose.stderr).toContain('debug: Error: boom');
  });

  it('returns the interrupted exit code when a command is cancelled', async () => {
    const { code, stderr } = await run(['cancel']);

    expect(code).toBe(EXIT_INTERRUPTED);
    expect(stderr).toBe('');
  });

  it('returns the exit code a command sets', async () => {
    const { code } = await run(['partial']);

    expect(code).toBe(2);
  });
});
