import type { Server } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCommand } from '../../src/cli/run';
import { createTestRuntime, type TestRuntimeOptions } from '../helpers/runtime';
import { closedPort, closeServer, listenLocally } from '../helpers/server';

vi.mock('node:dns/promises', async (importOriginal) =>
  (await import('../helpers/dns')).instantNxdomainModule(importOriginal),
);

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

async function openPort(): Promise<number> {
  const { server, port } = await listenLocally();
  servers.push(server);
  return port;
}

async function ping(args: string[], options?: TestRuntimeOptions) {
  const { runtime, stdout, stderr } = createTestRuntime(options);
  const code = await runCommand(['ping', ...args], runtime);
  return { code, stdout: stdout(), stderr: stderr() };
}

describe('unt ping', () => {
  it('is listed under Diagnostics in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Diagnostics:\n\s+ping/);
  });

  it('prints each probe and a summary for a single host', async () => {
    const port = await openPort();

    const { code, stdout } = await ping(['127.0.0.1', '-p', String(port), '-c', '2', '-i', '0.05']);

    expect(code).toBe(0);
    expect(stdout).toContain(`✔ 127.0.0.1 TCP port ${port}`);
    expect(stdout).toMatch(/ {2}seq=1 {2}connected {2}\d+\.\d ms/);
    expect(stdout).toContain('▸ 2 sent, 2 received, 0% loss');
    expect(stdout).toMatch(/min\/avg\/max [\d.]+\/[\d.]+\/[\d.]+ ms {2}jitter [\d.]+ ms {2}p95/);
  });

  it('prints a JSON report', async () => {
    const port = await openPort();

    const { stdout } = await ping(['127.0.0.1', '-p', String(port), '-c', '1', '--json']);

    expect(JSON.parse(stdout) as unknown).toMatchObject({
      host: '127.0.0.1',
      address: '127.0.0.1',
      mode: 'tcp',
      port,
      probes: [{ seq: 1, time: expect.any(Number) as unknown }],
      stats: { sent: 1, received: 1, loss: 0 },
    });
  });

  it('exits with 1 when no probe gets a reply', { timeout: 15_000 }, async () => {
    const port = await closedPort();

    const { code, stdout } = await ping([
      '127.0.0.1',
      '-p',
      String(port),
      '-c',
      '1',
      '-W',
      '10000',
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('✖ seq=1  refused (port closed)');
    expect(stdout).toContain('1 sent, 0 received, 100% loss');
  });

  it('compares several hosts in a table', async () => {
    const port = await openPort();

    const { code, stdout } = await ping([
      '127.0.0.1',
      'localhost',
      'no-such-host.invalid',
      '-4',
      '-p',
      String(port),
      '-c',
      '2',
      '-i',
      '0.05',
    ]);

    expect(code).toBe(1);
    expect(stdout).toMatch(/HOST\s+ADDRESS\s+RECV\s+LOSS\s+AVG\s+JITTER\s+P95\s+HISTORY/);
    expect(stdout).toMatch(/localhost\s+127\.0\.0\.1\s+2\/2\s+0%/);
    expect(stdout).toContain('cannot resolve no-such-host.invalid');
  });

  it.each([
    [['example.com', '-c', '0']],
    [['example.com', '-p', '70000']],
    [['example.com', '-t', '-c', '3']],
    [['example.com', '-4', '-6']],
  ])('rejects invalid options: %j', async (args) => {
    const { code, stderr } = await ping(args);

    expect(code).toBe(1);
    expect(stderr).toContain('error:');
  });

  it('pings localhost with the system ping command', { timeout: 15_000 }, async () => {
    const { code, stdout } = await ping(['127.0.0.1', '-c', '1'], {
      platform: process.platform,
      env: process.env,
    });

    expect(code).toBe(0);
    expect(stdout).toContain('1 sent, 1 received, 0% loss');
  });
});
