import { describe, expect, it } from 'vitest';

import { displayWidth, padDisplay, truncateDisplay } from '../../src/ui/width';

describe('displayWidth', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['한글', 4],
    ['a한b', 4],
    ['\u001b[31mred\u001b[39m', 3],
    ['✔', 1],
    ['✅', 2],
    ['👨‍👩‍👧', 2],
  ])('%j → %i', (text, width) => {
    expect(displayWidth(text)).toBe(width);
  });
});

describe('padDisplay', () => {
  it('pads by display width, not string length', () => {
    expect(padDisplay('한', 4)).toBe('한  ');
  });

  it('pads on the left for right alignment', () => {
    expect(padDisplay('7', 3, 'right')).toBe('  7');
  });
});

describe('truncateDisplay', () => {
  it('keeps text that fits', () => {
    expect(truncateDisplay('abc', 3)).toBe('abc');
  });

  it('cuts by display width and ends with an ellipsis', () => {
    expect(truncateDisplay('abcdef', 4)).toBe('abc…');
    expect(truncateDisplay('한글자막', 5)).toBe('한글…');
    expect(truncateDisplay('abcdef', 5, '...')).toBe('ab...');
  });
});
