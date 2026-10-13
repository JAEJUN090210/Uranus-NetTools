import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDnsTools, type DohServer, parseTxtData } from '../../../src/core/lookup/dns';
import { serveJson } from '../../helpers/lookup';

describe('parseTxtData', () => {
  it.each([
    [
      '"15169 | 8.8.8.0/24 | US | arin | 2023-12-28"',
      ['15169 | 8.8.8.0/24 | US | arin | 2023-12-28'],
    ],
    ['"part one" "part two"', ['part one', 'part two']],
    ['"say \\"hi\\""', ['say "hi"']],
    ['unquoted', ['unquoted']],
  ])('%j', (data, chunks) => {
    expect(parseTxtData(data)).toEqual(chunks);
  });
});

describe('createDnsTools when the system DNS servers are unreachable', () => {
  let doh: DohServer = { name: 'local-doh', url: () => '' };
  let close: () => Promise<void> = () => Promise.resolve();
  const fallbacks: string[] = [];

  beforeAll(async () => {
    const server = await serveJson(() => ({
      '/resolve?name=8.8.8.8.origin.asn.cymru.com&type=TXT': {
        body: {
          Status: 0,
          Answer: [
            { type: 5, data: 'alias.example.' },
            { type: 16, data: '"15169 | 8.8.8.0/24 | US | arin | 2023-12-28"' },
          ],
        },
      },
      '/resolve?name=8.8.8.8.in-addr.arpa&type=PTR': {
        body: { Status: 0, Answer: [{ type: 12, data: 'dns.google.' }] },
      },
      '/resolve?name=missing.example&type=TXT': { body: { Status: 3 } },
    }));
    close = server.close;
    doh = {
      name: 'local-doh',
      url: (name, type) => `${server.base}/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    };
  });

  afterAll(async () => {
    await close();
  });

  // 닫힌 로컬 포트를 시스템 DNS로 지정해서 대체 경로로 넘어가게 합니다.
  function tools() {
    return createDnsTools(
      2000,
      new AbortController().signal,
      (message) => {
        fallbacks.push(message);
      },
      { systemServers: ['127.0.0.1:9'], doh: [doh] },
    );
  }

  it('asks DNS-over-HTTPS for TXT records', { timeout: 10_000 }, async () => {
    expect(await tools().resolveTxt('8.8.8.8.origin.asn.cymru.com')).toEqual([
      ['15169 | 8.8.8.0/24 | US | arin | 2023-12-28'],
    ]);
    expect(fallbacks.at(-1)).toBe(
      'system DNS servers are unreachable, using DNS-over-HTTPS (local-doh)',
    );
  });

  it('asks for host names of public addresses only', { timeout: 10_000 }, async () => {
    const dns = tools();

    expect(await dns.reverse('8.8.8.8', false)).toEqual(['dns.google']);
    expect(await dns.reverse('192.168.0.1', true)).toEqual([]);
  });

  it('treats a missing name as no records', { timeout: 10_000 }, async () => {
    expect(await tools().resolveTxt('missing.example')).toEqual([]);
  });

  it('reports when no DNS-over-HTTPS server answers', { timeout: 10_000 }, async () => {
    await expect(tools().resolveTxt('unknown.example')).rejects.toThrow(
      'DNS-over-HTTPS failed (local-doh: HTTP 404)',
    );
  });
});
