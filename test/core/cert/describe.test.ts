import type { DetailedPeerCertificate, PeerCertificate } from 'node:tls';

import { describe, expect, it } from 'vitest';

import {
  certificateChain,
  describeCertificate,
  matchesHost,
  type RawCertificate,
  subjectNames,
} from '../../../src/core/cert/describe';

const now = new Date('2026-10-13T00:00:00Z');

function certificate(overrides: RawCertificate = {}): RawCertificate {
  return {
    subject: { CN: 'example.com' },
    issuer: { CN: 'Test CA', O: 'Test Corp' },
    valid_from: 'Sep 26 00:00:00 2026 GMT',
    valid_to: 'Dec 25 00:00:00 2026 GMT',
    subjectaltname: 'DNS:example.com, DNS:*.example.com',
    serialNumber: 'ABCD',
    fingerprint256: 'AA:BB',
    bits: 2048,
    ...overrides,
  };
}

describe('describeCertificate', () => {
  it('pulls out the fields worth showing', () => {
    const info = describeCertificate(certificate(), now);

    expect(info).toMatchObject({
      subject: 'example.com',
      issuer: 'Test CA',
      organization: 'Test Corp',
      names: ['example.com', '*.example.com'],
      serial: 'ABCD',
      fingerprint: 'AA:BB',
      key: 'RSA 2048 bits',
    });
    expect(info.validTo?.toISOString().slice(0, 10)).toBe('2026-12-25');
  });

  it('counts the days left and goes negative once expired', () => {
    expect(describeCertificate(certificate(), now).daysLeft).toBe(73);
    expect(
      describeCertificate(certificate({ valid_to: 'Apr 12 00:00:00 2015 GMT' }), now).daysLeft,
    ).toBeLessThan(0);
  });

  it('describes an elliptic-curve key by its curve', () => {
    const info = describeCertificate(certificate({ nistCurve: 'P-256' }), now);

    expect(info.key).toBe('EC P-256');
  });

  it('copes with a certificate that has nothing in it', () => {
    expect(describeCertificate({}, now)).toEqual({ names: [] });
  });

  it('ignores dates it cannot read', () => {
    const info = describeCertificate(certificate({ valid_to: 'not a date' }), now);

    expect(info.validTo).toBeUndefined();
    expect(info.daysLeft).toBeUndefined();
  });

  it('takes the first value when a name field repeats', () => {
    const info = describeCertificate(
      certificate({
        subject: { CN: ['first', 'second'] } as unknown as PeerCertificate['subject'],
      }),
      now,
    );

    expect(info.subject).toBe('first');
  });
});

describe('subjectNames', () => {
  it('reads DNS and IP entries out of subjectaltname', () => {
    expect(subjectNames(certificate({ subjectaltname: 'DNS:a.com, IP Address:1.2.3.4' }))).toEqual([
      'a.com',
      '1.2.3.4',
    ]);
  });

  it('falls back to the common name when there is no subjectaltname', () => {
    expect(subjectNames(certificate({ subjectaltname: undefined }))).toEqual(['example.com']);
  });

  it('is empty when there is nothing to read', () => {
    expect(subjectNames({})).toEqual([]);
  });
});

describe('certificateChain', () => {
  it('follows the issuers and stops at the self-signed root', () => {
    const root = certificate({
      subject: { CN: 'Root' },
      issuer: { CN: 'Root' },
      fingerprint256: 'ROOT',
    }) as DetailedPeerCertificate;
    // 루트는 자기 자신을 발급자로 가리킵니다.
    (root as { issuerCertificate: unknown }).issuerCertificate = root;
    const leaf = certificate({ fingerprint256: 'LEAF' }) as DetailedPeerCertificate;
    (leaf as { issuerCertificate: unknown }).issuerCertificate = root;

    const chain = certificateChain(leaf, now);

    expect(chain).toHaveLength(2);
    expect(chain.map((info) => info.subject)).toEqual(['example.com', 'Root']);
  });

  it('returns just the one certificate when there is no issuer', () => {
    expect(certificateChain(certificate() as DetailedPeerCertificate, now)).toHaveLength(1);
  });
});

describe('matchesHost', () => {
  it.each([
    [['example.com'], 'example.com', true],
    [['example.com'], 'EXAMPLE.COM', true],
    [['example.com'], 'www.example.com', false],
    [['*.example.com'], 'www.example.com', true],
    [['*.example.com'], 'example.com', false],
    // 와일드카드는 점을 넘어서 맞지 않습니다.
    [['*.example.com'], 'a.b.example.com', false],
    [['a.com', '*.b.com'], 'x.b.com', true],
    [['1.2.3.4'], '1.2.3.4', true],
    // IP 주소에는 와일드카드를 쓸 수 없습니다.
    [['*.3.4'], '1.2.3.4', false],
    [[], 'example.com', false],
  ])('%j vs %s -> %s', (names, host, expected) => {
    expect(matchesHost(names, host)).toBe(expected);
  });
});
