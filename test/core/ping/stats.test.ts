import { describe, expect, it } from 'vitest';

import type { Probe } from '../../../src/core/ping/pinger';
import { summarize } from '../../../src/core/ping/stats';

function probe(seq: number, time?: number): Probe {
  return time === undefined ? { seq, error: 'timeout' } : { seq, time };
}

describe('summarize', () => {
  it('computes loss, min/avg/max, jitter and p95', () => {
    expect(summarize([probe(1, 10), probe(2, 14), probe(3), probe(4, 12)])).toEqual({
      sent: 4,
      received: 3,
      loss: 25,
      min: 10,
      avg: 12,
      max: 14,
      jitter: 3,
      p95: 14,
    });
  });

  it('reports only counts and loss when nothing came back', () => {
    expect(summarize([probe(1), probe(2)])).toEqual({ sent: 2, received: 0, loss: 100 });
  });

  it('handles an empty run', () => {
    expect(summarize([])).toEqual({ sent: 0, received: 0, loss: 0 });
  });

  it('omits jitter for a single reply', () => {
    expect(summarize([probe(1, 5)])).not.toHaveProperty('jitter');
  });

  it('rounds the results', () => {
    expect(summarize([probe(1, 1 / 3), probe(2), probe(3)])).toMatchObject({
      loss: 66.7,
      avg: 0.333,
    });
  });

  it('takes p95 as the nearest-rank percentile', () => {
    const probes = Array.from({ length: 20 }, (_, index) => probe(index + 1, index + 1));

    expect(summarize(probes).p95).toBe(19);
  });
});
