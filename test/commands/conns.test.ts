import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createConnsCommand, type ConnsServices } from '../../src/commands/conns';
import type { Connection } from '../../src/core/conns/list';
import { createTestRuntime } from '../helpers/runtime';

const connections: Connection[] = [
  {
    protocol: 'tcp',
    local: { address: '0.0.0.0', port: 22 },
    state: 'LISTENING',
    pid: 800,
  },
  {
    protocol: 'tcp',
    local: { address: '192.168.1.25', port: 50693 },
    remote: { address: '93.184.216.34', port: 443 },
    state: 'ESTABLISHED',
    pid: 1234,
  },
  {
    protocol: 'tcp',
    local: { address: '127.0.0.1', port: 17184 },
    remote: { address: '127.0.0.1', port: 49350 },
    state: 'TIME_WAIT',
  },
  { protocol: 'udp', local: { address: '0.0.0.0', port: 123 }, pid: 4048 },
];

function fakeServices(overrides: Partial<ConnsServices> = {}): ConnsServices {
  return {
    list: () => Promise.resolve(connections),
    programs: () =>
      Promise.resolve(
        new Map([
          [800, 'sshd'],
          [1234, 'chrome.exe'],
        ]),
      ),
    reverse: () => (address) =>
      Promise.resolve(address === '93.184.216.34' ? 'example.com' : undefined),
    ...overrides,
  };
}

function groupsWith(services: ConnsServices): readonly CommandGroup[] {
  return [{ heading: 'Local:', commands: [(runtime) => createConnsCommand(runtime, services)] }];
}

describe('unt conns', () => {
  it('is listed under Local in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Local:\n(?:.*\n)*?\s+conns/);
  });

  it('shows listening and connected sockets with their PID', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['conns'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toMatch(/PROTO\s+LOCAL\s+REMOTE\s+STATE\s+PID/);
    expect(stdout()).toMatch(/tcp\s+0\.0\.0\.0:22\s+-\s+LISTENING\s+800/);
    expect(stdout()).toMatch(
      /tcp\s+192\.168\.1\.25:50693\s+93\.184\.216\.34:443\s+ESTABLISHED\s+1234/,
    );
    expect(stdout()).toContain('▸ 1 listening port, 3 connections');
  });

  it('does not show program names unless --names is given', async () => {
    const programs = vi.fn<ConnsServices['programs']>(() => Promise.resolve(new Map()));
    const without = createTestRuntime();

    await runCommand(['conns'], without.runtime, groupsWith(fakeServices({ programs })));
    expect(programs).not.toHaveBeenCalled();
    expect(without.stdout()).not.toContain('PROGRAM');

    const withNames = createTestRuntime();
    await runCommand(['conns', '--names'], withNames.runtime, groupsWith(fakeServices()));
    expect(withNames.stdout()).toContain('PROGRAM');
    expect(withNames.stdout()).toContain('sshd');
    expect(withNames.stdout()).toContain('chrome.exe');
  });

  it('shows only the listening sockets with --listen', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['conns', '--listen'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toContain('0.0.0.0:22');
    expect(stdout()).not.toContain('50693');
    expect(stdout()).toContain('▸ 1 listening port, 0 connections');
  });

  it('shows only live connections with --established, leaving out TIME_WAIT', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['conns', '--established'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toContain('50693');
    expect(stdout()).not.toContain('0.0.0.0:22');
    // 정리 중인 소켓은 연결로 세지 않습니다.
    expect(stdout()).not.toContain('17184');
  });

  it('filters by protocol', async () => {
    const tcp = createTestRuntime();
    await runCommand(['conns', '--tcp'], tcp.runtime, groupsWith(fakeServices()));
    expect(tcp.stdout()).not.toContain('udp');

    const udp = createTestRuntime();
    await runCommand(['conns', '--udp'], udp.runtime, groupsWith(fakeServices()));
    expect(udp.stdout()).toContain('0.0.0.0:123');
    expect(udp.stdout()).not.toContain('0.0.0.0:22');
  });

  it('filters by port on either end', async () => {
    const local = createTestRuntime();
    await runCommand(['conns', '-p', '22'], local.runtime, groupsWith(fakeServices()));
    expect(local.stdout()).toContain('0.0.0.0:22');
    expect(local.stdout()).not.toContain('50693');

    const remote = createTestRuntime();
    await runCommand(['conns', '-p', '443'], remote.runtime, groupsWith(fakeServices()));
    expect(remote.stdout()).toContain('93.184.216.34:443');
  });

  it('says so when nothing matches', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['conns', '-p', '9999'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toContain('No socket matches.');
  });

  it('looks up remote names only with --resolve', async () => {
    const reverse = vi.fn<ConnsServices['reverse']>(() => () => Promise.resolve('example.com'));
    const without = createTestRuntime();

    await runCommand(['conns'], without.runtime, groupsWith(fakeServices({ reverse })));
    expect(reverse).not.toHaveBeenCalled();

    const resolved = createTestRuntime();
    await runCommand(['conns', '--resolve'], resolved.runtime, groupsWith(fakeServices()));
    expect(resolved.stdout()).toContain('example.com');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['conns', '--listen', '--json'], runtime, groupsWith(fakeServices()));

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      total: 4,
      shown: 1,
      listening: 1,
      connections: [
        {
          protocol: 'tcp',
          local: '0.0.0.0:22',
          remote: null,
          remoteName: null,
          state: 'LISTENING',
          pid: 800,
          program: null,
        },
      ],
    });
  });
});
