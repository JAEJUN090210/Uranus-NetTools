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

    // 실제 환경 변수를 쓰므로 콘솔에 따라 ✔ 대신 [OK]가 나올 수 있어 기호는 확인하지 않습니다.
    expect(code).toBe(0);
    expect(stdout()).toContain(' 127.0.0.1, max 3 hops');
    expect(stdout()).toMatch(/ {3}1\s+[\d.]+ ms.*127\.0\.0\.1/);
    expect(stdout()).toContain(' reached in 1 hop');
  });

  it('measures every hop for a few rounds with -c', { timeout: 30_000 }, async () => {
    const { runtime, stdout } = createTestRuntime({ platform: process.platform, env: process.env });

    const code = await runCommand(
      ['trace', '127.0.0.1', '-n', '-m', '3', '-W', '1000', '-c', '2', '-i', '0.1'],
      runtime,
    );

    expect(code).toBe(0);
    expect(stdout()).toMatch(/HOP\s+ADDRESS\s+LOSS\s+SENT\s+LAST\s+AVG\s+BEST\s+WORST/);
    expect(stdout()).toMatch(/^\s*1\s+127\.0\.0\.1\s+0%\s+2\s/m);
    expect(stdout()).toContain(' 2 rounds over 1 hop');
  });

  it('redraws the table in place on a terminal', { timeout: 30_000 }, async () => {
    const { runtime, stdout } = createTestRuntime({
      platform: process.platform,
      env: process.env,
      tty: true,
    });

    await runCommand(['trace', '127.0.0.1', '-n', '-m', '3', '-c', '2', '-i', '0.1'], runtime);

    expect(stdout()).toContain('round 1/2');
    // 두 번째 라운드는 앞서 그린 진행 줄, 헤더, 경유지 1줄(모두 3줄)을 지우고 다시 그립니다.
    expect(stdout()).toContain('\u001b[3F\u001b[J');
    expect(stdout()).toContain('round 2/2');
  });

  it('prints the watch statistics as JSON', { timeout: 30_000 }, async () => {
    const { runtime, stdout } = createTestRuntime({ platform: process.platform, env: process.env });

    await runCommand(['trace', '127.0.0.1', '-n', '-m', '3', '-c', '1', '--json'], runtime);

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      address: '127.0.0.1',
      rounds: 1,
      hops: [{ hop: 1, address: '127.0.0.1', sent: 1, received: 1, loss: 0 }],
    });
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
