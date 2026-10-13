import { describe, expect, it } from 'vitest';

import { findPublicIp, PUBLIC_IP_URL } from '../../../src/core/local/public-ip';
import { serveJson } from '../../helpers/lookup';

const signal = new AbortController().signal;

describe('PUBLIC_IP_URL', () => {
  it('points at the keyless GeoJS endpoint over HTTPS', () => {
    expect(PUBLIC_IP_URL).toBe('https://get.geojs.io/v1/ip.json');
  });
});

describe('findPublicIp', () => {
  it('reads the address out of the answer', async () => {
    const fake = await serveJson(() => ({ '/ip': { body: { ip: '203.0.113.7' } } }));
    try {
      expect(await findPublicIp({ signal, timeoutMs: 2000, url: `${fake.base}/ip` })).toBe(
        '203.0.113.7',
      );
    } finally {
      await fake.close();
    }
  });

  it('accepts an IPv6 answer with spaces around it', async () => {
    const fake = await serveJson(() => ({ '/ip': { body: { ip: ' 2001:db8::1 ' } } }));
    try {
      expect(await findPublicIp({ signal, timeoutMs: 2000, url: `${fake.base}/ip` })).toBe(
        '2001:db8::1',
      );
    } finally {
      await fake.close();
    }
  });

  it.each([
    ['nothing useful', { body: { ip: 'not-an-address' } }],
    ['no ip field', { body: { other: 1 } }],
  ])('complains when the service answers %s', async (_label, route) => {
    const fake = await serveJson(() => ({ '/ip': route }));
    try {
      await expect(
        findPublicIp({ signal, timeoutMs: 2000, url: `${fake.base}/ip` }),
      ).rejects.toThrow('did not answer with an address');
    } finally {
      await fake.close();
    }
  });
});
