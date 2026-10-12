import { describe, expect, it } from 'vitest';

import { tokenize } from '../../src/repl/tokenize';

describe('tokenize', () => {
  it.each([
    ['', []],
    ['ping 8.8.8.8', ['ping', '8.8.8.8']],
    ['  ping   -c 4  ', ['ping', '-c', '4']],
    ['http "https://example.com/a b"', ['http', 'https://example.com/a b']],
    [`echo 'say "hi"'`, ['echo', 'say "hi"']],
    ['echo "say \\"hi\\""', ['echo', 'say "hi"']],
    ['echo "a\\\\b"', ['echo', 'a\\b']],
    ['echo C:\\Users\\me', ['echo', 'C:\\Users\\me']],
    ['echo ""', ['echo', '']],
    ['echo a"b c"d', ['echo', 'ab cd']],
  ])('%j → %j', (line, tokens) => {
    expect(tokenize(line)).toEqual(tokens);
  });

  it.each([
    ['echo "oops', 'unterminated double quote'],
    ["echo 'oops", 'unterminated single quote'],
  ])('rejects %j', (line, message) => {
    expect(() => tokenize(line)).toThrow(message);
  });
});
