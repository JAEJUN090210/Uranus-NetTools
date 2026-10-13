import type { DetailedPeerCertificate, PeerCertificate } from 'node:tls';

import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createCertCommand, type CertServices } from '../../src/commands/cert';
import type { CertificateResult } from '../../src/core/cert/fetch';
import { createTestRuntime } from '../helpers/runtime';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 지금으로부터 days일 뒤(음수면 전)를 인증서 날짜 형식으로 적습니다.
 * 남은 일수는 내림으로 계산하므로, 경계에 걸리지 않도록 반나절을 더해 둡니다.
 */
function inDays(days: number): string {
  return new Date(Date.now() + days * DAY_MS + DAY_MS / 2).toUTCString();
}

function certificate(overrides: Partial<PeerCertificate> = {}): DetailedPeerCertificate {
  return {
    subject: { CN: 'example.com' },
    issuer: { CN: 'Test CA', O: 'Test Corp' },
    valid_from: inDays(-30),
    valid_to: inDays(60),
    subjectaltname: 'DNS:example.com, DNS:*.example.com',
    serialNumber: 'ABCD1234',
    fingerprint256: 'AA:BB:CC',
    bits: 2048,
    ...overrides,
  } as DetailedPeerCertificate;
}

function result(overrides: Partial<CertificateResult> = {}): CertificateResult {
  return {
    certificate: certificate(),
    trusted: true,
    protocol: 'TLSv1.3',
    cipher: 'TLS_AES_256_GCM_SHA384',
    address: '93.184.216.34',
    elapsed: 120,
    ...overrides,
  };
}

function fakeServices(overrides: Partial<CertServices> = {}): CertServices {
  return { fetch: () => Promise.resolve(result()), ...overrides };
}

function groupsWith(services: CertServices): readonly CommandGroup[] {
  return [{ heading: 'Lookup:', commands: [(runtime) => createCertCommand(runtime, services)] }];
}

