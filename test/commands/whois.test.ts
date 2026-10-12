import { describe, expect, it } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createWhoisCommand } from '../../src/commands/whois';
import type {
  AsnRecord,
  DomainRecord,
  IpRecord,
  Registration,
} from '../../src/core/lookup/records';
import type { RegistrationService } from '../../src/core/lookup/registration';
import { createTestRuntime } from '../helpers/runtime';

const calls: string[] = [];

const service: RegistrationService = {
  domain: (name) => {
    calls.push(`domain ${name}`);
    const registration: Registration<DomainRecord> = {
      source: 'rdap',
      server: `https://rdap.example/domain/${name}`,
      record: {
        domain: name,
        registrar: 'Example Registrar',
        created: '1995-08-14T04:00:00Z',
        updated: '2024-08-14T07:01:34Z',
        expires: '2999-08-13T04:00:00Z',
        status: ['client transfer prohibited'],
        nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
        dnssec: true,
      },
      raw: { objectClassName: 'domain', ldhName: name.toUpperCase() },
    };
    return Promise.resolve(registration);
  },
  ip: (address) => {
    calls.push(`ip ${address}`);
    const registration: Registration<IpRecord> = {
      source: 'rdap',
      server: `https://rdap.example/ip/${address}`,
      record: {
        start: '8.8.8.0',
        end: '8.8.8.255',
        cidrs: ['8.8.8.0/24'],
        name: 'GOGL',
        organization: 'Google LLC',
        abuse: 'network-abuse@google.com',
      },
      raw: {},
    };
    return Promise.resolve(registration);
  },
  asn: (asn) => {
    calls.push(`asn ${asn}`);
    const registration: Registration<AsnRecord> = {
      source: 'rdap',
      server: `https://rdap.example/autnum/${asn}`,
      record: { asn, name: 'GOOGLE', organization: 'Google LLC' },
      raw: {},
    };
    return Promise.resolve(registration);
  },
};

const groups: readonly CommandGroup[] = [
  { heading: 'Lookup:', commands: [(runtime) => createWhoisCommand(runtime, service)] },
];

async function whois(args: string[]) {
  calls.length = 0;
  const { runtime, stdout, stderr } = createTestRuntime();
  const code = await runCommand(['whois', ...args], runtime, groups);
  return { code, stdout: stdout(), stderr: stderr(), calls: [...calls] };
}

describe('unt whois', () => {
  it('shows the registration of a domain', async () => {
    const { code, stdout } = await whois(['example.com']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Domain\s+example\.com$/m);
    expect(stdout).toMatch(/^Registrar\s+Example Registrar$/m);
    expect(stdout).toMatch(/^Created\s+1995-08-14$/m);
    expect(stdout).toMatch(/^Expires\s+2999-08-13 \(in \d+ days\)$/m);
    expect(stdout).toContain('Name servers  a.iana-servers.net\n              b.iana-servers.net');
    expect(stdout).toMatch(/^DNSSEC\s+signed$/m);
    expect(stdout).toContain('source: RDAP https://rdap.example/domain/example.com');
  });

  it('accepts URLs and international domain names', async () => {
    expect((await whois(['https://Example.COM/path'])).calls).toEqual(['domain example.com']);

    const { calls: idnCalls, stdout } = await whois(['한국.kr']);

    expect(idnCalls).toEqual(['domain xn--3e0b707e.kr']);
    expect(stdout).toMatch(/^Domain\s+한국\.kr \(xn--3e0b707e\.kr\)$/m);
  });

  it('shows the registration of an IP address and an AS number', async () => {
    const ip = await whois(['8.8.8.8']);
    const asn = await whois(['AS15169']);

    expect(ip.stdout).toMatch(/^Range\s+8\.8\.8\.0 - 8\.8\.8\.255$/m);
    expect(ip.stdout).toMatch(/^Abuse\s+network-abuse@google\.com$/m);
    expect(asn.stdout).toMatch(/^ASN\s+AS15169$/m);
    expect(asn.stdout).toMatch(/^Organization\s+Google LLC$/m);
  });

  it('prints JSON and the raw response', async () => {
    const json = await whois(['example.com', '--json']);
    const raw = await whois(['example.com', '--raw']);

    expect(JSON.parse(json.stdout) as unknown).toMatchObject({
      query: 'example.com',
      type: 'domain',
      source: 'rdap',
      registrar: 'Example Registrar',
      nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
    });
    expect(JSON.parse(raw.stdout) as unknown).toEqual({
      objectClassName: 'domain',
      ldhName: 'EXAMPLE.COM',
    });
  });

  it('hides the source hint with --quiet', async () => {
    expect((await whois(['example.com', '--quiet'])).stdout).not.toContain('source:');
  });

  it('rejects input that is not a domain, IP address or AS number', async () => {
    const { code, stderr } = await whois(['localhost']);

    expect(code).toBe(1);
    expect(stderr).toContain('is not a domain name, IP address or AS number');
  });
});
