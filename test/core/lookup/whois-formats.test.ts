import { describe, expect, it } from 'vitest';

import { formatWhoisQuery, parseWhoisDomain } from '../../../src/core/lookup/whois';
import { denicWhois, jprsWhois } from '../../fixtures/whois';

describe('parseWhoisDomain with registry-specific formats', () => {
  it('reads the bracketed labels of JPRS (.jp)', () => {
    expect(parseWhoisDomain(jprsWhois, 'jprs.jp')).toEqual({
      domain: 'jprs.jp',
      registrant: 'Japan Registry Services Co.,Ltd.',
      created: '2001-02-02',
      updated: '2026-03-01',
      expires: '2027-02-28',
      status: ['Active'],
      nameservers: ['ns1.jprs.jp', 'ns2.jprs.jp'],
      dnssec: true,
    });
  });

  it('reads DENIC (.de) and treats a DNS key as signed', () => {
    expect(parseWhoisDomain(denicWhois, 'denic.de')).toEqual({
      domain: 'denic.de',
      updated: '2024-12-19T12:33:43.000Z',
      status: ['connect'],
      nameservers: ['ns1.denic.de', 'ns4.denic.net'],
      dnssec: true,
    });
  });
});

describe('formatWhoisQuery', () => {
  it.each([
    ['whois.jprs.jp', 'jprs.jp/e'],
    ['WHOIS.DENIC.DE', '-T dn jprs.jp'],
    ['whois.nic.io', 'jprs.jp'],
  ])('asks %s for %j', (server, query) => {
    expect(formatWhoisQuery(server, 'jprs.jp')).toBe(query);
  });
});
