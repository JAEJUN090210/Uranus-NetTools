import { isIP } from 'node:net';
import { domainToASCII, domainToUnicode } from 'node:url';

import { UserError } from '../../cli/errors';

export type LookupTarget =
  | { readonly kind: 'domain'; readonly name: string; readonly unicode: string }
  | { readonly kind: 'ip'; readonly address: string; readonly family: 4 | 6 }
  | { readonly kind: 'asn'; readonly number: number };

const MAX_ASN = 4_294_967_295;

/** 입력이 도메인, IP 주소, AS 번호 중 무엇인지 판별합니다. URL을 붙여넣으면 호스트 이름만 씁니다. */
export function parseLookupTarget(input: string): LookupTarget {
  const trimmed = input.trim();
  const asn = /^as(\d+)$/i.exec(trimmed);
  if (asn) {
    const [, digits = ''] = asn;
    const number = Number(digits);
    if (number > MAX_ASN) {
      throw new UserError(`${input} is not a valid AS number`);
    }
    return { kind: 'asn', number };
  }

  const host = hostOf(trimmed);
  const family = isIP(host);
  if (family === 4 || family === 6) {
    return { kind: 'ip', address: host, family };
  }
  // 한글 같은 국제화 도메인은 퓨니코드(xn--)로 바꿔서 조회합니다.
  const name = domainToASCII(host.replace(/\.$/, ''));
  if (!name.includes('.')) {
    throw new UserError(`${input} is not a domain name, IP address or AS number`);
  }
  return { kind: 'domain', name, unicode: domainToUnicode(name) };
}

function hostOf(value: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      return new URL(value).hostname.replace(/^\[(.*)\]$/, '$1');
    } catch {
      return value;
    }
  }
  return value.replace(/^\[(.*)\]$/, '$1');
}
