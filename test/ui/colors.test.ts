import { describe, expect, it } from 'vitest';

import { createColors, shouldUseColor } from '../../src/ui/colors';

const terminal = { write: () => undefined, isTTY: true, hasColors: () => true };
const pipe = { write: () => undefined };

describe('shouldUseColor', () => {
  it.each([
    ['a color terminal', terminal, {}, true],
    ['a pipe', pipe, {}, false],
    ['NO_COLOR', terminal, { NO_COLOR: '1' }, false],
    ['an empty NO_COLOR', terminal, { NO_COLOR: '' }, true],
    ['FORCE_COLOR on a pipe', pipe, { FORCE_COLOR: '1' }, true],
    ['FORCE_COLOR=0 on a terminal', terminal, { FORCE_COLOR: '0' }, false],
  ] as const)('%s → %s', (_name, stream, env, expected) => {
    expect(shouldUseColor(stream, env)).toBe(expected);
  });
});

describe('createColors', () => {
  it('wraps text in ANSI codes when enabled', () => {
    expect(createColors(true).red('x')).toBe('\u001b[31mx\u001b[39m');
  });

  it('leaves text untouched when disabled', () => {
    expect(createColors(false).red('x')).toBe('x');
  });
});
