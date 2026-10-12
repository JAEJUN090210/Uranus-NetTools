import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeWhois,
  isNotFound,
  normalizeDate,
  parseReferral,
  parseWhoisDomain,
  queryWhois,
} from '../../../src/core/lookup/whois';
import { gtldWhois, ianaKr, krWhois } from '../../fixtures/whois';
import { serveWhois } from '../../helpers/lookup';

const never = new AbortController().signal;

describe('parseWhoisDomain', () => {
  it('reads a gTLD style response', () => {
    expect(parseWhoisDomain(gtldWhois, 'example.org')).toEqual({
      domain: 'example.org',
      registrar: 'Internet Assigned Numbers Authority',
      registrant: 'Internet Assigned Numbers Authority',
      created: '1995-04-30T04:00:00.000Z',
      updated: '2024-01-22T07:59:12.000Z',
      expires: '2025-04-29T04:00:00.000Z',
      status: ['clientDeleteProhibited', 'clientTransferProhibited'],
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
      dnssec: true,
    });
  });

  it('reads the English part of a .kr response', () => {
    expect(parseWhoisDomain(krWhois, 'naver.co.kr')).toEqual({
      domain: 'naver.co.kr',
      registrar: 'Megazone(http://HOSTING.KR)',
      registrant: 'NAVER Corp.',
      created: '1997-09-12',
      updated: '2024-08-21',
      expires: '2033-09-12',
      status: [],
      nameservers: ['ns1.naver.com', 'ns2.naver.com'],
      dnssec: false,
    });
  });
});

describe('normalizeDate', () => {
  it.each([
    ['1997. 09. 12.', '1997-09-12'],
    ['2024-1-2', '2024-01-02'],
    ['2024-01-22T07:59:12Z', '2024-01-22T07:59:12.000Z'],
    ['someday', 'someday'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

describe('decodeWhois', () => {
  it('reads UTF-8', () => {
    expect(decodeWhois(new TextEncoder().encode('등록인'))).toBe('등록인');
  });

  it('falls back to EUC-KR', () => {
    // "한국"을 EUC-KR로 인코딩한 바이트입니다.
    expect(decodeWhois(Uint8Array.from([0xc7, 0xd1, 0xb1, 0xb9]))).toBe('한국');
  });
});

describe('parseReferral and isNotFound', () => {
  it('finds the WHOIS server of a TLD', () => {
    expect(parseReferral(ianaKr)).toBe('whois.kr');
    expect(parseReferral('domain: NOWHERE\n')).toBeUndefined();
  });

  it('recognizes "not found" answers', () => {
    expect(isNotFound('No match for "WWW.EXAMPLE.KR".')).toBe(true);
    expect(isNotFound(krWhois)).toBe(false);
  });
});

describe('queryWhois', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
  });

  it('sends the query and reads the whole answer', async () => {
    const server = await serveWhois((query) => `you asked for ${query}\n`);
    close = server.close;

    const answer = await queryWhois({ host: '127.0.0.1', port: server.port }, 'example.kr', {
      signal: never,
      timeoutMs: 5000,
    });

    expect(answer).toBe('you asked for example.kr\n');
  });

  it('reports a server that cannot be reached', async () => {
    const server = await serveWhois(() => '');
    await server.close();

    await expect(
      queryWhois({ host: '127.0.0.1', port: server.port }, 'example.kr', {
        signal: never,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow('cannot reach the WHOIS server 127.0.0.1');
  }, 15_000);
});
