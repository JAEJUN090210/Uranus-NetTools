import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createRegistrationService,
  type LookupContext,
  type RegistrationService,
} from '../../../src/core/lookup/registration';
import { arinAutnum, arinNetwork, verisignDomain } from '../../fixtures/rdap';
import { ianaKr, krWhois } from '../../fixtures/whois';
import { serveJson, serveWhois } from '../../helpers/lookup';

let service: RegistrationService;
let rdapBase = '';
const closers: (() => Promise<void>)[] = [];
const requests: string[] = [];
const context: LookupContext = {
  signal: new AbortController().signal,
  timeoutMs: 5000,
  onRequest: (description) => {
    requests.push(description);
  },
};

beforeAll(async () => {
  const http = await serveJson((base) => {
    const rdap = [`${base}/rdap/`];
    return {
      '/bootstrap/dns.json': { body: { services: [[['test'], rdap]] } },
      '/bootstrap/ipv4.json': { body: { services: [[['8.0.0.0/8'], rdap]] } },
      '/bootstrap/ipv6.json': { body: { services: [[['2001:4860::/32'], rdap]] } },
      '/bootstrap/asn.json': { body: { services: [[['1-100', '15169'], rdap]] } },
      '/rdap/domain/example.test': { body: { ...verisignDomain, ldhName: 'EXAMPLE.TEST' } },
      '/rdap/domain/limited.test': { status: 429, body: { errorCode: 429 } },
      '/rdap/ip/8.8.8.8': { body: arinNetwork },
      '/rdap/autnum/15169': { body: arinAutnum },
    };
  });
  const whois = await serveWhois((query) => {
    if (query === 'kr') {
      return ianaKr.replace('whois.kr', '127.0.0.1');
    }
    return query === 'naver.co.kr' ? krWhois : `No match for "${query.toUpperCase()}".\n`;
  });
  closers.push(http.close, whois.close);
  rdapBase = `${http.base}/rdap/`;
  service = createRegistrationService({
    bootstrap: `${http.base}/bootstrap/`,
    ianaWhois: { host: '127.0.0.1', port: whois.port },
    whoisPort: whois.port,
  });
});

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

describe('createRegistrationService', () => {
  it('finds the registered domain behind a subdomain over RDAP', async () => {
    requests.length = 0;

    const registration = await service.domain('www.example.test', context);

    expect(registration).toMatchObject({
      source: 'rdap',
      server: `${rdapBase}domain/example.test`,
      record: { domain: 'example.test', registrar: 'MarkMonitor Inc.' },
    });
    expect(requests).toEqual([
      `RDAP ${rdapBase}domain/www.example.test`,
      `RDAP ${rdapBase}domain/example.test`,
    ]);
  });

  it('falls back to WHOIS for a TLD without RDAP', async () => {
    const registration = await service.domain('www.naver.co.kr', context);

    expect(registration).toMatchObject({
      source: 'whois',
      server: '127.0.0.1',
      record: { domain: 'naver.co.kr', registrar: 'Megazone(http://HOSTING.KR)' },
    });
    expect(registration.raw).toBe(krWhois);
  });

  it('looks up IP addresses and AS numbers', async () => {
    expect((await service.ip('8.8.8.8', 4, context)).record.organization).toBe('Google LLC');
    expect((await service.asn(15169, context)).record.name).toBe('GOOGLE');
  });

  it('explains why private addresses cannot be looked up', async () => {
    await expect(service.ip('192.168.0.1', 4, context)).rejects.toThrow(
      'private or reserved address',
    );
  });

  it('reports unregistered names and rate limits', async () => {
    await expect(service.domain('missing.test', context)).rejects.toThrow(
      'no registration found for missing.test',
    );
    await expect(service.domain('limited.test', context)).rejects.toThrow('limiting requests');
    await expect(service.asn(64512, context)).rejects.toThrow(
      'no RDAP server is known for AS64512',
    );
  });
});
