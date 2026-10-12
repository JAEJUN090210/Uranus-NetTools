import { BlockList, isIP } from 'node:net';

import { type AsnInfo, lookupAsn, type TxtResolver } from './cymru';
import type { IpRecord } from './records';
import type { LookupContext, RegistrationService } from './registration';
import { isReservedAddress } from './reserved';

export interface AddressInfo {
  readonly address: string;
  readonly family: 4 | 6;
  /** 사설·예약 주소라서 외부 조회를 하지 않았는지 여부입니다. */
  readonly reserved: boolean;
  readonly hostname?: string;
  readonly asn?: AsnInfo;
  readonly registration?: IpRecord;
  /** 실패한 조회입니다. 나머지 정보는 그대로 보여줍니다. */
  readonly errors: readonly string[];
}

export type RegistrationLookup = (
  address: string,
  family: 4 | 6,
  context: LookupContext,
) => Promise<IpRecord>;

export interface AddressSources {
  readonly registration: RegistrationLookup;
  readonly resolveTxt: TxtResolver;
  /** local은 사설·예약 주소인지 여부입니다. 공개 DNS로는 내부망 이름을 묻지 않습니다. */
  readonly reverse: (address: string, local: boolean) => Promise<string[]>;
}

function familyType(address: string): 'ipv4' | 'ipv6' {
  return isIP(address) === 6 ? 'ipv6' : 'ipv4';
}

/**
 * RDAP 조회를 한 번에 하나씩 보내고, 이미 받은 네트워크 대역에 속한 주소는 다시 묻지 않습니다.
 * 한 도메인의 주소들은 대개 같은 대역이라 요청이 줄고, 동시 요청을 끊어버리는 RDAP 서버도 피할 수 있습니다.
 */
export function createRegistrationLookup(service: RegistrationService): RegistrationLookup {
  const known: { readonly ranges: BlockList; readonly record: IpRecord }[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  return (address, family, context) => {
    const run = async () => {
      const type = family === 4 ? 'ipv4' : 'ipv6';
      const cached = known.find(({ ranges }) => ranges.check(address, type));
      if (cached) {
        return cached.record;
      }
      const { record } = await service.ip(address, family, context);
      const ranges = new BlockList();
      for (const cidr of record.cidrs) {
        const [network = '', prefix = ''] = cidr.split('/');
        ranges.addSubnet(network, Number(prefix), familyType(network));
      }
      if (record.start !== undefined && record.end !== undefined) {
        ranges.addRange(record.start, record.end, familyType(record.start));
      }
      known.push({ ranges, record });
      return record;
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const code = (error as NodeJS.ErrnoException).code;
  // DNS 에러 메시지("queryTxt ETIMEOUT ...")보다 코드가 읽기 쉽습니다.
  return typeof code === 'string' && error.message.includes(code) ? `DNS ${code}` : error.message;
}

/** 역방향 DNS, ASN, RDAP 등록 정보를 함께 조회합니다. 일부가 실패해도 나머지 결과는 돌려줍니다. */
export async function lookupAddress(
  address: string,
  family: 4 | 6,
  sources: AddressSources,
  context: LookupContext,
): Promise<AddressInfo> {
  const reserved = isReservedAddress(address, family);
  const errors: string[] = [];
  const attempt = async <T>(what: string, task: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await task();
    } catch (error) {
      if (context.signal.aborted) {
        throw error;
      }
      errors.push(`${what}: ${describe(error)}`);
      return undefined;
    }
  };

  // 사설·예약 주소는 공개 등록 정보가 없으므로 역방향 DNS(OS 해석기)만 조회합니다.
  const [hostnames, asn, registration] = await Promise.all([
    attempt('reverse DNS', () => sources.reverse(address, reserved)),
    reserved ? undefined : attempt('ASN', () => lookupAsn(address, family, sources.resolveTxt)),
    reserved ? undefined : attempt('RDAP', () => sources.registration(address, family, context)),
  ]);

  return {
    address,
    family,
    reserved,
    ...(hostnames?.[0] === undefined ? {} : { hostname: hostnames[0] }),
    ...(asn === undefined ? {} : { asn }),
    ...(registration === undefined ? {} : { registration }),
    errors,
  };
}
