import { describe, expect, it, vi } from 'vitest';

import { type HostProbe, type Liveness, sweepHosts } from '../../../src/core/sweep/sweeper';

const never = new AbortController().signal;

/** 주소별로 정해 둔 응답을 돌려주는 가짜 probe입니다. */
function scripted(answers: Record<string, Liveness>): HostProbe {
  return (address) => Promise.resolve(answers[address]);
}

describe('sweepHosts', () => {
  it('keeps the live hosts, merges MAC/vendor/host names, and sorts by address', async () => {
    const result = await sweepHosts({
      addresses: ['192.168.0.10', '192.168.0.2', '192.168.0.3'],
      concurrency: 8,
      signal: never,
      probe: scripted({
        '192.168.0.10': { via: 'icmp', time: 4 },
        '192.168.0.2': { via: 'tcp' },
        '192.168.0.3': undefined,
      }),
      arp: () => Promise.resolve(new Map([['192.168.0.2', 'AA:BB:CC:00:00:01']])),
      hostname: (address) => Promise.resolve(address === '192.168.0.10' ? 'host-ten' : undefined),
      vendor: (mac) => (mac === 'AA:BB:CC:00:00:01' ? 'Acme' : undefined),
    });

    expect(result.complete).toBe(true);
    expect(result.hosts).toEqual([
      { address: '192.168.0.2', via: 'tcp', mac: 'AA:BB:CC:00:00:01', vendor: 'Acme' },
      { address: '192.168.0.10', via: 'icmp', time: 4, hostname: 'host-ten' },
    ]);
  });

  it('adds hosts that only appear in the ARP table (silent but present)', async () => {
    const result = await sweepHosts({
      addresses: ['10.0.0.1', '10.0.0.2'],
      concurrency: 4,
      signal: never,
      probe: scripted({ '10.0.0.1': { via: 'icmp', time: 1 }, '10.0.0.2': undefined }),
      arp: () => Promise.resolve(new Map([['10.0.0.2', 'DE:AD:BE:EF:00:02']])),
    });

    expect(result.hosts).toEqual([
      { address: '10.0.0.1', via: 'icmp', time: 1 },
      { address: '10.0.0.2', via: 'arp', mac: 'DE:AD:BE:EF:00:02' },
    ]);
  });

  it('ignores ARP entries outside the swept range', async () => {
    const result = await sweepHosts({
      addresses: ['10.0.0.1'],
      concurrency: 4,
      signal: never,
      probe: scripted({ '10.0.0.1': undefined }),
      arp: () => Promise.resolve(new Map([['10.0.0.99', 'DE:AD:BE:EF:00:99']])),
    });

    expect(result.hosts).toEqual([]);
  });

  it('runs at most `concurrency` probes at a time', async () => {
    let running = 0;
    let peak = 0;
    const probe: HostProbe = async () => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      return undefined;
    };

    await sweepHosts({
      addresses: Array.from({ length: 20 }, (_unused, index) => `10.0.0.${String(index)}`),
      concurrency: 4,
      signal: never,
      probe,
      arp: () => Promise.resolve(new Map()),
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it('stops probing when cancelled and reports it as incomplete', async () => {
    const controller = new AbortController();
    const probe: HostProbe = (address) => {
      if (address === '10.0.0.3') {
        controller.abort();
      }
      return Promise.resolve<Liveness>({ via: 'icmp', time: 1 });
    };
    const arp = vi.fn(() => Promise.resolve(new Map<string, string>()));

    const result = await sweepHosts({
      addresses: ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5'],
      concurrency: 1,
      signal: controller.signal,
      probe,
      arp,
    });

    expect(result.complete).toBe(false);
    expect(result.hosts.length).toBeLessThan(5);
    // 취소되면 ARP 읽기와 이름 조회는 건너뜁니다.
    expect(arp).not.toHaveBeenCalled();
  });

  it('still returns the hosts when reading the ARP table fails', async () => {
    const result = await sweepHosts({
      addresses: ['10.0.0.1'],
      concurrency: 1,
      signal: never,
      probe: scripted({ '10.0.0.1': { via: 'icmp', time: 2 } }),
      arp: () => Promise.reject(new Error('arp failed')),
    });

    expect(result.hosts).toEqual([{ address: '10.0.0.1', via: 'icmp', time: 2 }]);
  });
});
