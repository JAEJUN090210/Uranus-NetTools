/** "2001:db8::1" → "20010db8000000000000000000000001" (32자리 16진수) */
export function expandIpv6(address: string): string {
  let text = address.split('%')[0] ?? address;
  // ::ffff:192.0.2.1 처럼 끝에 IPv4가 붙은 주소는 16진수 두 그룹으로 바꿉니다.
  const embedded = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (embedded) {
    const [whole, ...octets] = embedded;
    const [a = 0, b = 0, c = 0, d = 0] = octets.map(Number);
    text = `${text.slice(0, -whole.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array.from({ length: missing }, () => '0'), ...tailGroups]
    .map((group) => group.padStart(4, '0'))
    .join('')
    .toLowerCase();
}

/**
 * 역방향 DNS 형식으로 주소를 거꾸로 뒤집습니다. IPv4는 옥텟 단위, IPv6는 16진수 한 글자(니블) 단위입니다.
 * 예: 1.2.3.4 → 4.3.2.1
 */
export function reversedLabels(address: string, family: 4 | 6): string {
  if (family === 4) {
    return address.split('.').reverse().join('.');
  }
  // 펼친 주소는 16진수 숫자뿐이라 글자 단위로 나눠도 안전합니다.
  return expandIpv6(address).split('').reverse().join('.');
}

/** PTR 질의 이름입니다. 예: 8.8.8.8 → 8.8.8.8.in-addr.arpa */
export function ptrQueryName(address: string, family: 4 | 6): string {
  return `${reversedLabels(address, family)}.${family === 4 ? 'in-addr.arpa' : 'ip6.arpa'}`;
}
