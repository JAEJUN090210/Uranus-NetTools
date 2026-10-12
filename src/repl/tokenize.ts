import { UserError } from '../cli/errors';

/**
 * 셸처럼 입력 줄을 인자로 나눕니다.
 * 작은따옴표 안은 글자 그대로, 큰따옴표 안에서는 \" 와 \\ 만 해석합니다.
 * Windows 경로를 그대로 쓸 수 있도록 따옴표 밖의 역슬래시는 일반 글자로 취급합니다.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index);
    if (quote === "'") {
      if (char === "'") {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (quote === '"') {
      const next = line.charAt(index + 1);
      if (char === '"') {
        quote = undefined;
      } else if (char === '\\' && (next === '"' || next === '\\')) {
        current += next;
        index++;
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
      inToken = true;
    } else if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
    } else {
      current += char;
      inToken = true;
    }
  }

  if (quote !== undefined) {
    throw new UserError(`unterminated ${quote === '"' ? 'double' : 'single'} quote`);
  }
  if (inToken) {
    tokens.push(current);
  }
  return tokens;
}
