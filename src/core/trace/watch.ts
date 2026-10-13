import { setTimeout as delay } from 'node:timers/promises';

import type { ProbeOutcome } from '../ping/pinger';
import type { Hop, HopAddress } from './parse';

export interface HopStats {
  readonly hop: number;
  /** 경로를 찾을 때 응답하지 않은 경유지는 주소를 몰라서 측정하지 않습니다. */
  readonly address?: HopAddress;
  readonly sent: number;
  readonly received: number;
  /** 손실률(%)입니다. */
  readonly loss: number;
  readonly last?: number;
  readonly avg?: number;
  readonly best?: number;
  readonly worst?: number;
}

export interface WatchOptions {
  readonly intervalMs: number;
  /** undefined이면 취소될 때까지 계속합니다. */
  readonly rounds: number | undefined;
  readonly signal: AbortSignal;
  readonly probe: (address: HopAddress) => Promise<ProbeOutcome>;
  readonly onRound?: (stats: readonly HopStats[], round: number) => void;
}

interface Accumulator {
  readonly hop: number;
  readonly address?: HopAddress;
  sent: number;
  received: number;
  total: number;
  last?: number;
  best?: number;
  worst?: number;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function snapshot(accumulators: readonly Accumulator[]): HopStats[] {
  return accumulators.map((stats) => ({
    hop: stats.hop,
    ...(stats.address === undefined ? {} : { address: stats.address }),
    sent: stats.sent,
    received: stats.received,
    loss: stats.sent === 0 ? 0 : round(((stats.sent - stats.received) / stats.sent) * 100, 1),
    last: stats.last,
    avg: stats.received === 0 ? undefined : round(stats.total / stats.received, 3),
    best: stats.best,
    worst: stats.worst,
  }));
}

function record(stats: Accumulator, outcome: ProbeOutcome): void {
  stats.sent += 1;
  stats.last = outcome.time;
  if (outcome.time === undefined) {
    return;
  }
  stats.received += 1;
  stats.total += outcome.time;
  stats.best = Math.min(stats.best ?? outcome.time, outcome.time);
  stats.worst = Math.max(stats.worst ?? outcome.time, outcome.time);
}

/**
 * pathping처럼 찾아 둔 경로의 경유지마다 라운드 단위로 ping을 보내 통계를 쌓습니다.
 * 취소되면 그때까지의 통계를 돌려줍니다.
 */
export async function watchHops(
  hops: readonly Hop[],
  options: WatchOptions,
): Promise<{ stats: HopStats[]; rounds: number }> {
  const accumulators: Accumulator[] = hops.map((hop) => ({
    hop: hop.hop,
    ...(hop.addresses[0] === undefined ? {} : { address: hop.addresses[0] }),
    sent: 0,
    received: 0,
    total: 0,
  }));
  // await 하는 동안 취소될 수 있으므로 매번 신호를 다시 읽습니다.
  const cancelled = () => options.signal.aborted;
  let completed = 0;

  while (options.rounds === undefined || completed < options.rounds) {
    if (cancelled()) {
      break;
    }
    const startedAt = performance.now();
    try {
      await Promise.all(
        accumulators.map(async (stats) => {
          if (stats.address !== undefined) {
            record(stats, await options.probe(stats.address));
          }
        }),
      );
    } catch (error) {
      if (cancelled()) {
        break;
      }
      throw error;
    }
    completed += 1;
    options.onRound?.(snapshot(accumulators), completed);
    if (completed === options.rounds) {
      break;
    }
    const remaining = options.intervalMs - (performance.now() - startedAt);
    if (remaining > 0) {
      try {
        await delay(remaining, undefined, { signal: options.signal });
      } catch {
        break;
      }
    }
  }
  return { stats: snapshot(accumulators), rounds: completed };
}
