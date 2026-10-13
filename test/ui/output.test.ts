import { styleText } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Output } from '../../src/ui/output';
import { createTestRuntime } from '../helpers/runtime';

describe('Output', () => {
  it('prints JSON instead of the human-readable rendering with --json', () => {
    const { runtime, stdout } = createTestRuntime();
    const output = new Output(runtime, { json: true });

    output.result({ ok: true }, () => {
      output.line('human');
    });
    output.success('ignored');

    expect(stdout()).toBe('{\n  "ok": true\n}\n');
  });

  it('uses ASCII symbols on consoles without Unicode glyphs', () => {
    const { runtime, stdout } = createTestRuntime({ platform: 'win32' });
    const output = new Output(runtime);

    output.success('up');
    output.failure('down');
    output.summary('1 of 2 up');

    expect(stdout()).toBe('[OK] up\n[FAIL] down\n> 1 of 2 up\n');
  });

  it('colors symbols on a color terminal', () => {
    const { runtime, stdout } = createTestRuntime({ tty: true });

    new Output(runtime).success('up');

    expect(stdout()).toBe(`${styleText('green', '✔', { validateStream: false })} up\n`);
  });

  it('keeps results but drops hints with --quiet', () => {
    const { runtime, stdout } = createTestRuntime();
    const output = new Output(runtime, { quiet: true });

    output.hint('press Ctrl+C to stop');
    output.summary('done');

    expect(stdout()).toBe('▸ done\n');
  });

  it('sends warnings, errors and debug messages to stderr', () => {
    const { runtime, stdout, stderr } = createTestRuntime();
    const output = new Output(runtime, { verbose: true });

    output.debug('running ping -c 4');
    output.warn('slow response');
    output.error('host not found');

    expect(stdout()).toBe('');
    expect(stderr()).toBe('debug: running ping -c 4\n⚠ slow response\n✖ host not found\n');
  });

  it('renders tables to stdout', () => {
    const { runtime, stdout } = createTestRuntime();

    new Output(runtime).table([{ host: 'a' }], [{ header: 'HOST', value: (row) => row.host }]);

    expect(stdout()).toBe('HOST\na\n');
  });
});
