import { describe, expect, it } from 'vitest';

import pkg from '../../package.json' with { type: 'json' };
import { createProgram } from '../../src/cli/program';

async function run(args: string[]) {
  let output = '';
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: (text) => {
        output += text;
      },
    });
  const error = await program.parseAsync(args, { from: 'user' }).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return { output, error };
}

describe('createProgram', () => {
  it('prints the package version for --version', async () => {
    const { output, error } = await run(['--version']);

    expect(error).toMatchObject({ code: 'commander.version' });
    expect(output.trim()).toBe(pkg.version);
  });

  it('shows usage for the unt command in --help', async () => {
    const { output, error } = await run(['--help']);

    expect(error).toMatchObject({ code: 'commander.helpDisplayed' });
    expect(output).toContain('Usage: unt');
  });
});
