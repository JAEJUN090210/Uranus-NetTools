import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createLocalCommand, type LocalServices } from '../../src/commands/local';
import type { LocalInterface } from '../../src/core/local/interfaces';
import { createTestRuntime } from '../helpers/runtime';

const wifi: LocalInterface = {
  name: 'Wi-Fi',
  mac: 'E4:5F:01:DA:54:99',
  internal: false,
  addresses: [
    {
      address: '192.168.1.25',
      family: 4,
      cidr: '192.168.1.25/24',
      linkLocal: false,
      internal: false,
    },
    {
      address: '2001:db8::25',
      family: 6,
      cidr: '2001:db8::25/64',
      linkLocal: false,
      internal: false,
    },
  ],
};

const loopback: LocalInterface = {
  name: 'Loopback',
  internal: true,
  addresses: [
    { address: '127.0.0.1', family: 4, cidr: '127.0.0.1/8', linkLocal: false, internal: true },
  ],
};

function fakeServices(overrides: Partial<LocalServices> = {}): LocalServices {
  return {
    interfaces: (options) => (options?.all === true ? [wifi, loopback] : [wifi]),
    gateways: () =>
      Promise.resolve([{ address: '192.168.1.1', family: 4, via: 'Wi-Fi', metric: 35 }]),
    dnsServers: () => ['1.1.1.1', '8.8.8.8'],
    publicIp: () => Promise.resolve('203.0.113.7'),
    vendor: (mac) => (mac === 'E4:5F:01:DA:54:99' ? 'Raspberry Pi' : undefined),
    host: () => ({ name: 'test-pc', os: 'Linux 6.1.0' }),
    ...overrides,
  };
}

function groupsWith(services: LocalServices): readonly CommandGroup[] {
  return [{ heading: 'Local:', commands: [(runtime) => createLocalCommand(runtime, services)] }];
}

describe('unt local', () => {
  it('is listed under Local in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Local:\n(?:.*\n)*?\s+local/);
  });

  it('shows the host, gateway, DNS servers and each address', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['local'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toMatch(/Host\s+test-pc/);
    expect(stdout()).toMatch(/OS\s+Linux 6\.1\.0/);
    expect(stdout()).toMatch(/Gateway\s+192\.168\.1\.1 \(Wi-Fi\)/);
    expect(stdout()).toMatch(/DNS\s+1\.1\.1\.1/);
    expect(stdout()).toContain('8.8.8.8');
    expect(stdout()).toMatch(/INTERFACE\s+ADDRESS\s+FAMILY\s+MAC\s+VENDOR/);
    expect(stdout()).toMatch(
      /Wi-Fi\s+192\.168\.1\.25\/24\s+IPv4\s+E4:5F:01:DA:54:99\s+Raspberry Pi/,
    );
    // 같은 어댑터의 두 번째 주소는 이름과 MAC을 비워 둡니다.
    expect(stdout()).toMatch(/^\s+2001:db8::25\/64\s+IPv6\s*$/m);
    expect(stdout()).toContain('▸ 1 interface, 2 addresses');
  });

  it('does not ask for the public IP unless --public is given', async () => {
    const publicIp = vi.fn<LocalServices['publicIp']>(() => Promise.resolve('203.0.113.7'));
    const quiet = createTestRuntime();

    await runCommand(['local'], quiet.runtime, groupsWith(fakeServices({ publicIp })));
    expect(publicIp).not.toHaveBeenCalled();
    expect(quiet.stdout()).not.toContain('Public IP');

    const asked = createTestRuntime();
    await runCommand(['local', '--public'], asked.runtime, groupsWith(fakeServices({ publicIp })));
    expect(publicIp).toHaveBeenCalled();
    expect(asked.stdout()).toMatch(/Public IP\s+203\.0\.113\.7/);
  });

  it('warns and exits 1 when the public IP cannot be looked up', async () => {
    const services = fakeServices({
      publicIp: () => Promise.reject(new Error('no route to host')),
    });
    const { runtime, stdout, stderr } = createTestRuntime();

    const code = await runCommand(['local', '--public'], runtime, groupsWith(services));

    expect(code).toBe(1);
    expect(stderr()).toContain('could not look up the public IP (no route to host)');
    // 나머지 정보는 그대로 보여 줍니다.
    expect(stdout()).toMatch(/Host\s+test-pc/);
  });

  it('shows loopback and internal interfaces with --all', async () => {
    const without = createTestRuntime();
    await runCommand(['local'], without.runtime, groupsWith(fakeServices()));
    expect(without.stdout()).not.toContain('Loopback');

    const all = createTestRuntime();
    await runCommand(['local', '--all'], all.runtime, groupsWith(fakeServices()));
    expect(all.stdout()).toContain('Loopback');
    expect(all.stdout()).toContain('127.0.0.1');
  });

  it('says so when no interface has an address', async () => {
    const services = fakeServices({ interfaces: () => [] });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['local'], runtime, groupsWith(services));

    expect(stdout()).toContain('No interface has an address.');
  });

  it('marks a randomized MAC address instead of leaving the vendor blank', async () => {
    const services = fakeServices({
      interfaces: () => [{ ...wifi, mac: '66:30:94:3C:3F:55' }],
      vendor: () => undefined,
    });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['local'], runtime, groupsWith(services));

    expect(stdout()).toContain('randomized');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['local', '--json'], runtime, groupsWith(fakeServices()));

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      host: 'test-pc',
      os: 'Linux 6.1.0',
      publicIp: null,
      gateways: [{ address: '192.168.1.1', family: 4, via: 'Wi-Fi', metric: 35 }],
      dnsServers: ['1.1.1.1', '8.8.8.8'],
      interfaces: [
        {
          name: 'Wi-Fi',
          mac: 'E4:5F:01:DA:54:99',
          vendor: 'Raspberry Pi',
          internal: false,
          addresses: [
            { address: '192.168.1.25', family: 4, cidr: '192.168.1.25/24', linkLocal: false },
            { address: '2001:db8::25', family: 6, cidr: '2001:db8::25/64', linkLocal: false },
          ],
        },
      ],
    });
  });
});
