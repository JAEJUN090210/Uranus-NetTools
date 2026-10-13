import { describe, expect, it } from 'vitest';

import {
  lookupAsn,
  originQueryName,
  parseAsName,
  parseOrigin,
} from '../../../src/core/lookup/cymru';
import { expandIpv6, ptrQueryName } from '../../../src/core/lookup/reverse-name';

function missing(): Promise<never> {
  return Promise.reject(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
}

describe('expandIpv6', () => {
  it.each([
    ['2001:db8::1', '20010db8000000000000000000000001'],
    ['::1', '00000000000000000000000000000001'],
    ['2001:4860:4860::8888', '20014860486000000000000000008888'],
    ['::ffff:192.0.2.1', '00000000000000000000ffffc0000201'],
    ['fe80::1%12', 'fe800000000000000000000000000001'],
    ['2001:DB8:0:0:0:0:0:1', '20010db8000000000000000000000001'],
  ])('%s → %s', (address, expanded) => {
    expect(expandIpv6(address)).toBe(expanded);
  });
});

describe('ptrQueryName', () => {
  it('builds reverse DNS names for both address families', () => {
    expect(ptrQueryName('8.8.4.4', 4)).toBe('4.4.8.8.in-addr.arpa');
    expect(ptrQueryName('2001:db8::1', 6)).toBe(`1.${'0.'.repeat(23)}8.b.d.0.1.0.0.2.ip6.arpa`);
  });
});

describe('originQueryName', () => {
  it('reverses the octets of an IPv4 address', () => {
    expect(originQueryName('1.2.3.4', 4)).toBe('4.3.2.1.origin.asn.cymru.com');
  });

  it('reverses the nibbles of an IPv6 address', () => {
    expect(originQueryName('2001:4860:4860::8888', 6)).toBe(
      `${'8.'.repeat(4)}${'0.'.repeat(17)}6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com`,
    );
  });
});

describe('parseOrigin and parseAsName', () => {
  it('reads every AS number and the prefix', () => {
    expect(parseOrigin('13335 209242 | 1.1.1.0/24 | AU | apnic | 2011-08-11')).toEqual({
      asns: [13335, 209242],
      prefix: '1.1.1.0/24',
      country: 'AU',
      registry: 'apnic',
      allocated: '2011-08-11',
    });
    expect(parseOrigin('')).toBeUndefined();
  });

  it('reads the AS name', () => {
    expect(parseAsName('15169 | US | arin | 2000-03-30 | GOOGLE, US')).toBe('GOOGLE, US');
    expect(parseAsName('15169 | US')).toBeUndefined();
  });
});

describe('lookupAsn', () => {
  it('picks the most specific prefix and adds the AS name', async () => {
    const asked: string[] = [];
    const info = await lookupAsn('8.8.8.8', 4, (name) => {
      asked.push(name);
      if (name === 'AS15169.asn.cymru.com') {
        return Promise.resolve([['15169 | US | arin | 2000-03-30 | GOOGLE, US']]);
      }
      return Promise.resolve([
        ['3356 | 8.0.0.0/9 | US | arin | 1992-12-01'],
        ['15169 | 8.8.8.0/24 | US | arin | 2023-12-28'],
      ]);
    });

    expect(info).toEqual({
      asn: 15169,
      otherAsns: [],
      name: 'GOOGLE, US',
      prefix: '8.8.8.0/24',
      country: 'US',
      registry: 'arin',
      allocated: '2023-12-28',
    });
    expect(asked).toEqual(['8.8.8.8.origin.asn.cymru.com', 'AS15169.asn.cymru.com']);
  });

  it('returns nothing for an address that is not announced', async () => {
    expect(await lookupAsn('8.8.8.8', 4, missing)).toBeUndefined();
  });

  it('keeps the AS number when the name lookup fails', async () => {
    const info = await lookupAsn('8.8.8.8', 4, (name) =>
      name.startsWith('AS')
        ? Promise.reject(new Error('timeout'))
        : Promise.resolve([['15169 | 8.8.8.0/24 | US | arin | 2023-12-28']]),
    );

    expect(info).toMatchObject({ asn: 15169 });
    expect(info?.name).toBeUndefined();
  });
});
