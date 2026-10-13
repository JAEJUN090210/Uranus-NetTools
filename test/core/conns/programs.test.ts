import { describe, expect, it } from 'vitest';

import { parsePs, parseTasklist } from '../../../src/core/conns/programs';

describe('parseTasklist', () => {
  const output = [
    '"System Idle Process","0","Services","0","8 K"',
    '"mysqld.exe","15588","Services","0","512,000 K"',
    '"chrome.exe","11016","Console","1","123,456 K"',
  ].join('\r\n');

  it('maps process numbers to program names', () => {
    const programs = parseTasklist(output);

    expect(programs.get(15588)).toBe('mysqld.exe');
    expect(programs.get(11016)).toBe('chrome.exe');
    expect(programs.get(0)).toBe('System Idle Process');
  });

  it('ignores lines that are not CSV rows', () => {
    expect(parseTasklist('no rows here').size).toBe(0);
  });
});

describe('parsePs', () => {
  const output = ['  800 /usr/sbin/sshd', ' 1234 nginx', '  450 /usr/bin/python3'].join('\n');

  it('maps process numbers to the program name without its path', () => {
    const programs = parsePs(output);

    expect(programs.get(800)).toBe('sshd');
    expect(programs.get(1234)).toBe('nginx');
    expect(programs.get(450)).toBe('python3');
  });

  it('ignores blank and malformed lines', () => {
    expect(parsePs('\n   \nnot-a-pid name\n').size).toBe(0);
  });
});
