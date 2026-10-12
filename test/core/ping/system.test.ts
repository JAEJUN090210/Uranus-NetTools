import { describe, expect, it } from 'vitest';

import { buildPingCommand, parsePingReply } from '../../../src/core/ping/system';

describe('buildPingCommand', () => {
  it('sends one probe with a timeout in milliseconds on Windows', () => {
    expect(buildPingCommand('1.1.1.1', 4, 2000, 'win32', {})).toEqual({
      file: 'ping',
      args: ['-n', '1', '-w', '2000', '-4', '1.1.1.1'],
    });
  });

  it('uses a timeout in seconds and the C locale on Linux', () => {
    expect(buildPingCommand('1.1.1.1', 4, 1500, 'linux', { PATH: '/bin' })).toEqual({
      file: 'ping',
      args: ['-c', '1', '-n', '-W', '2', '-4', '1.1.1.1'],
      env: { PATH: '/bin', LC_ALL: 'C' },
    });
  });

  it('uses a timeout in milliseconds on macOS', () => {
    expect(buildPingCommand('1.1.1.1', 4, 1500, 'darwin', {}).args).toEqual([
      '-c',
      '1',
      '-n',
      '-W',
      '1500',
      '1.1.1.1',
    ]);
  });

  it('uses ping6 for IPv6 on macOS', () => {
    expect(buildPingCommand('::1', 6, 1500, 'darwin', {})).toMatchObject({
      file: 'ping6',
      args: ['-c', '1', '-n', '::1'],
    });
  });
});

describe('parsePingReply', () => {
  it.each([
    [
      'Windows (English)',
      'Pinging 1.1.1.1 with 32 bytes of data:\r\nReply from 1.1.1.1: bytes=32 time=8ms TTL=57\r\n\r\nPing statistics for 1.1.1.1:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\nApproximate round trip times in milli-seconds:\r\n    Minimum = 8ms, Maximum = 8ms, Average = 8ms\r\n',
      { time: 8, ttl: 57 },
    ],
    [
      'Windows (Korean)',
      'Ping 1.1.1.1 32바이트 데이터 사용:\r\n1.1.1.1의 응답: 바이트=32 시간=8ms TTL=57\r\n\r\n1.1.1.1에 대한 Ping 통계:\r\n    패킷: 보냄 = 1, 받음 = 1, 손실 = 0 (0% 손실),\r\n왕복 시간(밀리초):\r\n    최소 = 8ms, 최대 = 8ms, 평균 = 8ms\r\n',
      { time: 8, ttl: 57 },
    ],
    [
      'Windows (German)',
      'Antwort von 1.1.1.1: Bytes=32 Zeit=12ms TTL=57\r\n',
      { time: 12, ttl: 57 },
    ],
    [
      'Windows (French)',
      'Réponse de 1.1.1.1 : octets=32 temps=12 ms TTL=57\r\n',
      { time: 12, ttl: 57 },
    ],
    [
      'Windows under one millisecond',
      'Reply from 127.0.0.1: bytes=32 time<1ms TTL=128\r\n',
      { time: 0.5, ttl: 128 },
    ],
    ['Windows over IPv6 (no TTL)', 'Reply from ::1: time<1ms \r\n', { time: 0.5 }],
    [
      'Linux (iputils)',
      'PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.\n64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=8.12 ms\n\n--- 1.1.1.1 ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss, time 0ms\nrtt min/avg/max/mdev = 8.120/8.120/8.120/0.000 ms\n',
      { time: 8.12, ttl: 57 },
    ],
    [
      'macOS',
      'PING 1.1.1.1 (1.1.1.1): 56 data bytes\n64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=9.345 ms\n\n--- 1.1.1.1 ping statistics ---\n1 packets transmitted, 1 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 9.345/9.345/9.345/0.000 ms\n',
      { time: 9.345, ttl: 57 },
    ],
    [
      'BusyBox',
      'PING 1.1.1.1 (1.1.1.1): 56 data bytes\n64 bytes from 1.1.1.1: seq=0 ttl=57 time=8.100 ms\n',
      { time: 8.1, ttl: 57 },
    ],
  ])('reads the reply from %s', (_name, output, expected) => {
    expect(parsePingReply(output)).toEqual(expected);
  });

  it.each([
    [
      'a Windows timeout',
      'Pinging 10.0.0.9 with 32 bytes of data:\r\nRequest timed out.\r\n\r\nPing statistics for 10.0.0.9:\r\n    Packets: Sent = 1, Received = 0, Lost = 1 (100% loss),\r\n',
    ],
    [
      'a Windows unreachable reply',
      'Pinging 10.0.0.9 with 32 bytes of data:\r\nReply from 10.0.0.1: Destination host unreachable.\r\n\r\nPing statistics for 10.0.0.9:\r\n    Packets: Sent = 1, Received = 1, Lost = 0 (0% loss),\r\n',
    ],
    [
      'a Linux timeout',
      'PING 10.0.0.9 (10.0.0.9) 56(84) bytes of data.\n\n--- 10.0.0.9 ping statistics ---\n1 packets transmitted, 0 received, 100% packet loss, time 0ms\n',
    ],
  ])('finds no reply in %s', (_name, output) => {
    expect(parsePingReply(output)).toBeUndefined();
  });
});
