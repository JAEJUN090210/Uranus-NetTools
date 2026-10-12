import { describe, expect, it } from 'vitest';

import { isReservedAddress } from '../../../src/core/lookup/reserved';
import { parseLookupTarget } from '../../../src/core/lookup/target';

describe('parseLookupTarget', () => {
  it.each([
    ['example.com', { kind: 'domain', name: 'example.com', unicode: 'example.com' }],
    ['Example.COM.', { kind: 'domain', name: 'example.com', unicode: 'example.com' }],
    [
      'https://www.Example.com/path?q=1',
      { kind: 'domain', name: 'www.example.com', unicode: 'www.example.com' },
    ],
    ['한국.kr', { kind: 'domain', name: 'xn--3e0b707e.kr', unicode: '한국.kr' }],
    ['8.8.8.8', { kind: 'ip', address: '8.8.8.8', family: 4 }],
    ['[2001:4860:4860::8888]', { kind: 'ip', address: '2001:4860:4860::8888', family: 6 }],
    ['http://[2001:db8::1]:8080/', { kind: 'ip', address: '2001:db8::1', family: 6 }],
    ['AS15169', { kind: 'asn', number: 15169 }],
    ['as13335', { kind: 'asn', number: 13335 }],
  ])('%j', (input, expected) => {
    expect(parseLookupTarget(input)).toEqual(expected);
  });

  it.each(['localhost', 'not a domain', 'AS99999999999'])('rejects %j', (input) => {
    expect(() => parseLookupTarget(input)).toThrow();
  });
});

describe('isReservedAddress', () => {
  it.each([
    ['10.1.2.3', 4, true],
    ['192.168.0.1', 4, true],
    ['127.0.0.1', 4, true],
    ['100.64.0.1', 4, true],
    ['8.8.8.8', 4, false],
    ['::1', 6, true],
    ['fe80::1', 6, true],
    ['fd00::1', 6, true],
    ['2001:4860:4860::8888', 6, false],
  ] as const)('%s → %s', (address, family, expected) => {
    expect(isReservedAddress(address, family)).toBe(expected);
  });
});
