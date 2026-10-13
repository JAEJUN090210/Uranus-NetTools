import { describe, expect, it } from 'vitest';

import { isLocallyAdministered, normalizeMac, vendorOf } from '../../../src/core/sweep/oui';

describe('normalizeMac', () => {
  it.each([
    ['aa:bb:cc:dd:ee:ff', 'AABBCCDDEEFF'],
    ['AA-BB-CC-DD-EE-FF', 'AABBCCDDEEFF'],
    ['aabb.ccdd.eeff', 'AABBCCDDEEFF'],
  ])('%s', (mac, hex) => {
    expect(normalizeMac(mac)).toBe(hex);
  });
});

describe('vendorOf', () => {
  it('finds a 24-bit (MA-L) vendor', () => {
    // E4:5F:01 은 Raspberry Pi 입니다.
    expect(vendorOf('E4:5F:01:DA:54:99')).toMatch(/Raspberry Pi/);
  });

  it('finds a well-known vendor', () => {
    expect(vendorOf('00:1A:11:00:00:01')).toMatch(/Google/);
  });

  it('has no vendor for an unregistered prefix', () => {
    expect(vendorOf('02:00:00:00:00:00')).toBeUndefined();
  });

  it('needs at least a full OUI', () => {
    expect(vendorOf('E4:5F')).toBeUndefined();
  });
});

describe('isLocallyAdministered', () => {
  it.each([
    ['E4:5F:01:DA:54:99', false], // 전역 고유(제조사) 주소
    ['32:25:D9:E3:1A:E7', true], // 무작위(사생활 보호) 주소
    ['02:00:00:00:00:00', true],
  ])('%s -> %s', (mac, expected) => {
    expect(isLocallyAdministered(mac)).toBe(expected);
  });
});
