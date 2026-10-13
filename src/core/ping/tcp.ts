import { Socket } from 'node:net';

import type { ProbeOutcome } from './pinger';

/** TCP 연결이 맺어질 때까지 걸린 시간을 잽니다. 연결을 거부하면 refused, 응답이 없으면 timeout입니다. */
export function probeTcp(
  address: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ProbeOutcome> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }

    const socket = new Socket();
    const startedAt = performance.now();
    const onAbort = () => {
      socket.destroy();
      reject(signal.reason as Error);
    };
    const finish = (outcome: ProbeOutcome) => {
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
      resolve(outcome);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs, () => {
      finish({ error: 'timeout' });
    });
    socket.once('connect', () => {
      finish({ time: Math.round((performance.now() - startedAt) * 1000) / 1000 });
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish({ error: error.code === 'ECONNREFUSED' ? 'refused' : (error.code ?? error.message) });
    });
    socket.connect({ host: address, port });
  });
}
