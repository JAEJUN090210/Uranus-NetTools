import { describe, expect, it } from 'vitest';

import { toAsnRecord, toDomainRecord, toIpRecord } from '../../../src/core/lookup/rdap';
import { apnicNetwork, arinAutnum, arinNetwork, verisignDomain } from '../../fixtures/rdap';

describe('toDomainRecord', () => {
  it('reads the registrar, dates, status, name servers and DNSSEC', () => {
    expect(toDomainRecord(verisignDomain)).toEqual({
      domain: 'google.com',
      registrar: 'MarkMonitor Inc.',
      created: '1997-09-15T04:00:00Z',
      updated: '2019-09-09T15:39:04Z',
      expires: '2028-09-14T04:00:00Z',
      status: [
        'client delete prohibited',
        'client transfer prohibited',
        'server update prohibited',
      ],
      nameservers: ['ns1.google.com', 'ns2.google.com'],
      dnssec: false,
    });
  });

  it('survives unexpected shapes', () => {
    expect(toDomainRecord({ entities: 'nope', events: [null], nameservers: [1] })).toEqual({
      domain: '',
      status: [],
      nameservers: [],
    });
  });
});

describe('toIpRecord', () => {
  it('reads the owner and abuse contact from nested entities', () => {
    expect(toIpRecord(arinNetwork)).toEqual({
      start: '8.8.8.0',
      end: '8.8.8.255',
      cidrs: ['8.8.8.0/24'],
      name: 'GOGL',
      handle: 'NET-8-8-8-0-2',
      type: 'DIRECT ALLOCATION',
      organization: 'Google LLC',
      abuse: 'network-abuse@google.com',
      created: '2023-12-28T17:24:33-05:00',
      updated: '2023-12-28T17:24:56-05:00',
    });
  });

  it('falls back to the description remark for the organization', () => {
    expect(toIpRecord(apnicNetwork)).toMatchObject({
      organization: 'APNIC and Cloudflare DNS Resolver project',
      country: 'AU',
      abuse: 'helpdesk@apnic.net',
    });
  });
});

describe('toAsnRecord', () => {
  it('reads the name and organization', () => {
    expect(toAsnRecord(arinAutnum, 15169)).toEqual({
      asn: 15169,
      name: 'GOOGLE',
      handle: 'AS15169',
      organization: 'Google LLC',
      created: '2000-03-30T00:00:00-05:00',
    });
  });
});
