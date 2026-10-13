import { createServer, type Server } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createScanCommand } from '../../src/commands/scan';
import { resolveHost } from '../../src/core/resolve';
import { createTestRuntime } from '../helpers/runtime';
import { closedPort, closeServer, listenLocally } from '../helpers/server';

/** 127.0.0.1을 공개 주소처럼 다뤄서, 실제 인터넷 호스트 없이 확인 절차를 시험합니다. */
const publicLoopback: readonly CommandGroup[] = [
  {
    heading: 'Scanning:',
    commands: [
      (runtime) => createScanCommand(runtime, { resolve: resolveHost, isPublic: () => true }),
    ],
  },
];

const servers: Server[] = [];
let open: number;
let closed: number;

beforeEach(async () => {
  const listening = await listenLocally();
  servers.push(listening.server);
  open = listening.port;
  closed = await closedPort();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

function row(port: number, state: string): RegExp {
  return new RegExp(`^\\s*${port}/tcp\\s+${state}\\b`, 'm');
}

// Windows는 로컬의 닫힌 포트도 거부 응답까지 2초쯤 걸릴 수 있어 -W를 넉넉히 줍니다.
describe('unt scan', { timeout: 15_000 }, () => {
  it('is listed under Scanning in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Scanning:\n\s+scan/);
  });

  it('rejects an invalid port list', async () => {
    const { runtime, stderr } = createTestRuntime();

    expect(await runCommand(['scan', '127.0.0.1', '-p', '22,0'], runtime)).toBe(1);
    expect(stderr()).toContain('0 is not a port number between 1 and 65535.');
  });

  it('shows only the open ports and counts the rest', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(
      ['scan', '127.0.0.1', '-p', `${open},${closed}`, '-W', '5000'],
      runtime,
    );

    expect(code).toBe(0);
    expect(stdout()).toContain('✔ 127.0.0.1, 2 ports');
    expect(stdout()).toMatch(/PORT\s+STATE\s+SERVICE/);
    expect(stdout()).toMatch(row(open, 'open'));
    expect(stdout()).not.toMatch(row(closed, 'closed'));
    expect(stdout()).toContain('▸ 1 open, 1 closed, 0 filtered in ');
  });

  it('shows every port with --all', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(
      ['scan', '127.0.0.1', '-p', `${open},${closed}`, '-W', '5000', '--all'],
      runtime,
    );

    expect(stdout()).toMatch(row(open, 'open'));
    expect(stdout()).toMatch(row(closed, 'closed'));
  });

  it('says so when no port is open', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['scan', '127.0.0.1', '-p', String(closed), '-W', '5000'], runtime);

    expect(stdout()).toContain('No open ports found.');
    expect(stdout()).toContain('▸ 0 open, 1 closed, 0 filtered');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(
      ['scan', '127.0.0.1', '-p', `${open},${closed}`, '-W', '5000', '--json'],
      runtime,
    );

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      host: '127.0.0.1',
      address: '127.0.0.1',
      total: 2,
      scanned: 2,
      open: 1,
      closed: 1,
      filtered: 0,
      ports: [{ port: open, state: 'open' }],
    });
  });

  it('draws the progress on a terminal and clears it before the results', async () => {
    const { runtime, stdout } = createTestRuntime({ tty: true });

    await runCommand(['scan', '127.0.0.1', '-p', String(open)], runtime);

    expect(stdout()).toContain('scanning 0/1 ports · 0 open');
    // 마지막으로 줄을 지운 뒤에 결과 표가 나와야 합니다.
    expect(stdout().split('\r\u001b[2K').at(-1)).toMatch(/^\S*\s*PORT\s+STATE/);
  });

  it('reads banners with --banner', async () => {
    const greeting = createServer((socket) => {
      socket.on('error', () => undefined);
      socket.write('SSH-2.0-Test_1.0\r\n');
    });
    servers.push(greeting);
    await new Promise<void>((resolve) => {
      greeting.listen(0, '127.0.0.1', resolve);
    });
    const address = greeting.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['scan', '127.0.0.1', '-p', String(port), '--banner'], runtime);

    expect(stdout()).toMatch(/PORT\s+STATE\s+SERVICE\s+BANNER/);
    expect(stdout()).toContain('SSH-2.0-Test_1.0');
  });

  describe('a public address', () => {
    it('is refused without --yes when nobody can be asked', async () => {
      const { runtime, stdout, stderr } = createTestRuntime();

      const code = await runCommand(
        ['scan', '127.0.0.1', '-p', String(open)],
        runtime,
        publicLoopback,
      );

      expect(code).toBe(1);
      expect(stderr()).toContain('127.0.0.1 is a public address; add --yes to scan it');
      expect(stdout()).toBe('');
    });

    it('is scanned after the user agrees', async () => {
      const confirm = vi.fn(() => Promise.resolve(true));
      const { runtime, stdout, stderr } = createTestRuntime({ confirm });

      const code = await runCommand(
        ['scan', '127.0.0.1', '-p', String(open)],
        runtime,
        publicLoopback,
      );

      expect(code).toBe(0);
      expect(stderr()).toContain('Only scan hosts you own or have permission to test.');
      expect(confirm).toHaveBeenCalledWith('Scan 127.0.0.1? [y/N] ');
      expect(stdout()).toMatch(row(open, 'open'));
    });

    it('is not scanned when the user declines', async () => {
      const { runtime, stdout, stderr } = createTestRuntime({
        confirm: () => Promise.resolve(false),
      });

      const code = await runCommand(
        ['scan', '127.0.0.1', '-p', String(open)],
        runtime,
        publicLoopback,
      );

      expect(code).toBe(1);
      expect(stderr()).toContain('scan cancelled');
      expect(stdout()).toBe('');
    });

    it('is scanned without asking with --yes', async () => {
      const confirm = vi.fn(() => Promise.resolve(false));
      const { runtime, stdout } = createTestRuntime({ confirm });

      const code = await runCommand(
        ['scan', '127.0.0.1', '-p', String(open), '--yes'],
        runtime,
        publicLoopback,
      );

      expect(code).toBe(0);
      expect(confirm).not.toHaveBeenCalled();
      expect(stdout()).toMatch(row(open, 'open'));
    });
  });
});
