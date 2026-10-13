import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

export interface Targets {
  /** 검사할 IPv4 주소 목록입니다. */
  readonly addresses: string[];
  /** 사용자에게 보여줄 범위 설명입니다. (예: 192.168.0.0/24) */
  readonly description: string;
  /** 같은 LAN인지 판단할 때 쓰는 네트워크 정보입니다. 범위로 지정하면 없을 수 있습니다. */
  readonly network?: { readonly base: number; readonly prefix: number };
}

export interface LocalSubnet extends Targets {
  readonly interface: string;
  /** 이 컴퓨터의 주소입니다. 검사 대상에서는 빠집니다. */
  readonly address: string;
}

export function ipToInt(address: string): number {
  return address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0) >>> 0;
}

export function intToIp(value: number): string {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
    '.',
  );
}

/**
 * "192.168.0.0/24", "192.168.0.1-100", "192.168.0.1-192.168.0.50", "192.168.0.5" 형식을 주소 목록으로 바꿉니다.
 * 주소가 maxAddresses를 넘으면 범위를 좁히라는 메시지와 함께 RangeError를 던집니다.
 */
export function parseTargets(spec: string, maxAddresses: number): Targets {
  const text = spec.trim();
  const slash = text.indexOf('/');
  if (slash !== -1) {
    return cidrTargets(text.slice(0, slash), text.slice(slash + 1), maxAddresses);
  }
  const dash = text.indexOf('-');
  if (dash !== -1) {
    return rangeTargets(text.slice(0, dash).trim(), text.slice(dash + 1).trim(), maxAddresses);
  }
  if (!isIPv4(text)) {
    throw new RangeError(`${spec} is not an IPv4 address, range or CIDR block.`);
  }
  return { addresses: [text], description: text };
}

function cidrTargets(address: string, prefixText: string, maxAddresses: number): Targets {
  const prefix = /^\d+$/.test(prefixText) ? Number(prefixText) : Number.NaN;
  if (!isIPv4(address) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`${address}/${prefixText} is not a valid CIDR block.`);
  }
  const size = 2 ** (32 - prefix);
  const base = (ipToInt(address) & (prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0)) >>> 0;
  // /31, /32는 네트워크·브로드캐스트 주소까지 모두 검사하고, 그보다 큰 블록은 쓰지 않는 두 주소를 뺍니다.
  const usable = size <= 2 ? size : size - 2;
  check(usable, maxAddresses);
  const first = size <= 2 ? base : base + 1;
  const addresses = Array.from({ length: usable }, (_unused, index) => intToIp(first + index));
  return { addresses, description: `${intToIp(base)}/${prefix}`, network: { base, prefix } };
}

function rangeTargets(startText: string, endText: string, maxAddresses: number): Targets {
  if (!isIPv4(startText)) {
    throw new RangeError(`${startText} is not an IPv4 address.`);
  }
  // 끝을 숫자 하나로만 적으면(192.168.0.1-100) 시작 주소의 마지막 자리만 바꿉니다.
  const endAddress = /^\d{1,3}$/.test(endText)
    ? `${startText.slice(0, startText.lastIndexOf('.') + 1)}${endText}`
    : endText;
  if (!isIPv4(endAddress)) {
    throw new RangeError(`${endText} is not a valid range end.`);
  }
  const start = ipToInt(startText);
  const end = ipToInt(endAddress);
  if (end < start) {
    throw new RangeError(`${startText}-${endText} ends before it starts.`);
  }
  check(end - start + 1, maxAddresses);
  const addresses = Array.from({ length: end - start + 1 }, (_unused, index) =>
    intToIp(start + index),
  );
  return { addresses, description: `${startText}-${intToIp(end)}` };
}

function check(count: number, maxAddresses: number): void {
  if (count > maxAddresses) {
    throw new RangeError(
      `that is ${count.toLocaleString('en')} addresses; keep it to ${maxAddresses.toLocaleString('en')} or fewer (a /${(32 - Math.log2(maxAddresses)).toString()} block).`,
    );
  }
}

/** 지금 연결된 인터페이스들의 IPv4 서브넷을 찾습니다. 루프백과 내부 주소는 뺍니다. */
export function localSubnets(
  interfaces: NodeJS.Dict<
    NonNullable<ReturnType<typeof networkInterfaces>[string]>
  > = networkInterfaces(),
): LocalSubnet[] {
  const subnets: LocalSubnet[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const entry of addresses ?? []) {
      if (family(entry) !== 'IPv4' || entry.internal || entry.cidr === null) {
        continue;
      }
      // 169.254.x.x(APIPA)는 DHCP를 못 받았을 때 붙는 자동 주소라 실제 LAN이 아닙니다. /16이라 범위도 너무 넓습니다.
      if (entry.address.startsWith('169.254.')) {
        continue;
      }
      const prefix = Number(entry.cidr.split('/')[1]);
      // 큰 서브넷(/16보다 큼)은 자동으로 전부 훑기엔 너무 넓어 건너뜁니다. 그럴 땐 범위를 직접 지정합니다.
      if (!Number.isInteger(prefix) || prefix < 16 || prefix > 32) {
        continue;
      }
      const size = 2 ** (32 - prefix);
      const base = (ipToInt(entry.address) & ((-1 << (32 - prefix)) >>> 0)) >>> 0;
      const self = ipToInt(entry.address);
      const addressList: string[] = [];
      for (let offset = size <= 2 ? 0 : 1; offset < (size <= 2 ? size : size - 1); offset++) {
        const value = base + offset;
        if (value !== self) {
          addressList.push(intToIp(value));
        }
      }
      subnets.push({
        interface: name,
        address: entry.address,
        addresses: addressList,
        description: `${intToIp(base)}/${prefix}`,
        network: { base, prefix },
      });
    }
  }
  // 가장 좁은(가장 구체적인) 서브넷을 앞에 둬서 자동 모드가 보통의 /24 LAN을 고르게 합니다.
  return subnets.sort((a, b) => (b.network?.prefix ?? 0) - (a.network?.prefix ?? 0));
}

/** Node 버전에 따라 family가 'IPv4'거나 4라서 둘 다 받아 줍니다. */
function family(entry: { family: string | number }): 'IPv4' | 'IPv6' {
  return entry.family === 'IPv4' || entry.family === 4 ? 'IPv4' : 'IPv6';
}

/** 주소가 같은 LAN(같은 서브넷)에 있는지 봅니다. ARP로 얻은 MAC은 같은 LAN일 때만 믿을 수 있습니다. */
export function inNetwork(address: string, network: Targets['network']): boolean {
  if (network === undefined) {
    return false;
  }
  const mask = network.prefix === 0 ? 0 : (-1 << (32 - network.prefix)) >>> 0;
  return (ipToInt(address) & mask) >>> 0 === network.base;
}
