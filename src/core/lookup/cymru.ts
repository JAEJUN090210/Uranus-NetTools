import { isMissingRecord } from './dns';
import { reversedLabels } from './reverse-name';

/** BGP에서 이 주소를 광고하는 AS 정보입니다. Team Cymru의 IP-to-ASN 서비스에서 가져옵니다. */
export interface AsnInfo {
  readonly asn: number;
  /** 같은 대역을 여러 AS가 함께 광고할 때(애니캐스트 등) 나머지 AS 번호입니다. */
  readonly otherAsns: readonly number[];
  readonly name?: string;
  /** BGP로 광고되는 대역입니다. */
  readonly prefix?: string;
  readonly country?: string;
  readonly registry?: string;
  readonly allocated?: string;
}

export type TxtResolver = (name: string) => Promise<string[][]>;

interface Origin {
  readonly asns: readonly number[];
  readonly prefix?: string;
  readonly country?: string;
  readonly registry?: string;
  readonly allocated?: string;
}

/** 8.8.8.8 → 8.8.8.8.origin.asn.cymru.com 처럼 주소를 거꾸로 뒤집은 질의 이름을 만듭니다. */
export function originQueryName(address: string, family: 4 | 6): string {
  const zone = family === 4 ? 'origin.asn.cymru.com' : 'origin6.asn.cymru.com';
  return `${reversedLabels(address, family)}.${zone}`;
}

/** "13335 209242 | 1.1.1.0/24 | AU | apnic | 2011-08-11" */
export function parseOrigin(record: string): Origin | undefined {
  const [asnText = '', prefix = '', country = '', registry = '', allocated = ''] = record
    .split('|')
    .map((part) => part.trim());
  const asns = asnText
    .split(/\s+/)
    .map(Number)
    .filter((asn) => Number.isInteger(asn) && asn > 0);
  if (asns.length === 0) {
    return undefined;
  }
  return {
    asns,
    ...(prefix === '' ? {} : { prefix }),
    ...(country === '' ? {} : { country }),
    ...(registry === '' ? {} : { registry }),
    ...(allocated === '' ? {} : { allocated }),
  };
}

/** "15169 | US | arin | 2000-03-30 | GOOGLE, US" → "GOOGLE, US" */
export function parseAsName(record: string): string | undefined {
  const name = record.split('|')[4]?.trim();
  return name === undefined || name === '' ? undefined : name;
}

function prefixLength(prefix: string | undefined): number {
  return Number(prefix?.split('/')[1] ?? 0);
}

async function txtRecords(resolveTxt: TxtResolver, name: string): Promise<string[]> {
  try {
    return (await resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch (error) {
    if (isMissingRecord(error)) {
      return [];
    }
    throw error;
  }
}

/** 주소를 광고하는 AS를 찾습니다. BGP에 광고되지 않는 주소면 undefined입니다. */
export async function lookupAsn(
  address: string,
  family: 4 | 6,
  resolveTxt: TxtResolver,
): Promise<AsnInfo | undefined> {
  const origins = (await txtRecords(resolveTxt, originQueryName(address, family)))
    .map(parseOrigin)
    .filter((origin) => origin !== undefined)
    // 겹치는 대역이 여러 개면 가장 좁은(구체적인) 대역을 고릅니다.
    .sort((a, b) => prefixLength(b.prefix) - prefixLength(a.prefix));
  const [origin] = origins;
  const [asn, ...otherAsns] = origin?.asns ?? [];
  if (origin === undefined || asn === undefined) {
    return undefined;
  }

  // AS 이름을 못 가져와도 ASN은 보여줄 수 있으므로 실패를 무시합니다.
  const [nameRecord] = await txtRecords(resolveTxt, `AS${asn}.asn.cymru.com`).catch(() => []);
  return {
    asn,
    otherAsns,
    name: nameRecord === undefined ? undefined : parseAsName(nameRecord),
    prefix: origin.prefix,
    country: origin.country,
    registry: origin.registry,
    allocated: origin.allocated,
  };
}
