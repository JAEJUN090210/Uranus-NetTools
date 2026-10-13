import { setTimeout as delay } from 'node:timers/promises';

export interface ProbeOutcome {
  /** 응답을 받았을 때의 왕복 시간(ms)입니다. */
  readonly time?: number;
  readonly ttl?: number;
  /** 응답을 받지 못한 이유입니다. (timeout, refused 등) */
  readonly error?: string;
}

export interface Probe extends ProbeOutcome {
  readonly seq: number;
}

export interface PingLoopOptions {
  /** undefined이면 취소될 때까지 계속 보냅니다. */
  readonly count: number | undefined;
  readonly intervalMs: number;
  readonly signal: AbortSignal;
  readonly probe: () => Promise<ProbeOutcome>;
  readonly onProbe?: (probe: Probe) => void;
}

/** 정해진 횟수만큼(또는 취소될 때까지) 일정한 간격으로 probe를 보냅니다. 취소되면 그때까지의 결과를 돌려줍니다. */
export async function runPingLoop(options: PingLoopOptions): Promise<Probe[]> {
  const { count, intervalMs, signal, probe, onProbe } = options;
  const probes: Probe[] = [];
  // await 하는 동안 취소될 수 있으므로 매번 신호를 다시 읽습니다.
  const cancelled = () => signal.aborted;

  for (let seq = 1; count === undefined || seq <= count; seq++) {
    if (cancelled()) {
      break;
    }
    const startedAt = performance.now();
    let outcome: ProbeOutcome;
    try {
      outcome = await probe();
    } catch (error) {
      if (cancelled()) {
        break;
      }
      throw error;
    }

    const result = { seq, ...outcome };
    probes.push(result);
    onProbe?.(result);
    if (seq === count) {
      break;
    }

    // 응답이 늦게 와도 다음 probe는 원래 예정된 시각에 보냅니다.
    const remaining = intervalMs - (performance.now() - startedAt);
    if (remaining > 0) {
      try {
        await delay(remaining, undefined, { signal });
      } catch {
        break;
      }
    }
  }
  return probes;
}
