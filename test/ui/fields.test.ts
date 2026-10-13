import { describe, expect, it } from 'vitest';

import { createColors } from '../../src/ui/colors';
import { renderFields } from '../../src/ui/fields';

describe('renderFields', () => {
  it('aligns values, skips empty ones and puts each of several values on its own line', () => {
    const text = renderFields(
      [
        ['Domain', 'example.com'],
        ['Registrant', undefined],
        ['Status', []],
        ['Name servers', ['a.iana-servers.net', 'b.iana-servers.net']],
        ['Note', ''],
      ],
      createColors(false),
    );

    expect(text).toBe(
      [
        'Domain        example.com',
        'Name servers  a.iana-servers.net',
        '              b.iana-servers.net',
      ].join('\n'),
    );
  });

  it('returns nothing when every value is empty', () => {
    expect(renderFields([['Domain', undefined]], createColors(false))).toBe('');
  });
});
