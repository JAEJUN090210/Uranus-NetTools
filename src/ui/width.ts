import { stripVTControlCharacters } from 'node:util';

const segmenter = new Intl.Segmenter();

// 동아시아 문자(한글, 한자, 가나, 전각 기호)는 터미널에서 두 칸을 차지합니다.
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];

// ✔ 같은 기호는 한 칸이지만, 기본이 그림 이모지인 문자나 변형 선택자(U+FE0F)가 붙은 문자는 두 칸입니다.
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}|️/u;

function graphemeWidth(grapheme: string): number {
  const codePoint = grapheme.codePointAt(0) ?? 0;
  if (codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }
  if (EMOJI_PRESENTATION.test(grapheme)) {
    return 2;
  }
  return WIDE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end) ? 2 : 1;
}

/** 터미널에 표시했을 때 차지하는 칸 수를 셉니다. 색상 코드는 무시합니다. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const { segment } of segmenter.segment(stripVTControlCharacters(text))) {
    width += graphemeWidth(segment);
  }
  return width;
}

export function padDisplay(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const padding = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return align === 'left' ? text + padding : padding + text;
}
