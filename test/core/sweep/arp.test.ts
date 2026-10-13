import { describe, expect, it } from 'vitest';

import { parseArpTable } from '../../../src/core/sweep/arp';

describe('parseArpTable', () => {
  it('reads Windows "arp -a" output (dash separators, several interfaces)', () => {
    const output = [
      'Interface: 192.168.0.23 --- 0x5',
      '  Internet Address      Physical Address      Type',
      '  192.168.0.1           aa-bb-cc-dd-ee-ff     dynamic',
      '  192.168.0.42          00-11-22-33-44-55     dynamic',
      '  192.168.0.255         ff-ff-ff-ff-ff-ff     static',
      '  224.0.0.22            01-00-5e-00-00-16     static',
    ].join('\r\n');

    const table = parseArpTable(output);

    expect(table.get('192.168.0.1')).toBe('AA:BB:CC:DD:EE:FF');
    expect(table.get('192.168.0.42')).toBe('00:11:22:33:44:55');
    // 브로드캐스트 MAC은 특정 기기가 아니라 무시합니다.
    expect(table.has('192.168.0.255')).toBe(false);
  });

  it('reads Linux "arp -an" output', () => {
    const output = [
      '? (192.168.1.1) at a8:5e:45:11:22:33 [ether] on eth0',
      '? (192.168.1.9) at <incomplete> on eth0',
    ].join('\n');

    const table = parseArpTable(output);

    expect(table.get('192.168.1.1')).toBe('A8:5E:45:11:22:33');
    expect(table.has('192.168.1.9')).toBe(false);
  });

  it('reads macOS output with octets that drop a leading zero', () => {
    const output = '? (10.0.0.5) at a:b:c:dd:ee:f on en0 ifscope [ethernet]';

    expect(parseArpTable(output).get('10.0.0.5')).toBe('0A:0B:0C:DD:EE:0F');
  });

  it('reads "ip neigh" output', () => {
    const output = [
      '192.168.0.1 dev wlan0 lladdr aa:bb:cc:dd:ee:ff REACHABLE',
      '192.168.0.7 dev wlan0 FAILED',
    ].join('\n');

    const table = parseArpTable(output);

    expect(table.get('192.168.0.1')).toBe('AA:BB:CC:DD:EE:FF');
    expect(table.has('192.168.0.7')).toBe(false);
  });
});
