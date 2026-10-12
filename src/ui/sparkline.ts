const BARS = '▁▂▃▄▅▆▇█';

/** 값의 변화를 막대 문자 한 줄로 그립니다. 값이 없는 칸(응답 없음)은 lostMarker로 표시합니다. */
export function renderSparkline(
  values: readonly (number | undefined)[],
  lostMarker: string,
  maxLength = 60,
): string {
  const recent = values.slice(-maxLength);
  const numbers = recent.filter((value) => value !== undefined);
  const min = Math.min(...numbers);
  const span = Math.max(...numbers) - min;
  return recent
    .map((value) => {
      if (value === undefined) {
        return lostMarker;
      }
      const level = span === 0 ? 0 : Math.round(((value - min) / span) * (BARS.length - 1));
      return BARS.charAt(level);
    })
    .join('');
}
