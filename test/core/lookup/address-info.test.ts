import { describe, expect, it } from 'vitest';

import { createRegistrationLookup } from '../../../src/core/lookup/address-info';
import type { IpRecord, Registration } from '../../../src/core/lookup/records';
import type { LookupContext, RegistrationService } from '../../../src/core/lookup/registration';

const context: LookupContext = { signal: new AbortController().signal, timeoutMs: 1000 };

function fakeService(records: Record<string, IpRecord>) {
  const calls: string[] = [];
  const inFlight = { now: 0, max: 0 };
  const service: RegistrationService = {
    domain: () => Promise.reject(new Error('not used')),
    asn: () => Promise.reject(new Error('not used')),
    ip: async (address) => {
      calls.push(address);
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight.now -= 1;
      const record = records[address];
      if (record === undefined) {
        throw new Error(`no record for ${address}`);
      }
      const registration: Registration<IpRecord> = { source: 'rdap', server: 'x', record, raw: {} };
      return registration;
    },
  };
  return { service, calls, inFlight };
}

describe('createRegistrationLookup', () => {
  it('asks once per network and reuses the answer for other addresses in it', async () => {
    const { service, calls } = fakeService({
      '8.8.8.8': { cidrs: ['8.8.8.0/24'], name: 'GOGL' },
      '2001:4860:4860::8888': {
        cidrs: [],
        start: '2001:4860::',
        end: '2001:4860:ffff:ffff:ffff:ffff:ffff:ffff',
        name: 'GOOGLE-IPV6',
      },
    });
    const lookup = createRegistrationLookup(service);

    const records = await Promise.all([
      lookup('8.8.8.8', 4, context),
      lookup('8.8.8.9', 4, context),
      lookup('2001:4860:4860::8888', 6, context),
      lookup('2001:4860:4860::8844', 6, context),
    ]);

    expect(records.map((record) => record.name)).toEqual([
      'GOGL',
      'GOGL',
      'GOOGLE-IPV6',
      'GOOGLE-IPV6',
    ]);
    expect(calls).toEqual(['8.8.8.8', '2001:4860:4860::8888']);
  });

  it('sends one request at a time and keeps going after a failure', async () => {
    const { service, inFlight } = fakeService({ '1.1.1.1': { cidrs: ['1.1.1.0/24'] } });
    const lookup = createRegistrationLookup(service);

    const results = await Promise.allSettled([
      lookup('9.9.9.9', 4, context),
      lookup('1.1.1.1', 4, context),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(inFlight.max).toBe(1);
  });
});
