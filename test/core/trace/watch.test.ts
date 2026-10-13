import { describe, expect, it } from 'vitest';

import type { ProbeOutcome } from '../../../src/core/ping/pinger';
import type { Hop } from '../../../src/core/trace/parse';
import { watchHops } from '../../../src/core/trace/watch';

const never = new AbortController().signal;

const hops: Hop[] = [
  { hop: 1, times: [1], addresses: [{ address: '192.168.0.1' }] },
  { hop: 2, times: [undefined], addresses: [] },
  { hop: 3, times: [10], addresses: [{ address: '8.8.8.8', name: 'dns.google' }] },
];

/** 주소마다 정해 둔 응답을 차례로 돌려주는 가짜 ping입니다. */
function scripted(answers: Record<string, (number | undefined)[]>) {
  const asked: string[] = [];
  const probe = ({ address }: { address: string }): Promise<ProbeOutcome> => {
    asked.push(address);
    const time = answers[address]?.shift();
    return Promise.resolve(time === undefined ? { error: 'timeout' } : { time });
  };
  return { probe, asked };
}

describe('watchHops', () => {
  it('pings every hop that answered each round and keeps statistics', async () => {
    const { probe, asked } = scripted({ '192.168.0.1': [1, 3], '8.8.8.8': [10, undefined] });
    const rounds: number[] = [];

    const result = await watchHops(hops, {
      intervalMs: 0,
      rounds: 2,
      signal: never,
      probe,
      onRound: (_stats, round) => {
        rounds.push(round);
      },
    });

    expect(result.rounds).toBe(2);
    expect(rounds).toEqual([1, 2]);
    expect(asked).not.toContain(undefined);
    expect(result.stats).toEqual([
      {
        hop: 1,
        address: { address: '192.168.0.1' },
        sent: 2,
        received: 2,
        loss: 0,
        last: 3,
        avg: 2,
        best: 1,
        worst: 3,
      },
      { hop: 2, sent: 0, received: 0, loss: 0 },
      {
        hop: 3,
        address: { address: '8.8.8.8', name: 'dns.google' },
        sent: 2,
        received: 1,
        loss: 50,
        avg: 10,
        best: 10,
        worst: 10,
      },
    ]);
  });

  it('keeps going until cancelled when there is no round limit', async () => {
    const controller = new AbortController();
    const { probe } = scripted({ '192.168.0.1': [1, 1, 1, 1], '8.8.8.8': [5, 5, 5, 5] });

    const result = await watchHops(hops, {
      intervalMs: 0,
      rounds: undefined,
      signal: controller.signal,
      probe,
      onRound: (_stats, round) => {
        if (round === 3) {
          controller.abort();
        }
      },
    });

    expect(result.rounds).toBe(3);
    expect(result.stats[0]?.sent).toBe(3);
  });
});
