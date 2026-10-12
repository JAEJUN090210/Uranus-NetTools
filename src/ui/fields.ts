import type { Colors } from './colors';
import { displayWidth, padDisplay } from './width';

export type FieldValue = string | readonly string[] | undefined;
export type Field = readonly [label: string, value: FieldValue];

/** 이름과 값을 두 열로 맞춰 보여줍니다. 값이 없는 항목은 건너뛰고, 값이 여러 개면 줄을 나눠 씁니다. */
export function renderFields(fields: readonly Field[], colors: Colors): string {
  const present = fields.flatMap(([label, value]) => {
    const values = (typeof value === 'string' ? [value] : (value ?? [])).filter(
      (item) => item !== '',
    );
    return values.length === 0 ? [] : [{ label, values }];
  });
  const width = Math.max(0, ...present.map(({ label }) => displayWidth(label)));
  return present
    .flatMap(({ label, values }) =>
      values.map((value, index) => {
        const name = index === 0 ? colors.bold(padDisplay(label, width)) : ' '.repeat(width);
        return `${name}  ${value}`;
      }),
    )
    .join('\n');
}
