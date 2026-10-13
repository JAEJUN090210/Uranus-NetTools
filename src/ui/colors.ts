import { styleText } from 'node:util';

import type { TextStream } from '../cli/runtime';

type Format = Parameters<typeof styleText>[0];

export interface Colors {
  readonly enabled: boolean;
  readonly green: (text: string) => string;
  readonly red: (text: string) => string;
  readonly yellow: (text: string) => string;
  readonly cyan: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly bold: (text: string) => string;
}

/** FORCE_COLOR와 NO_COLOR 환경 변수를 먼저 보고, 없으면 출력 대상이 색을 지원하는 터미널인지 확인합니다. */
export function shouldUseColor(stream: TextStream, env: NodeJS.ProcessEnv): boolean {
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    return force !== '0' && force !== 'false';
  }
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  return stream.isTTY === true && stream.hasColors?.() === true;
}

export function createColors(enabled: boolean): Colors {
  const paint = (format: Format) => (text: string) =>
    enabled ? styleText(format, text, { validateStream: false }) : text;
  return {
    enabled,
    green: paint('green'),
    red: paint('red'),
    yellow: paint('yellow'),
    cyan: paint('cyan'),
    dim: paint('dim'),
    bold: paint('bold'),
  };
}
