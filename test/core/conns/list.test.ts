import { describe, expect, it } from 'vitest';

import {
  isEstablished,
  isListening,
  parseBsd,
  parseEndpoint,
  parseLinuxNetstat,
  parseLsof,
  parseSs,
  parseWindows,
  socketKey,
} from '../../../src/core/conns/list';

describe('parseEndpoint', () => {
  it.each([
    ['0.0.0.0:135', { address: '0.0.0.0', port: 135 }],
    ['127.0.0.1:49152', { address: '127.0.0.1', port: 49152 }],
    ['[::]:445', { address: '::', port: 445 }],
    ['[::1]:80', { address: '::1', port: 80 }],
    // BSD는 포트를 점으로 구분하고 모든 주소를 *로 적습니다.
    ['127.0.0.1.49152', { address: '127.0.0.1', port: 49152 }],
    ['*.22', { address: '0.0.0.0', port: 22 }],
    // 존이 붙은 IPv6은 존을 떼어 냅니다.
    ['[fe80::1%eth0]:80', { address: 'fe80::1', port: 80 }],
  ])('%s', (text, expected) => {
    expect(parseEndpoint(text)).toEqual(expected);
  });

  it.each(['*:*', '*.*', '', 'nonsense'])('has no endpoint for %j', (text) => {
    expect(parseEndpoint(text)).toBeUndefined();
  });
});

describe('isListening / isEstablished', () => {
  it.each([
    ['LISTENING', true, false],
    ['LISTEN', true, false],
    ['ESTABLISHED', false, true],
    // 정리 중인 소켓은 둘 다 아닙니다.
    ['TIME_WAIT', false, false],
    [undefined, false, false],
  ])('%s', (state, listening, established) => {
    const connection = {
      protocol: 'tcp' as const,
      local: { address: '0.0.0.0', port: 1 },
      ...(state === undefined ? {} : { state }),
    };

    expect(isListening(connection)).toBe(listening);
    expect(isEstablished(connection)).toBe(established);
  });
});

describe('parseWindows', () => {
  // 한국어 Windows의 실제 출력입니다. 머리글은 번역되지만 자료 줄은 ASCII입니다.
  const output = [
    '활성 연결',
    '',
    '  프로토콜  로컬 주소              외부 주소              상태            PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       2044',
    '  TCP    [::]:445               [::]:0                 LISTENING       4',
    '  TCP    127.0.0.1:19587        127.0.0.1:45823        ESTABLISHED     48124',
    '  TCP    127.0.0.1:17184        127.0.0.1:49350        TIME_WAIT       0',
    '  UDP    0.0.0.0:123            *:*                                    4048',
  ].join('\r\n');

  it('reads the protocol, addresses, state and process number', () => {
    const connections = parseWindows(output);

    expect(connections).toHaveLength(5);
    expect(connections[0]).toEqual({
      protocol: 'tcp',
      local: { address: '0.0.0.0', port: 135 },
      state: 'LISTENING',
      pid: 2044,
    });
    expect(connections[2]).toEqual({
      protocol: 'tcp',
      local: { address: '127.0.0.1', port: 19587 },
      remote: { address: '127.0.0.1', port: 45823 },
      state: 'ESTABLISHED',
      pid: 48124,
    });
  });

  it('reads IPv6 rows and leaves out a port-0 remote', () => {
    expect(parseWindows(output)[1]).toEqual({
      protocol: 'tcp',
      local: { address: '::', port: 445 },
      state: 'LISTENING',
      pid: 4,
    });
  });

  it('treats process number 0 as no owner', () => {
    expect(parseWindows(output)[3]?.pid).toBeUndefined();
  });

  it('reads UDP rows, which have no state', () => {
    expect(parseWindows(output)[4]).toEqual({
      protocol: 'udp',
      local: { address: '0.0.0.0', port: 123 },
      pid: 4048,
    });
  });
});

