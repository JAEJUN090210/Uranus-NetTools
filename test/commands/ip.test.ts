import { describe, expect, it } from 'vitest';

import { UserError } from '../../src/cli/errors';
import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createIpCommand, type IpServices } from '../../src/commands/ip';
import type { IpRecord, Registration } from '../../src/core/lookup/records';
import { createTestRuntime } from '../helpers/runtime';

const asked: string[] = [];

function missing(): Promise<never> {
  return Promise.reject(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
}

const services: IpServices = {
  registration: {
    domain: () => Promise.reject(new Error('not used')),
    asn: () => Promise.reject(new Error('not used')),
    ip: (address) => {
      asked.push(`rdap ${address}`);
      if (address === '8.8.4.4') {
        return Promise.reject(
          new UserError('the RDAP server is limiting requests, try again later'),
        );
      }
      const registration: Registration<IpRecord> = {
        source: 'rdap',
        server: `https://rdap.example/ip/${address}`,
        record: {
          cidrs: ['8.8.8.0/24'],
          name: 'GOGL',
          organization: 'Google LLC',
          country: 'US',
          abuse: 'network-abuse@google.com',
        },
        raw: {},
      };
      return Promise.resolve(registration);
    },
  },
  dns: () => ({
    resolveTxt: (name) => {
      asked.push(`txt ${name}`);
      if (name === 'AS15169.asn.cymru.com') {
        return Promise.resolve([['15169 | US | arin | 2000-03-30 | GOOGLE, US']]);
      }
      return name.includes('.origin')
        ? Promise.resolve([['15169 | 8.8.8.0/24 | US | arin | 2023-12-28']])
        : missing();
    },
    reverse: (address) => Promise.resolve(address === '8.8.8.8' ? ['dns.google'] : []),
  }),
  resolveAll: (host) =>
    host === 'dns.google'
      ? Promise.resolve([
          { address: '8.8.8.8', family: 4 },
          { address: '2001:4860:4860::8888', family: 6 },
        ])
      : Promise.reject(new UserError(`cannot resolve ${host}`)),
};

const groups: readonly CommandGroup[] = [
  { heading: 'Lookup:', commands: [(runtime) => createIpCommand(runtime, services)] },
];

async function ip(args: string[]) {
  asked.length = 0;
  const { runtime, stdout, stderr } = createTestRuntime();
  const code = await runCommand(['ip', ...args], runtime, groups);
  return { code, stdout: stdout(), stderr: stderr(), asked: [...asked] };
}

describe('unt ip', () => {
  it('shows the details of one address', async () => {
    const { code, stdout } = await ip(['8.8.8.8']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Hostname\s+dns\.google$/m);
    expect(stdout).toMatch(/^ASN\s+AS15169 GOOGLE, US$/m);
    expect(stdout).toMatch(/^BGP prefix\s+8\.8\.8\.0\/24$/m);
    expect(stdout).toMatch(/^Organization\s+Google LLC$/m);
    expect(stdout).toMatch(/^Registry\s+ARIN$/m);
    expect(stdout).toMatch(/^Abuse\s+network-abuse@google\.com$/m);
  });

  it('lists every address of a domain in a table', async () => {
    const { code, stdout } = await ip(['dns.google']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^ADDRESS\s+HOSTNAME\s+ASN\s+ORGANIZATION\s+NETWORK$/m);
    expect(stdout).toMatch(/^8\.8\.8\.8\s+dns\.google\s+AS15169\s+Google LLC\s+8\.8\.8\.0\/24$/m);
    expect(stdout).toMatch(/^2001:4860:4860::8888\s+-\s+AS15169/m);
  });

  it('does not send private addresses to outside services', async () => {
    const { stdout, asked: queries } = await ip(['192.168.0.1']);

    expect(stdout).toMatch(/^Scope\s+private or reserved, no public registration$/m);
    expect(queries).toEqual([]);
  });

  it('prints JSON', async () => {
    const { stdout } = await ip(['8.8.8.8', '--json']);

    expect(JSON.parse(stdout) as unknown).toMatchObject({
      query: '8.8.8.8',
      address: '8.8.8.8',
      family: 4,
      reserved: false,
      hostname: 'dns.google',
      asn: { asn: 15169, name: 'GOOGLE, US', prefix: '8.8.8.0/24' },
      registration: { organization: 'Google LLC' },
      errors: [],
    });
  });

  it('keeps going and warns when one of the lookups fails', async () => {
    const { code, stdout, stderr } = await ip(['8.8.4.4']);

    expect(code).toBe(1);
    expect(stdout).toMatch(/^ASN\s+AS15169 GOOGLE, US$/m);
    expect(stderr).toContain(
      '⚠ 8.8.4.4: RDAP: the RDAP server is limiting requests, try again later',
    );
  });

  it('points AS numbers to whois and reports names that do not resolve', async () => {
    const asn = await ip(['AS15169']);
    const unknown = await ip(['no-such-host.invalid']);

    expect(asn.stderr).toContain("use 'unt whois AS15169' to look up an AS number");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('cannot resolve no-such-host.invalid');
  });
});
