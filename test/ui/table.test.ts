import { describe, expect, it } from 'vitest';

import { createColors } from '../../src/ui/colors';
import { renderTable } from '../../src/ui/table';

const plain = createColors(false);

describe('renderTable', () => {
  it('aligns columns and trims trailing spaces', () => {
    const rows = [
      { port: 22, state: 'open', service: 'ssh' },
      { port: 8080, state: 'filtered', service: 'http-proxy' },
    ];

    const table = renderTable(
      rows,
      [
        { header: 'PORT', value: (row) => String(row.port), align: 'right' },
        { header: 'STATE', value: (row) => row.state },
        { header: 'SERVICE', value: (row) => row.service },
      ],
      plain,
    );

    expect(table).toBe(
      ['PORT  STATE     SERVICE', '  22  open      ssh', '8080  filtered  http-proxy'].join('\n'),
    );
  });

  it('counts Korean characters as two columns wide', () => {
    const table = renderTable(
      [
        { name: '한글', value: '1' },
        { name: 'abc', value: '2' },
      ],
      [
        { header: 'NAME', value: (row) => row.name },
        { header: 'VALUE', value: (row) => row.value },
      ],
      plain,
    );

    expect(table).toBe(['NAME  VALUE', '한글  1', 'abc   2'].join('\n'));
  });

  it('prints only the header when there are no rows', () => {
    expect(renderTable([], [{ header: 'HOST', value: (row: string) => row }], plain)).toBe('HOST');
  });
});
