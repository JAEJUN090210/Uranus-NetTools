import { describe, expect, it } from 'vitest';

import {
  inNetwork,
  intToIp,
  ipToInt,
  localSubnets,
  parseTargets,
} from '../../../src/core/sweep/range';

describe('ipToInt / intToIp', () => {
  it.each([
    ['0.0.0.0', 0],
    ['0.0.0.1', 1],
    ['192.168.0.1', 0xc0a80001],
    ['255.255.255.255', 0xffffffff],
  ])('%s <-> %i', (ip, value) => {
    expect(ipToInt(ip)).toBe(value);
    expect(intToIp(value)).toBe(ip);
  });
});

describe('parseTargets', () => {
  it('reads a single address', () => {
    expect(parseTargets('192.168.0.5', 65536)).toEqual({
      addresses: ['192.168.0.5'],
      description: '192.168.0.5',
    });
  });

  it('expands a /30 without the network and broadcast addresses', () => {
    const targets = parseTargets('192.168.0.0/30', 65536);

    expect(targets.addresses).toEqual(['192.168.0.1', '192.168.0.2']);
    expect(targets.description).toBe('192.168.0.0/30');
    expect(targets.network).toEqual({ base: ipToInt('192.168.0.0'), prefix: 30 });
  });

  it('keeps both addresses of a /31', () => {
    expect(parseTargets('10.0.0.4/31', 65536).addresses).toEqual(['10.0.0.4', '10.0.0.5']);
  });

  it('snaps a CIDR to its network base', () => {
    expect(parseTargets('192.168.1.130/24', 65536).description).toBe('192.168.1.0/24');
  });

  it('reads a short range as the last octet', () => {
    expect(parseTargets('192.168.0.10-12', 65536).addresses).toEqual([
      '192.168.0.10',
      '192.168.0.11',
      '192.168.0.12',
    ]);
  });

  it('reads a full range across octets', () => {
    expect(parseTargets('192.168.0.254-192.168.1.1', 65536).addresses).toEqual([
      '192.168.0.254',
      '192.168.0.255',
      '192.168.1.0',
      '192.168.1.1',
    ]);
  });

  it.each([
    ['example.com', 'not an IPv4 address'],
    ['192.168.0.0/33', 'not a valid CIDR block'],
    ['192.168.0.0/-1', 'not a valid CIDR block'],
    ['10.0.0.5-1', 'ends before it starts'],
    ['10.0.0.1-999', 'not a valid range end'],
  ])('rejects %j', (spec, message) => {
    expect(() => parseTargets(spec, 65536)).toThrow(message);
  });

  it('refuses a range larger than the limit', () => {
    expect(() => parseTargets('10.0.0.0/8', 65536)).toThrow('16,777,214 addresses');
  });
});

describe('localSubnets', () => {
  const interfaces = {
    'Wi-Fi': [
      {
        address: '192.168.0.23',
        family: 'IPv4',
        internal: false,
        cidr: '192.168.0.23/24',
      } as never,
    ],
    Ethernet: [
      { address: '10.0.5.2', family: 'IPv4', internal: false, cidr: '10.0.5.2/16' } as never,
    ],
    Tailscale: [
      {
        address: '169.254.83.107',
        family: 'IPv4',
        internal: false,
        cidr: '169.254.83.107/16',
      } as never,
    ],
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true, cidr: '127.0.0.1/8' } as never],
  };

  it('skips loopback and link-local, and lists the most specific subnet first', () => {
    const subnets = localSubnets(interfaces);

    expect(subnets.map((subnet) => subnet.description)).toEqual(['192.168.0.0/24', '10.0.0.0/16']);
    expect(subnets[0]?.interface).toBe('Wi-Fi');
  });

  it('omits the host its own address from the list', () => {
    const subnet = localSubnets(interfaces)[0];

    expect(subnet?.addresses).not.toContain('192.168.0.23');
    expect(subnet?.addresses).toContain('192.168.0.1');
    expect(subnet?.addresses).toHaveLength(253);
  });
});

describe('inNetwork', () => {
  const network = { base: ipToInt('192.168.0.0'), prefix: 24 };

  it.each([
    ['192.168.0.1', true],
    ['192.168.0.254', true],
    ['192.168.1.1', false],
  ])('%s -> %s', (address, expected) => {
    expect(inNetwork(address, network)).toBe(expected);
  });

  it('is false without a network', () => {
    expect(inNetwork('192.168.0.1', undefined)).toBe(false);
  });
});
