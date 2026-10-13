import type { networkInterfaces } from 'node:os';

import { describe, expect, it } from 'vitest';

import { isLinkLocal, listInterfaces } from '../../../src/core/local/interfaces';

type Interfaces = NodeJS.Dict<ReturnType<typeof networkInterfaces>[string]>;

const interfaces: Interfaces = {
  'Wi-Fi': [
    {
      address: '192.168.1.25',
      netmask: '255.255.0.0',
      family: 'IPv4',
      mac: '66:30:94:3c:3f:55',
      internal: false,
      cidr: '192.168.1.25/16',
    },
    {
      address: 'fe80::5786:c424:a7de:cc70',
      netmask: 'ffff:ffff:ffff:ffff::',
      family: 'IPv6',
      mac: '66:30:94:3c:3f:55',
      internal: false,
      cidr: 'fe80::5786:c424:a7de:cc70/64',
      scopeid: 9,
    },
  ],
  Tailscale: [
    {
      address: '169.254.83.107',
      netmask: '255.255.0.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: false,
      cidr: '169.254.83.107/16',
    },
  ],
  Loopback: [
    {
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
      mac: '00:00:00:00:00:00',
      internal: true,
      cidr: '127.0.0.1/8',
    },
  ],
};

describe('listInterfaces', () => {
  it('keeps only the interfaces with a usable address', () => {
    const list = listInterfaces({}, interfaces);

    expect(list.map((entry) => entry.name)).toEqual(['Wi-Fi']);
    expect(list[0]?.addresses).toEqual([
      {
        address: '192.168.1.25',
        family: 4,
        cidr: '192.168.1.25/16',
        linkLocal: false,
        internal: false,
      },
    ]);
    expect(list[0]?.mac).toBe('66:30:94:3c:3f:55');
  });

  it('shows loopback and link-local addresses with --all', () => {
    const list = listInterfaces({ all: true }, interfaces);

    expect(list.map((entry) => entry.name)).toEqual(['Wi-Fi', 'Tailscale', 'Loopback']);
    expect(list[0]?.addresses).toHaveLength(2);
    expect(list[1]?.addresses[0]?.linkLocal).toBe(true);
    expect(list[2]?.internal).toBe(true);
  });

  it('leaves out a MAC address the system does not have', () => {
    const list = listInterfaces({ all: true }, interfaces);

    expect(list[1]?.mac).toBeUndefined();
  });

  it('copes with an interface that has no addresses at all', () => {
    const list = listInterfaces({ all: true }, { Empty: [] });

    expect(list).toEqual([{ name: 'Empty', addresses: [], internal: true }]);
  });

  it('skips an address-less interface by default', () => {
    expect(listInterfaces({}, { Empty: [] })).toEqual([]);
  });
});

describe('isLinkLocal', () => {
  it.each([
    ['169.254.83.107', 4, true],
    ['192.168.1.1', 4, false],
    ['fe80::1', 6, true],
    ['fe80::1%eth0', 6, true],
    ['FEB0::1', 6, true],
    ['2001:db8::1', 6, false],
    ['::1', 6, false],
  ] as const)('%s (IPv%i) -> %s', (address, family, expected) => {
    expect(isLinkLocal(address, family)).toBe(expected);
  });
});
