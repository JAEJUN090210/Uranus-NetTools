import { describe, expect, it } from 'vitest';

import { runCommand } from '../../src/cli/run';
import { createTestRuntime } from '../helpers/runtime';

describe('unt trace', () => {
  it('is listed under Diagnostics in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Diagnostics:\n(?:.*\n)*?\s+trace/);
  });

  it('rejects an invalid hop limit', async () => {
    const { runtime, stderr } = createTestRuntime();

    expect(await runCommand(['trace', 'example.com', '-m', '0'], runtime)).toBe(1);
    expect(stderr()).toContain('error:');
  });

  it('traces localhost with the system traceroute', { timeout: 30_000 }, async () => {
    const { runtime, stdout } = createTestRuntime({ platform: process.platform, env: process.env });

    const code = await runCommand(['trace', '127.0.0.1', '-n', '-m', '3', '-W', '1000'], runtime);

    expect(code).toBe(0);
    expect(stdout()).toContain('✔ 127.0.0.1, max 3 hops');
    expect(stdout()).toMatch(/ {3}1\s+[\d.]+ ms.*127\.0\.0\.1/);
    expect(stdout()).toContain('▸ reached in 1 hop');
  });

  it('prints a JSON report', { timeout: 30_000 }, async () => {
    const { runtime, stdout } = createTestRuntime({ platform: process.platform, env: process.env });

    await runCommand(['trace', '127.0.0.1', '-n', '-m', '3', '-W', '1000', '--json'], runtime);

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      host: '127.0.0.1',
      address: '127.0.0.1',
      maxHops: 3,
      reached: true,
      hops: [{ hop: 1, addresses: [{ address: '127.0.0.1' }] }],
    });
  });
});
