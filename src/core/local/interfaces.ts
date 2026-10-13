import { networkInterfaces } from 'node:os';

export interface LocalAddress {
  readonly address: string;
  readonly family: 4 | 6;
  /** 주소와 함께 쓰는 프리픽스입니다. (예: 192.168.1.25/24) */
  readonly cidr?: string;
  /** fe80:: 으로 시작하는, 같은 링크 안에서만 쓰는 주소인지 여부입니다. */
  readonly linkLocal: boolean;
  readonly internal: boolean;
}

export interface LocalInterface {
  readonly name: string;
  readonly mac?: string;
  readonly addresses: readonly LocalAddress[];
  /** 루프백처럼 이 컴퓨터 안에서만 쓰는 어댑터인지 여부입니다. */
  readonly internal: boolean;
}

export interface ListOptions {
  /** 루프백·링크로컬·주소 없는 어댑터까지 모두 보여줍니다. */
  readonly all?: boolean;
}

// MAC 주소가 없는 어댑터는 Node가 모두 0으로 알려 줍니다.
const EMPTY_MAC = '00:00:00:00:00:00';

/**
 * 이 컴퓨터의 네트워크 어댑터와 주소를 모읍니다.
 * 기본값은 실제로 쓰는 주소만 보여주고, 루프백과 링크로컬 주소는 빼서 목록을 짧게 유지합니다.
 */
export function listInterfaces(
  options: ListOptions = {},
  interfaces: NodeJS.Dict<ReturnType<typeof networkInterfaces>[string]> = networkInterfaces(),
): LocalInterface[] {
  const result: LocalInterface[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    const mac = entries?.find((entry) => entry.mac !== EMPTY_MAC)?.mac;
    const addresses = (entries ?? []).map(toAddress);
    const shown = options.all === true ? addresses : addresses.filter(isWorth);
    if (shown.length === 0 && options.all !== true) {
      continue;
    }
    result.push({
      name,
      ...(mac === undefined || mac === EMPTY_MAC ? {} : { mac }),
      addresses: shown,
      internal: addresses.every((address) => address.internal),
    });
  }
  return result;
}

/** 어댑터 목록에 담을 만한 주소인지 봅니다. 루프백과 링크로컬은 평소에 볼 일이 없습니다. */
function isWorth(address: LocalAddress): boolean {
  return !address.internal && !address.linkLocal;
}

function toAddress(entry: NonNullable<ReturnType<typeof networkInterfaces>[string]>[number]) {
  const family = entry.family === 'IPv6' ? 6 : 4;
  return {
    address: entry.address,
    family,
    ...(entry.cidr === null ? {} : { cidr: entry.cidr }),
    linkLocal: isLinkLocal(entry.address, family),
    internal: entry.internal,
  } satisfies LocalAddress;
}

/** IPv4는 169.254.0.0/16(APIPA), IPv6은 fe80::/10이 링크로컬입니다. */
export function isLinkLocal(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    return address.startsWith('169.254.');
  }
  const start = address.toLowerCase().split('%')[0] ?? '';
  return /^fe[89ab]/.test(start);
}
