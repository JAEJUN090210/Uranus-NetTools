import { isIP } from 'node:net';
import type { DetailedPeerCertificate, PeerCertificate } from 'node:tls';

/**
 * Node는 인증서를 받지 못하면 빈 객체를 주므로 모든 항목이 없을 수 있다고 보고 다룹니다.
 * 이름 항목은 같은 키가 여러 번 들어가면 배열로 옵니다.
 */
export type RawCertificate = Partial<PeerCertificate>;

export interface CertificateInfo {
  readonly subject?: string;
  readonly issuer?: string;
  readonly organization?: string;
  readonly validFrom?: Date;
  readonly validTo?: Date;
  /** 만료까지 남은 일수입니다. 이미 지났으면 음수입니다. */
  readonly daysLeft?: number;
  readonly names: readonly string[];
  readonly serial?: string;
  /** SHA-256 지문입니다. */
  readonly fingerprint?: string;
  /** 키 종류와 길이입니다. (예: RSA 2048 bits, EC prime256v1) */
  readonly key?: string;
  /** 인증기관 인증서인지 여부입니다. 사슬을 보여줄 때 씁니다. */
  readonly ca?: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function first(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return text === '' ? undefined : text;
}

/** 값이 있는 항목만 담습니다. */
function put<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

/** Node가 준 인증서 객체에서 보여줄 값만 꺼냅니다. */
export function describeCertificate(
  certificate: RawCertificate,
  now: Date = new Date(),
): CertificateInfo {
  const validTo = parseDate(certificate.valid_to);
  return {
    ...put('subject', first(certificate.subject?.CN)),
    ...put('issuer', first(certificate.issuer?.CN)),
    ...put('organization', first(certificate.issuer?.O)),
    ...put('validFrom', parseDate(certificate.valid_from)),
    ...put('validTo', validTo),
    ...put(
      'daysLeft',
      validTo === undefined
        ? undefined
        : Math.floor((validTo.getTime() - now.getTime()) / MS_PER_DAY),
    ),
    names: subjectNames(certificate),
    ...put('serial', certificate.serialNumber),
    ...put('fingerprint', certificate.fingerprint256),
    ...put('key', describeKey(certificate)),
    ...put('ca', certificate.ca),
  };
}

/**
 * 사슬의 한 단계입니다. Node의 타입은 발급자와 지문이 항상 있다고 하지만,
 * 루트에서는 발급자가 없거나 자기 자신을 가리키므로 없을 수 있다고 보고 다룹니다.
 */
type ChainNode = RawCertificate & {
  readonly issuerCertificate?: ChainNode;
};

/** 서버 인증서부터 루트까지 사슬을 따라갑니다. 마지막 인증서는 자기 자신을 가리키므로 거기서 멈춥니다. */
export function certificateChain(
  certificate: DetailedPeerCertificate,
  now: Date = new Date(),
): CertificateInfo[] {
  const chain: CertificateInfo[] = [];
  const seen = new Set<string>();
  let current: ChainNode | undefined = certificate;
  while (current !== undefined) {
    const key = current.fingerprint256 ?? String(chain.length);
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    chain.push(describeCertificate(current, now));
    current = current.issuerCertificate;
  }
  return chain;
}

function parseDate(text: string | undefined): Date | undefined {
  if (text === undefined) {
    return undefined;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** subjectaltname은 "DNS:a.com, DNS:*.a.com, IP Address:1.2.3.4" 형식입니다. */
export function subjectNames(certificate: RawCertificate): string[] {
  const raw = certificate.subjectaltname;
  if (raw === undefined || raw === '') {
    const common = first(certificate.subject?.CN);
    return common === undefined ? [] : [common];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      const colon = entry.indexOf(':');
      return colon === -1 ? [] : [entry.slice(colon + 1).trim()];
    })
    .filter((name) => name !== '');
}

function describeKey(certificate: RawCertificate): string | undefined {
  const curve = certificate.nistCurve ?? certificate.asn1Curve;
  if (curve !== undefined) {
    return `EC ${curve}`;
  }
  return certificate.bits === undefined ? undefined : `RSA ${certificate.bits} bits`;
}

/**
 * 인증서가 이 호스트 이름에 쓸 수 있는지 봅니다.
 * 와일드카드는 맨 앞 라벨 하나만 대신하며, 점을 넘어서 맞지는 않습니다. (RFC 6125)
 */
export function matchesHost(names: readonly string[], host: string): boolean {
  const target = host.toLowerCase().replace(/\.$/, '');
  return names.some((name) => {
    const candidate = name.toLowerCase().replace(/\.$/, '');
    if (candidate === target) {
      return true;
    }
    if (isIP(target) !== 0 || !candidate.startsWith('*.')) {
      return false;
    }
    const suffix = candidate.slice(1);
    if (!target.endsWith(suffix)) {
      return false;
    }
    // "*.a.com"은 "b.a.com"에만 맞고 "c.b.a.com"에는 맞지 않습니다.
    return !target.slice(0, -suffix.length).includes('.');
  });
}
