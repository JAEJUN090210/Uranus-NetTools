import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UserError } from '../../src/cli/errors';
import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createInfoCommand, type InfoServices } from '../../src/commands/info';
import { freeIpApi } from '../../src/core/geo/providers';
import type { DomainRecord, IpRecord, Registration } from '../../src/core/lookup/records';
import { freeIpApiGoogle } from '../fixtures/geo';
import { serveJson } from '../helpers/lookup';
import { createTestRuntime } from '../helpers/runtime';

let groups: readonly CommandGroup[] = [];
let close: () => Promise<void> = () => Promise.resolve();

function missing(): Promise<never> {
  return Promise.reject(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
}

function servicesFor(geoBase: string): InfoServices {
  return {
    registration: {
      domain: (name) => {
        if (name === 'unregistered.test') {
          return Promise.reject(new UserError('no registration found for unregistered.test'));
        }
        const registration: Registration<DomainRecord> = {
          source: 'rdap',
          server: `https://rdap.example/domain/${name}`,
          record: {
            domain: name,
            registrar: 'Example Registrar',
            created: '1995-08-14T04:00:00Z',
            expires: '2999-08-13T04:00:00Z',
            status: ['client transfer prohibited'],
            nameservers: ['a.iana-servers.net'],
            dnssec: true,
          },
          raw: {},
        };
        return Promise.resolve(registration);
      },
      ip: (address) => {
        const registration: Registration<IpRecord> = {
          source: 'rdap',
          server: `https://rdap.example/ip/${address}`,
          record: {
            cidrs: ['8.8.8.0/24'],
            name: 'GOGL',
            organization: 'Google LLC',
            country: 'US',
          },
          raw: {},
        };
        return Promise.resolve(registration);
      },
      asn: () => Promise.reject(new Error('not used')),
    },
    dns: () => ({
      resolveTxt: (name) => {
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
      host === 'example.test' || host === 'unregistered.test'
        ? Promise.resolve([
            { address: '8.8.8.8', family: 4 },
            { address: '10.0.0.1', family: 4 },
          ])
        : Promise.reject(new UserError(`cannot resolve ${host}`)),
    providers: [freeIpApi(`${geoBase}/free/`)],
  };
}

beforeAll(async () => {
  const server = await serveJson(() => ({ '/free/8.8.8.8': { body: freeIpApiGoogle } }));
  close = server.close;
  groups = [
    {
      heading: 'Lookup:',
      commands: [(runtime) => createInfoCommand(runtime, servicesFor(server.base))],
    },
  ];
});

afterAll(async () => {
  await close();
});

async function info(args: string[]) {
  const { runtime, stdout, stderr } = createTestRuntime();
  const code = await runCommand(['info', ...args], runtime, groups);
  return { code, stdout: stdout(), stderr: stderr() };
}

describe('unt info', () => {
  it('summarizes a domain and lists its addresses with their locations', async () => {
    const { code, stdout } = await info(['example.test']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Domain\s+example\.test$/m);
    expect(stdout).toMatch(/^Registrar\s+Example Registrar$/m);
    expect(stdout).toMatch(/^Expires\s+2999-08-13 \(in \d+ days\)$/m);
    expect(stdout).not.toMatch(/^Status/m);
    expect(stdout).toMatch(/^ADDRESS\s+HOSTNAME\s+ASN\s+ORGANIZATION\s+LOCATION$/m);
    expect(stdout).toMatch(
      /^8\.8\.8\.8\s+dns\.google\s+AS15169\s+Google LLC\s+Mountain View, California, US$/m,
    );
    expect(stdout).toMatch(/^10\.0\.0\.1\s+-\s+-\s+private or reserved\s+-$/m);
    expect(stdout).toContain('registration: RDAP https://rdap.example/domain/example.test');
    expect(stdout).toContain('locations: freeipapi.com (approximate)');
  });

  it('combines the network details and the location of one address', async () => {
    const { code, stdout } = await info(['8.8.8.8']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Hostname\s+dns\.google$/m);
    expect(stdout).toMatch(/^ASN\s+AS15169 GOOGLE, US$/m);
    expect(stdout).toMatch(/^Country\s+United States \(US\)$/m);
    expect(stdout).toMatch(/^City\s+Mountain View$/m);
    expect(stdout.match(/^Country/gm)).toHaveLength(1);
    expect(stdout.match(/^ASN/gm)).toHaveLength(1);
  });

  it('skips locations with --no-geo', async () => {
    const { code, stdout } = await info(['example.test', '--no-geo']);

    expect(code).toBe(0);
    expect(stdout).not.toContain('LOCATION');
    expect(stdout).not.toContain('locations:');
  });

  it('prints JSON', async () => {
    const { stdout } = await info(['example.test', '--json']);

    expect(JSON.parse(stdout) as unknown).toMatchObject({
      query: 'example.test',
      domain: 'example.test',
      registration: { source: 'rdap', registrar: 'Example Registrar' },
      addresses: [
        {
          address: '8.8.8.8',
          hostname: 'dns.google',
          locationSource: 'freeipapi.com',
          location: { city: 'Mountain View' },
        },
        { address: '10.0.0.1', reserved: true },
      ],
      errors: [],
    });
  });

  it('keeps going when the registration or the addresses cannot be found', async () => {
    const unregistered = await info(['unregistered.test']);
    const unresolved = await info(['mail-only.test']);

    expect(unregistered.code).toBe(1);
    expect(unregistered.stdout).toMatch(/^8\.8\.8\.8\s+dns\.google/m);
    expect(unregistered.stderr).toContain('no registration found for unregistered.test');
    expect(unresolved.code).toBe(1);
    expect(unresolved.stdout).toMatch(/^Domain\s+mail-only\.test$/m);
    expect(unresolved.stderr).toContain('cannot resolve mail-only.test');
  });
});
