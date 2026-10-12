import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createProgram } from '../../src/cli/program';
import { createCompleter } from '../../src/repl/completer';
import { createTestRuntime } from '../helpers/runtime';

const program = createProgram(createTestRuntime().runtime, [
  {
    heading: 'Testing:',
    commands: [
      () => new Command('echo').alias('say').option('-c, --count <n>', 'repeat count'),
      () => new Command('scan'),
    ],
  },
]);
const complete = createCompleter(program);

describe('createCompleter', () => {
  it('completes command names and shell commands for the first word', () => {
    expect(complete('')).toEqual([['clear', 'echo', 'exit', 'help', 'quit', 'say', 'scan'], '']);
    expect(complete('ec')).toEqual([['echo'], 'ec']);
    expect(complete('  s')).toEqual([['say', 'scan'], 's']);
  });

  it('completes options of the command and global options', () => {
    expect(complete('echo hi --c')).toEqual([['--count'], '--c']);
    expect(complete('say --j')).toEqual([['--json'], '--j']);
    expect(complete('scan -')[0]).toEqual(
      expect.arrayContaining(['--help', '--json', '--quiet', '--verbose']),
    );
  });

  it('completes command names after help', () => {
    expect(complete('help sc')).toEqual([['scan'], 'sc']);
  });

  it('offers nothing for plain arguments', () => {
    expect(complete('echo hel')).toEqual([[], 'hel']);
  });
});
