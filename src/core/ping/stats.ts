import type { Probe } from './pinger';

export interface PingStats {
  readonly sent: number;
  readonly received: number;
  /** 손실률(%)입니다. */
  readonly loss: number;
  readonly min?: number;
  readonly avg?: number;
  readonly max?: number;
  /** 연속한 응답 시간 차이의 평균입니다. 응답이 두 개 이상일 때만 계산합니다. */
  readonly jitter?: number;
  readonly p95?: number;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function summarize(probes: readonly Probe[]): PingStats {
  const times = probes.flatMap((probe) => (probe.time === undefined ? [] : [probe.time]));
  const sent = probes.length;
  const received = times.length;
  const loss = sent === 0 ? 0 : round(((sent - received) / sent) * 100, 1);
  if (received === 0) {
    return { sent, received, loss };
  }

  const sorted = times.toSorted((a, b) => a - b);
  const avg = times.reduce((sum, time) => sum + time, 0) / received;
  const differences = times.slice(1).map((time, index) => Math.abs(time - (times[index] ?? time)));
  const jitter =
    differences.length === 0
      ? undefined
      : differences.reduce((sum, difference) => sum + difference, 0) / differences.length;
  // 백분위는 nearest-rank 방식으로 구합니다.
  const p95 = sorted[Math.ceil(0.95 * received) - 1] ?? 0;

  return {
    sent,
    received,
    loss,
    min: round(sorted[0] ?? 0, 3),
    avg: round(avg, 3),
    max: round(sorted.at(-1) ?? 0, 3),
    ...(jitter === undefined ? {} : { jitter: round(jitter, 3) }),
    p95: round(p95, 3),
  };
}