describe('parseSs', () => {
  const output = [
    'Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'tcp   LISTEN 0      128    0.0.0.0:22         0.0.0.0:*         users:(("sshd",pid=800,fd=3))',
    'tcp   ESTAB  0      0      10.0.0.5:22        10.0.0.9:50132    users:(("sshd",pid=1234,fd=4))',
    'udp   UNCONN 0      0      0.0.0.0:68         0.0.0.0:*         users:(("dhclient",pid=500,fd=6))',
    'tcp   LISTEN 0      128    [::]:22            [::]:*',
  ].join('\n');

  it('reads the state, addresses and process number', () => {
    const connections = parseSs(output);

    expect(connections[0]).toEqual({
      protocol: 'tcp',
      local: { address: '0.0.0.0', port: 22 },
      state: 'LISTEN',
      pid: 800,
    });
    expect(connections[1]).toEqual({
      protocol: 'tcp',
      local: { address: '10.0.0.5', port: 22 },
      remote: { address: '10.0.0.9', port: 50132 },
      state: 'ESTAB',
      pid: 1234,
    });
  });

  it('treats UNCONN as having no state', () => {
    expect(parseSs(output)[2]?.state).toBeUndefined();
  });

  it('copes with a row that has no process information', () => {
    expect(parseSs(output)[3]).toEqual({
      protocol: 'tcp',
      local: { address: '::', port: 22 },
      state: 'LISTEN',
    });
  });
});

describe('parseLinuxNetstat', () => {
  const output = [
    'Active Internet connections (servers and established)',
    'Proto Recv-Q Send-Q Local Address  Foreign Address  State   PID/Program name',
    'tcp        0      0 0.0.0.0:22     0.0.0.0:*        LISTEN  800/sshd',
    'tcp6       0      0 :::80          :::*             LISTEN  900/nginx',
    'udp        0      0 0.0.0.0:68     0.0.0.0:*                500/dhclient',
  ].join('\n');

  it('reads rows and strips the 4 or 6 from the protocol', () => {
    const connections = parseLinuxNetstat(output);

    expect(connections[0]).toEqual({
      protocol: 'tcp',
      local: { address: '0.0.0.0', port: 22 },
      state: 'LISTEN',
      pid: 800,
    });
    expect(connections[1]?.protocol).toBe('tcp');
    expect(connections[1]?.local).toEqual({ address: '::', port: 80 });
    expect(connections[2]).toEqual({
      protocol: 'udp',
      local: { address: '0.0.0.0', port: 68 },
      pid: 500,
    });
  });
});

describe('parseBsd', () => {
  const output = [
    'Active Internet connections (including servers)',
    'Proto Recv-Q Send-Q  Local Address    Foreign Address  (state)',
    'tcp4       0      0  *.22             *.*              LISTEN',
    'tcp4       0      0  192.168.1.25.50693 93.184.216.34.443 ESTABLISHED',
    'udp4       0      0  *.68             *.*',
  ].join('\n');

  it('reads BSD style addresses and states', () => {
    const connections = parseBsd(output);

    expect(connections[0]).toEqual({
      protocol: 'tcp',
      local: { address: '0.0.0.0', port: 22 },
      state: 'LISTEN',
    });
    expect(connections[1]).toEqual({
      protocol: 'tcp',
      local: { address: '192.168.1.25', port: 50693 },
      remote: { address: '93.184.216.34', port: 443 },
      state: 'ESTABLISHED',
    });
    // macOS의 netstat은 프로세스 번호를 믿을 수 없게 주므로 담지 않습니다.
    expect(connections[1]?.pid).toBeUndefined();
  });

  it('reads UDP rows without a state', () => {
    expect(parseBsd(output)[2]).toEqual({
      protocol: 'udp',
      local: { address: '0.0.0.0', port: 68 },
    });
  });
});

describe('parseLsof', () => {
  const output = [
    'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'sshd      800 root    3u  IPv4 0x1234      0t0  TCP *:22 (LISTEN)',
    'Safari   1234  pat   30u  IPv4 0x5678      0t0  TCP 192.168.1.25:50693->93.184.216.34:443 (ESTABLISHED)',
    'mDNSResp  450 _mdns   7u  IPv4 0x9abc      0t0  UDP *:5353',
  ].join('\n');

  it('maps sockets to the program that owns them', () => {
    const owners = parseLsof(output);

    expect(owners.get(socketKey('tcp', { address: '0.0.0.0', port: 22 }))).toEqual({
      pid: 800,
      command: 'sshd',
    });
    expect(owners.get(socketKey('tcp', { address: '192.168.1.25', port: 50693 }))).toEqual({
      pid: 1234,
      command: 'Safari',
    });
    expect(owners.get(socketKey('udp', { address: '0.0.0.0', port: 5353 }))).toEqual({
      pid: 450,
      command: 'mDNSResp',
    });
  });

  it('ignores the header row', () => {
    expect(parseLsof(output).size).toBe(3);
  });
});
