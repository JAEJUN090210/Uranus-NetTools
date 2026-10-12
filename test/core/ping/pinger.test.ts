import { describe, expect, it } from 'vitest';

import { UserError } from '../../../src/cli/errors';
import { runPingLoop } from '../../../src/core/ping/pinger';

const never = new AbortController().signal;

describe('runPingLoop', () => {
  it('sends the requested number of probes and reports each one', async () => {
    let calls = 0;
    const seen: number[] = [];

    const probes = await runPingLoop({
      count: 3,
      intervalMs: 0,
      signal: never,
      probe: () => Promise.resolve({ time: ++calls }),
      onProbe: (probe) => {
        seen.push(probe.seq);
      },
    });

    expect(probes).toEqual([
      { seq: 1, time: 1 },
      { seq: 2, time: 2 },
      { seq: 3, time: 3 },
    ]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('keeps going until cancelled when there is no count', async () => {
    const controller = new AbortController();

    const probes = await runPingLoop({
      count: undefined,
      intervalMs: 0,
      signal: controller.signal,
      probe: () => Promise.resolve({ time: 1 }),
      onProbe: (probe) => {
        if (probe.seq === 5) {
          controller.abort();
        }
      },
    });

    expect(probes).toHaveLength(5);
  });

  it('stops waiting for the next probe as soon as it is cancelled', async () => {
    const controller = new AbortController();
    const startedAt = performance.now();

    const probes = await runPingLoop({
      count: 3,
      intervalMs: 10_000,
      signal: controller.signal,
      probe: () => Promise.resolve({ time: 1 }),
      onProbe: () => {
        controller.abort();
      },
    });

    expect(probes).toHaveLength(1);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });

  it('returns the results so far when a probe is cancelled midway', async () => {
    const controller = new AbortController();

    const probes = await runPingLoop({
      count: 3,
      intervalMs: 0,
      signal: controller.signal,
      probe: () => {
        controller.abort();
        return Promise.reject(new DOMException('cancelled', 'AbortError'));
      },
    });

    expect(probes).toEqual([]);
  });

  it('passes other probe errors through', async () => {
    const loop = runPingLoop({
      count: 1,
      intervalMs: 0,
      signal: never,
      probe: () => Promise.reject(new UserError('ping not found')),
    });

    await expect(loop).rejects.toThrow('ping not found');
  });
});
