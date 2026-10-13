import { describe, expect, it } from 'vitest';

import {
  parseBsd,
  parseIpRoute,
  parseLinuxRoute,
  parseWindowsIpv4,
  parseWindowsIpv6,
} from '../../../src/core/local/gateway';

describe('parseWindowsIpv4', () => {
  // 한국어 Windows의 실제 출력입니다. 설명은 번역되지만 기본 경로 줄은 숫자뿐입니다.
  const output = [
    'IPv4 경로 테이블',
    '===========================================================================',
    '활성 경로:',
    '네트워크 대상    네트워크 마스크     게이트웨이      인터페이스    메트릭',
    '          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.25     35',
    '        127.0.0.0        255.0.0.0             연결됨         127.0.0.1    331',
    '      192.168.0.0      255.255.0.0             연결됨      192.168.1.25    286',
  ].join('\r\n');

  it('finds the default route and keeps the interface address and metric', () => {
    expect(parseWindowsIpv4(output)).toEqual([
      { address: '192.168.1.1', family: 4, via: '192.168.1.25', metric: 35 },
    ]);
  });

  it('ignores on-link rows whatever language they are in', () => {
    expect(
      parseWindowsIpv4(
        '      192.168.0.0      255.255.0.0             연결됨      192.168.1.25    286',
      ),
    ).toEqual([]);
  });

  it('reads several default routes', () => {
    const two = [
      '          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.25     35',
      '          0.0.0.0          0.0.0.0       10.0.0.1        10.0.0.5        25',
    ].join('\n');

    expect(parseWindowsIpv4(two).map((gateway) => gateway.address)).toEqual([
      '192.168.1.1',
      '10.0.0.1',
    ]);
  });

  it('finds nothing in an empty table', () => {
    expect(parseWindowsIpv4('')).toEqual([]);
  });
});

describe('parseWindowsIpv6', () => {
  const output = [
    'IPv6 경로 테이블',
    '활성 경로:',
    ' If 메트릭 네트워크 대상              게이트웨이',
    '  9    271 ::/0                     fe80::1%9',
    '  1    331 ::1/128                  연결됨',
  ].join('\r\n');

  it('finds the default route and drops the zone suffix', () => {
    expect(parseWindowsIpv6(output)).toEqual([
      { address: 'fe80::1', family: 6, via: '9', metric: 271 },
    ]);
  });
});

describe('parseIpRoute', () => {
  it('reads an "ip route" default line', () => {
    const output = 'default via 192.168.1.1 dev wlan0 proto dhcp src 192.168.1.25 metric 600';

    expect(parseIpRoute(output, 4)).toEqual([
      { address: '192.168.1.1', family: 4, via: 'wlan0', metric: 600 },
    ]);
  });

  it('reads an IPv6 default line without a metric', () => {
    expect(parseIpRoute('default via fe80::1 dev eth0', 6)).toEqual([
      { address: 'fe80::1', family: 6, via: 'eth0' },
    ]);
  });

  it('ignores routes of the other family', () => {
    expect(parseIpRoute('default via fe80::1 dev eth0', 4)).toEqual([]);
  });
});

describe('parseBsd', () => {
  it('reads the default line from netstat -rn', () => {
    const output = [
      'Routing tables',
      'Internet:',
      'Destination        Gateway            Flags     Netif Expire',
      'default            192.168.1.1        UGScg     en0',
      '127                127.0.0.1          UCS       lo0',
    ].join('\n');

    expect(parseBsd(output, 4)).toEqual([{ address: '192.168.1.1', family: 4, via: 'en0' }]);
  });

  it('reads an IPv6 default line and drops the zone', () => {
    const output = 'default                             fe80::1%en0                     UGcg en0';

    expect(parseBsd(output, 6)).toEqual([{ address: 'fe80::1', family: 6, via: 'en0' }]);
  });
});

describe('parseLinuxRoute', () => {
  it('reads the gateway row from route -n', () => {
    const output = [
      'Kernel IP routing table',
      'Destination     Gateway         Genmask         Flags Metric Ref    Use Iface',
      '0.0.0.0         192.168.1.1     0.0.0.0         UG    600    0        0 wlan0',
      '192.168.1.0     0.0.0.0         255.255.255.0   U     600    0        0 wlan0',
    ].join('\n');

    expect(parseLinuxRoute(output)).toEqual([
      { address: '192.168.1.1', family: 4, via: 'wlan0', metric: 600 },
    ]);
  });

  it('ignores rows without the gateway flag', () => {
    const output = '0.0.0.0         0.0.0.0         0.0.0.0         U     0      0        0 eth0';

    expect(parseLinuxRoute(output)).toEqual([]);
  });
});
