import type { Colors } from './colors';
import { displayWidth, padDisplay } from './width';

export interface Column<Row> {
  readonly header: string;
  readonly value: (row: Row) => string;
  readonly align?: 'left' | 'right';
}

const GAP = '  ';

/** 테두리 없이 열 사이를 두 칸씩 띄운 표를 만듭니다. 헤더는 굵게 표시합니다. */
export function renderTable<Row>(
  rows: readonly Row[],
  columns: readonly Column<Row>[],
  colors: Colors,
): string {
  const body = rows.map((row) => columns.map((column) => column.value(row)));
  const widths = columns.map((column, index) =>
    Math.max(displayWidth(column.header), ...body.map((cells) => displayWidth(cells[index] ?? ''))),
  );
  const format = (cells: readonly string[]) =>
    cells
      .map((cell, index) => padDisplay(cell, widths[index] ?? 0, columns[index]?.align))
      .join(GAP)
      .trimEnd();
  return [colors.bold(format(columns.map((column) => column.header))), ...body.map(format)].join(
    '\n',
  );
}
