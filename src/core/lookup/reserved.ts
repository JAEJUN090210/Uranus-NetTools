import { BlockList } from 'node:net';

// 사설망, 루프백, 링크 로컬, 문서용 예시 대역처럼 공개 등록 정보가 없는 주소입니다.
const RESERVED_IPV4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const RESERVED_IPV6: readonly (readonly [string, number])[] = [
  ['::', 127],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
];

const reserved = new BlockList();
for (const [network, prefix] of RESERVED_IPV4) {
  reserved.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of RESERVED_IPV6) {
  reserved.addSubnet(network, prefix, 'ipv6');
}

export function isReservedAddress(address: string, family: 4 | 6): boolean {
  return reserved.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
