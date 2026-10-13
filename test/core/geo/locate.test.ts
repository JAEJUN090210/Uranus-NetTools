import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLocator, type LocateOptions } from '../../../src/core/geo/locate';
import { freeIpApi, geoJs } from '../../../src/core/geo/providers';
import { freeIpApiGoogle, geoJsGoogle } from '../../fixtures/geo';
import { serveJson } from '../../helpers/lookup';

let base = '';
let close: () => Promise<void> = () => Promise.resolve();
const requested: string[] = [];
const options: LocateOptions = {
  signal: new AbortController().signal,
  timeoutMs: 5000,
  onRequest: (url) => {
    requested.push(url.replace(base, ''));
  },
};

beforeAll(async () => {
  const server = await serveJson(() => ({
    '/free/8.8.8.8': { body: freeIpApiGoogle },
    '/free/1.1.1.1': { status: 429, body: { message: 'Too many requests' } },
    '/geojs/1.1.1.1.json': { body: { ...geoJsGoogle, ip: '1.1.1.1' } },
    '/free/9.9.9.9': { status: 503, body: {} },
    '/geojs/9.9.9.9.json': { status: 500, body: {} },
  }));
  base = server.base;
  close = server.close;
});

afterAll(async () => {
  await close();
});

function locator() {
  requested.length = 0;
  return createLocator([freeIpApi(`${base}/free/`), geoJs(`${base}/geojs/`)]);
}

describe('createLocator', () => {
  it('uses the first service that knows the location', async () => {
    const located = await locator()('8.8.8.8', options);

    expect(located).toMatchObject({ source: 'freeipapi.com', location: { city: 'Mountain View' } });
    expect(requested).toEqual(['/free/8.8.8.8']);
  });

  it('falls back to the next service when the first one limits requests', async () => {
    const located = await locator()('1.1.1.1', options);

    expect(located.source).toBe('geojs.io');
    expect(requested).toEqual(['/free/1.1.1.1', '/geojs/1.1.1.1.json']);
  });

  it('limits how many requests run at once', async () => {
    let active = 0;
    let peak = 0;
    const slowFetch: typeof fetch = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return new Response(JSON.stringify(freeIpApiGoogle), { status: 200 });
    };
    const locate = createLocator([freeIpApi('https://geo.example/')], 2);

    const results = await Promise.all(
      ['1.0.0.1', '1.0.0.2', '1.0.0.3', '1.0.0.4', '1.0.0.5'].map((address) =>
        locate(address, { ...options, fetch: slowFetch }),
      ),
    );

    expect(results).toHaveLength(5);
    expect(peak).toBe(2);
  });

  it('explains why every service failed', async () => {
    await expect(locator()('9.9.9.9', options)).rejects.toThrow(
      'cannot locate 9.9.9.9 (freeipapi.com: HTTP 503; geojs.io: HTTP 500)',
    );
  });
});