describe('unt cert', () => {
  it('is listed under Lookup in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Lookup:\n(?:.*\n)*?\s+cert/);
  });

  it('shows the certificate, when it expires, the names and the TLS details', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['cert', 'example.com'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toMatch(/Subject\s+example\.com/);
    expect(stdout()).toMatch(/Issuer\s+Test CA — Test Corp/);
    expect(stdout()).toMatch(/Expires\s+in 60 days/);
    expect(stdout()).toMatch(/Hostname\s+matches/);
    expect(stdout()).toMatch(/Trust\s+trusted/);
    expect(stdout()).toMatch(/Names\s+example\.com, \*\.example\.com/);
    expect(stdout()).toMatch(/Key\s+RSA 2048 bits/);
    expect(stdout()).toMatch(/SHA-256\s+AA:BB:CC/);
    expect(stdout()).toMatch(/TLS\s+TLSv1\.3, TLS_AES_256_GCM_SHA384/);
  });

  it('asks port 443 by default and uses the port given with -p or in the host', async () => {
    const fetch = vi.fn<CertServices['fetch']>(() => Promise.resolve(result()));
    const { runtime } = createTestRuntime();
    const groups = groupsWith(fakeServices({ fetch }));

    await runCommand(['cert', 'example.com'], runtime, groups);
    await runCommand(['cert', 'example.com', '-p', '8443'], runtime, groups);
    await runCommand(['cert', 'example.com:9443'], runtime, groups);
    await runCommand(['cert', 'https://example.com/path'], runtime, groups);

    expect(fetch.mock.calls.map(([options]) => options.port)).toEqual([443, 8443, 9443, 443]);
    expect(fetch.mock.calls.map(([options]) => options.host)).toEqual([
      'example.com',
      'example.com',
      'example.com',
      'example.com',
    ]);
  });

  it('warns when the certificate expires soon but still succeeds', async () => {
    const services = fakeServices({
      fetch: () => Promise.resolve(result({ certificate: certificate({ valid_to: inDays(10) }) })),
    });
    const { runtime, stdout, stderr } = createTestRuntime();

    const code = await runCommand(['cert', 'example.com'], runtime, groupsWith(services));

    expect(code).toBe(0);
    expect(stderr()).toContain('expires in 10 days; time to renew it');
    expect(stdout()).toMatch(/Expires\s+in 10 days/);
  });

  it('does not warn when more days are left than --expiry-days', async () => {
    const services = fakeServices({
      fetch: () => Promise.resolve(result({ certificate: certificate({ valid_to: inDays(10) }) })),
    });
    const { runtime, stderr } = createTestRuntime();

    await runCommand(['cert', 'example.com', '--expiry-days', '5'], runtime, groupsWith(services));

    expect(stderr()).not.toContain('time to renew');
  });

  it('exits 1 for a certificate that has already expired', async () => {
    const services = fakeServices({
      fetch: () =>
        Promise.resolve(
          result({
            certificate: certificate({ valid_to: inDays(-3) }),
            trusted: false,
            trustError: 'CERT_HAS_EXPIRED',
          }),
        ),
    });
    const { runtime, stdout, stderr } = createTestRuntime();

    const code = await runCommand(['cert', 'example.com'], runtime, groupsWith(services));

    expect(code).toBe(1);
    expect(stderr()).toContain('expired 3 days ago');
    expect(stderr()).toContain('not trusted (CERT_HAS_EXPIRED)');
    expect(stdout()).toContain('▸ expired 3 days ago');
  });

  it('says so when the certificate is for another host', async () => {
    const services = fakeServices({
      fetch: () =>
        Promise.resolve(
          result({ certificate: certificate({ subjectaltname: 'DNS:other.example' }) }),
        ),
    });
    const { runtime, stdout, stderr } = createTestRuntime();

    const code = await runCommand(['cert', 'example.com'], runtime, groupsWith(services));

    // 이름이 맞지 않아도 내용은 보여 주고, 만료는 아니므로 종료 코드는 0입니다.
    expect(code).toBe(0);
    expect(stdout()).toMatch(/Hostname\s+does not match this host/);
    expect(stderr()).toContain('not valid for the host you asked about');
  });

  it('shows the chain only with --chain', async () => {
    const root = certificate({
      subject: { CN: 'Test Root' },
      issuer: { CN: 'Test Root' },
      fingerprint256: 'ROOT',
    });
    const leaf = certificate({ fingerprint256: 'LEAF' });
    (leaf as { issuerCertificate: unknown }).issuerCertificate = root;
    (root as { issuerCertificate: unknown }).issuerCertificate = root;
    const services = fakeServices({ fetch: () => Promise.resolve(result({ certificate: leaf })) });

    const without = createTestRuntime();
    await runCommand(['cert', 'example.com'], without.runtime, groupsWith(services));
    expect(without.stdout()).not.toContain('CHAIN');

    const withChain = createTestRuntime();
    await runCommand(['cert', 'example.com', '--chain'], withChain.runtime, groupsWith(services));
    expect(withChain.stdout()).toContain('CHAIN');
    expect(withChain.stdout()).toMatch(/SUBJECT\s+ISSUER\s+EXPIRES/);
    expect(withChain.stdout()).toContain('Test Root');
  });

  it('prints the certificate as PEM with --pem', async () => {
    const services = fakeServices({
      fetch: () =>
        Promise.resolve(
          result({ certificate: certificate({ raw: Buffer.from('hello world', 'utf8') }) }),
        ),
    });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['cert', 'example.com', '--pem'], runtime, groupsWith(services));

    expect(stdout()).toContain('-----BEGIN CERTIFICATE-----');
    expect(stdout()).toContain(Buffer.from('hello world', 'utf8').toString('base64'));
    expect(stdout()).toContain('-----END CERTIFICATE-----');
  });

  describe('--starttls', () => {
    it('passes the protocol through and uses its usual port', async () => {
      const fetch = vi.fn<CertServices['fetch']>(() => Promise.resolve(result()));
      const { runtime } = createTestRuntime();

      await runCommand(
        ['cert', 'mail.example.com', '--starttls', 'SMTP'],
        runtime,
        groupsWith(fakeServices({ fetch })),
      );

      const options = fetch.mock.calls[0]?.[0];
      expect(options?.starttls).toBe('smtp');
      expect(options?.port).toBe(587);
    });

    it('still honours an explicit port', async () => {
      const fetch = vi.fn<CertServices['fetch']>(() => Promise.resolve(result()));
      const { runtime } = createTestRuntime();

      await runCommand(
        ['cert', 'mail.example.com', '--starttls', 'imap', '-p', '1143'],
        runtime,
        groupsWith(fakeServices({ fetch })),
      );

      expect(fetch.mock.calls[0]?.[0].port).toBe(1143);
    });

    it('rejects a protocol it does not know', async () => {
      const { runtime, stderr } = createTestRuntime();

      const code = await runCommand(
        ['cert', 'mail.example.com', '--starttls', 'nope'],
        runtime,
        groupsWith(fakeServices()),
      );

      expect(code).toBe(1);
      expect(stderr()).toContain('is not a protocol I know');
    });
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['cert', 'example.com', '--json'], runtime, groupsWith(fakeServices()));

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      host: 'example.com',
      port: 443,
      address: '93.184.216.34',
      protocol: 'TLSv1.3',
      trusted: true,
      trustError: null,
      hostnameMatches: true,
      expired: false,
      certificate: {
        subject: 'example.com',
        issuer: 'Test CA',
        daysLeft: 60,
        names: ['example.com', '*.example.com'],
        fingerprint: 'AA:BB:CC',
        key: 'RSA 2048 bits',
      },
    });
  });
});
