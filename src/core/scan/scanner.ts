import { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import { UserError } from '../../cli/errors';
import type { Banner, BannerReader } from './banner';

export type PortState = 'open' | 'closed' | 'filtered';

export interface PortResult {
  readonly port: number;
  readonly state: PortState;
  /** --banner로 읽은 내용입니다. 열린 포트에만 있습니다. */
  readonly banner?: Banner;
}

/** 포트 하나의 상태를 알아냅니다. 취소되면 undefined입니다. */
export type PortProbe = (port: number) => Promise<PortResult | undefined>;

export interface ScanOptions {
  readonly ports: readonly number[];
  readonly concurrency: number;
  readonly signal: AbortSignal;
  readonly probe: PortProbe;
  /** done은 지금까지 끝난 포트 수입니다. */
  readonly onResult?: (result: PortResult, done: number) => void;
}

/** 포트를 최대 concurrency개씩 동시에 검사합니다. 취소되면 그때까지 끝난 결과만 포트 번호 순서로 돌려줍니다. */
export async function scanPorts(options: ScanOptions): Promise<PortResult[]> {
  const { ports, concurrency, signal, probe, onResult } = options;
  const results: PortResult[] = [];
  const errors: unknown[] = [];
  // await 하는 동안 취소될 수 있으므로 매번 신호를 다시 읽습니다.
  const cancelled = () => signal.aborted;
  let next = 0;

  const work = async () => {
    // 한 곳에서 실패하면 나머지 작업도 새 포트를 잡지 않고 끝냅니다.
    while (errors.length === 0 && !cancelled()) {
      const port = ports[next++];
      if (port === undefined) {
        return;
      }
      try {
        const result = await probe(port);
        if (result !== undefined) {
          results.push(result);
          onResult?.(result, results.length);
        }
      } catch (error) {
        errors.push(error);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, work));
  if (errors.length > 0) {
    throw errors[0];
  }
  return results.sort((a, b) => a.port - b.port);
}

/** busy는 내 컴퓨터의 소켓이나 임시 포트가 모자라 연결을 시작하지 못한 경우입니다. */
type ConnectOutcome =
  | { readonly state: 'open'; readonly socket: Socket }
  | { readonly state: 'closed' | 'filtered' }
  | { readonly state: 'busy'; readonly code: string };

const LOCAL_RESOURCE_ERRORS = new Set([
  'EMFILE',
  'ENFILE',
  'ENOBUFS',
  'EADDRNOTAVAIL',
  'EADDRINUSE',
]);
const RETRY_DELAYS_MS: readonly number[] = [100, 250, 500, 1000, 2000];

export interface TcpProbeOptions {
  readonly address: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** 열린 포트에서 배너를 읽습니다. 없으면 연결되자마자 닫습니다. */
  readonly readBanner?: BannerReader;
}

/**
 * TCP 연결로 포트 상태를 알아내는 probe를 만듭니다. 연결되면 open, 거부되면 closed, 응답이 없으면 filtered입니다.
 * 소켓이 모자라면 잠시 기다렸다가 다시 시도하고, 그래도 모자라면 동시 연결 수를 줄이라는 에러를 던집니다.
 */
export function createTcpProbe(options: TcpProbeOptions): PortProbe {
  const { address, timeoutMs, signal, readBanner } = options;
  return async (port) => {
    let busy = '';
    for (const wait of [0, ...RETRY_DELAYS_MS]) {
      if (wait > 0) {
        try {
          await delay(wait, undefined, { signal });
        } catch {
          return undefined;
        }
      }
      const outcome = await connectTcp(address, port, timeoutMs, signal);
      if (outcome === undefined) {
        return undefined;
      }
      if (outcome.state === 'busy') {
        busy = outcome.code;
        continue;
      }
      if (outcome.state !== 'open') {
        return { port, state: outcome.state };
      }
      if (readBanner === undefined) {
        outcome.socket.destroy();
        return { port, state: 'open' };
      }
      const reconnect = async () => {
        const again = await connectTcp(address, port, timeoutMs, signal);
        return again?.state === 'open' ? again.socket : undefined;
      };
      const banner = await readBanner(outcome.socket, port, reconnect);
      return banner === undefined ? { port, state: 'open' } : { port, state: 'open', banner };
    }
    throw new UserError(`ran out of sockets (${busy}); try a lower --concurrency`);
  };
}

/** TCP 연결을 시도합니다. 연결되면 소켓을 연 채로 돌려주고, 취소되면 undefined입니다. */
function connectTcp(
  address: string,
  port: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ConnectOutcome | undefined> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(undefined);
      return;
    }

    const socket = new Socket();
    let settled = false;
    const finish = (outcome: ConnectOutcome | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', onAbort);
      socket.setTimeout(0);
      if (outcome?.state !== 'open') {
        socket.destroy();
      }
      resolve(outcome);
    };
    const onAbort = () => {
      finish(undefined);
    };

    signal.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs, () => {
      finish({ state: 'filtered' });
    });
    socket.once('connect', () => {
      finish({ state: 'open', socket });
    });
    // 연결된 뒤에 나는 에러(상대가 끊음 등)도 이 리스너가 받아야 프로세스가 죽지 않습니다.
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(classify(error.code));
    });
    socket.connect({ host: address, port });
  });
}

function classify(code: string | undefined): ConnectOutcome {
  if (code === 'ECONNREFUSED') {
    return { state: 'closed' };
  }
  if (code !== undefined && LOCAL_RESOURCE_ERRORS.has(code)) {
    return { state: 'busy', code };
  }
  // 응답이 없을 때 말고도 방화벽이 ICMP로 거부하면 EHOSTUNREACH 같은 에러가 납니다. nmap처럼 filtered로 봅니다.
  return { state: 'filtered' };
}
