import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createSweepCommand, type SweepServices } from '../../src/commands/sweep';
import type { LocalSubnet } from '../../src/core/sweep/range';
import type { HostProbe, Liveness } from '../../src/core/sweep/sweeper';
import { createTestRuntime } from '../helpers/runtime';

const subnet: LocalSubnet = {
  interface: 'Wi-Fi',
  address: '192.168.0.23',
  addresses: ['192.168.0.1', '192.168.0.2', '192.168.0.3'],
  description: '192.168.0.0/24',
  network: { base: 0xc0a80000, prefix: 24 },
};

const liveness: Record<string, Liveness> = {
  '192.168.0.1': { via: 'icmp', time: 2.5 },
  '192.168.0.2': undefined,
  '192.168.0.3': undefined,
};

/** 네트워크를 건드리지 않는 가짜 조회 수단입니다. 테스트마다 덮어쓸 수 있습니다. */
function fakeServices(overrides: Partial<SweepServices> = {}): SweepServices {
  return {
    localSubnets: () => [subnet],
    isPublic: () => false,
    probe: (): HostProbe => (address) => Promise.resolve(liveness[address]),
    readArp: () => Promise.resolve(new Map([['192.168.0.3', 'E4:5F:01:00:00:01']])),
    hostname: () => (address) =>
      Promise.resolve(address === '192.168.0.1' ? 'gateway.local' : undefined),
    vendor: (mac) => (mac === 'E4:5F:01:00:00:01' ? 'Raspberry Pi' : undefined),
    ...overrides,
  };
}

function groupsWith(services: SweepServices): readonly CommandGroup[] {
  return [{ heading: 'Scanning:', commands: [(runtime) => createSweepCommand(runtime, services)] }];
}

describe('unt sweep', () => {
  it('is listed under Scanning in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Scanning:\n(?:.*\n)*?\s+sweep/);
  });

  it('rejects an invalid range', async () => {
    const { runtime, stderr } = createTestRuntime();

    expect(await runCommand(['sweep', 'notanip'], runtime, groupsWith(fakeServices()))).toBe(1);
    expect(stderr()).toContain('not an IPv4 address, range or CIDR block');
  });

  it('sweeps the local subnet when no range is given', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['sweep'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toContain('✔ 192.168.0.0/24, 3 addresses');
  });

  it('shows found hosts with name, MAC, vendor and time', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['sweep'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toMatch(/IP\s+HOST\s+MAC\s+VENDOR\s+TIME/);
    expect(stdout()).toMatch(/192\.168\.0\.1\s+gateway\.local\s+-\s+.*2\.5 ms/);
    // ARP에만 있는 조용한 호스트도 MAC·제조사와 함께 나옵니다.
    expect(stdout()).toMatch(/192\.168\.0\.3\s+-\s+E4:5F:01:00:00:01\s+Raspberry Pi/);
    expect(stdout()).toContain('▸ 2 hosts up in ');
  });

  it('says so when nothing answers', async () => {
    const services = fakeServices({
      probe: () => () => Promise.resolve(undefined),
      readArp: () => Promise.resolve(new Map()),
    });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['sweep'], runtime, groupsWith(services));

    expect(stdout()).toContain('No hosts answered.');
    expect(stdout()).toContain('▸ 0 hosts up in ');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['sweep', '--json'], runtime, groupsWith(fakeServices()));

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      range: '192.168.0.0/24',
      total: 3,
      scanned: 3,
      up: 2,
      hosts: [
        { address: '192.168.0.1', hostname: 'gateway.local', via: 'icmp', time: 2.5 },
        { address: '192.168.0.3', mac: 'E4:5F:01:00:00:01', vendor: 'Raspberry Pi', via: 'arp' },
      ],
    });
  });

  it('skips host names with --no-hostnames', async () => {
    const hostname = vi.fn(() => () => Promise.resolve('should-not-run'));
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['sweep', '--no-hostnames'], runtime, groupsWith(fakeServices({ hostname })));

    expect(hostname).not.toHaveBeenCalled();
    expect(stdout()).not.toContain('gateway.local');
  });

  it('draws progress on a terminal and clears it before the results', async () => {
    const { runtime, stdout } = createTestRuntime({ tty: true });

    await runCommand(['sweep'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toContain('sweeping 0/3 · 0 up');
    expect(stdout().split('\r\u001b[2K').at(-1)).toMatch(/^\S*\s*IP\s+HOST/);
  });

  describe('a public range', () => {
    const services = fakeServices({
      isPublic: () => true,
      probe: (): HostProbe => (address) => Promise.resolve(liveness[address]),
    });

    it('is refused without --yes when nobody can be asked', async () => {
      const { runtime, stdout, stderr } = createTestRuntime();

      const code = await runCommand(['sweep', '203.0.113.0/30'], runtime, groupsWith(services));

      expect(code).toBe(1);
      expect(stderr()).toContain('is a public range; add --yes to sweep it');
      expect(stdout()).toBe('');
    });

    it('is swept after the user agrees', async () => {
      const confirm = vi.fn(() => Promise.resolve(true));
      const { runtime, stderr } = createTestRuntime({ confirm });

      const code = await runCommand(['sweep'], runtime, groupsWith(services));

      expect(code).toBe(0);
      expect(stderr()).toContain('Only sweep networks you own or have permission to test.');
      expect(confirm).toHaveBeenCalledWith('Sweep 3 addresses? [y/N] ');
    });

    it('is not swept when the user declines', async () => {
      const { runtime, stdout } = createTestRuntime({ confirm: () => Promise.resolve(false) });

      const code = await runCommand(['sweep'], runtime, groupsWith(services));

      expect(code).toBe(1);
      expect(stdout()).toBe('');
    });

    it('is swept without asking with --yes', async () => {
      const confirm = vi.fn(() => Promise.resolve(false));
      const { runtime, stdout } = createTestRuntime({ confirm });

      const code = await runCommand(['sweep', '--yes'], runtime, groupsWith(services));

      expect(code).toBe(0);
      expect(confirm).not.toHaveBeenCalled();
      expect(stdout()).toContain('✔ 192.168.0.0/24');
    });
  });
});
