import { describe, expect, it } from 'vitest';

import { getSymbols, supportsUnicode } from '../../src/ui/symbols';

describe('supportsUnicode', () => {
  it.each([
    ['linux', {}, true],
    ['linux', { TERM: 'linux' }, false],
    ['darwin', {}, true],
    ['win32', {}, false],
    ['win32', { WT_SESSION: 'abc' }, true],
    ['win32', { TERM_PROGRAM: 'vscode' }, true],
    ['win32', { MSYSTEM: 'MINGW64' }, true],
  ] as const)('%s with %j → %s', (platform, env, expected) => {
    expect(supportsUnicode(env, platform)).toBe(expected);
  });
});

describe('getSymbols', () => {
  it('falls back to ASCII', () => {
    expect(getSymbols(false)).toMatchObject({ success: '[OK]', failure: '[FAIL]', prompt: '>' });
  });

  it('uses Unicode symbols when supported', () => {
    expect(getSymbols(true)).toMatchObject({ success: '✔', failure: '✖', prompt: '❯' });
  });
});
