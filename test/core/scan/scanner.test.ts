import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import type { BannerReader } from '../../../src/core/scan/banner';
import { createTcpProbe, type PortResult, scanPorts } from '../../../src/core/scan/scanner';
import { closedPort, closeServer, listenLocally } from '../../helpers/server';

const never = new AbortController().signal;

describe('scanPorts', () => {
  it('runs at most `concurrency` probes at a time and sorts the results', async () => {
    let running = 0;
    let peak = 0;
    const probe = async (port: number): Promise<PortResult> => {
      running++;
      peak = Math.max(peak, running);
      await delay(port % 3);
      running--;
      return { port, state: port % 2 === 0 ? 'open' : 'closed' };
    };
    const done: number[] = [];

    const results = await scanPorts({
      ports: [5, 1, 4, 2, 3, 6, 9, 7, 8, 10],
      concurrency: 3,
      signal: never,
      probe,
      onResult: (_result, count) => {
        done.push(count);
      },
    });

    expect(peak).toBe(3);
    expect(results.map((result) => result.port)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(results[1]).toEqual({ port: 2, state: 'open' });
    expect(done).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('stops taking ports when cancelled and keeps the finished ones', async () => {
    const controller = new AbortController();
    const probe = (port: number): Promise<PortResult> => {
      if (port === 3) {
        controller.abort();
      }
      return Promise.resolve({ port, state: 'closed' });
    };

    const results = await scanPorts({
      ports: [1, 2, 3, 4, 5],
      concurrency: 1,
      signal: controller.signal,
      probe,
    });

    expect(results.map((result) => result.port)).toEqual([1, 2, 3]);
  });

  it('stops every worker and rethrows the first error', async () => {
    const asked: number[] = [];
    const probe = (port: number): Promise<PortResult> => {
      asked.push(port);
      return port === 2
        ? Promise.reject(new Error('out of sockets'))
        : Promise.resolve({ port, state: 'closed' });
    };

    await expect(
      scanPorts({ ports: [1, 2, 3, 4, 5, 6], concurrency: 2, signal: never, probe }),
    ).rejects.toThrow('out of sockets');
    expect(asked).toEqual([1, 2, 3]);
  });
});

describe('createTcpProbe', () => {
  it('reports a port that accepts the connection as open', async () => {
    const { server, port } = await listenLocally();
    try {
      const probe = createTcpProbe({ address: '127.0.0.1', timeoutMs: 2000, signal: never });

      expect(await probe(port)).toEqual({ port, state: 'open' });
    } finally {
      await closeServer(server);
    }
  });

  // Windows는 로컬의 닫힌 포트도 거부 응답까지 2초쯤 걸릴 수 있어 넉넉히 기다립니다.
  it('reports a port that refuses the connection as closed', { timeout: 15_000 }, async () => {
    const port = await closedPort();
    const probe = createTcpProbe({ address: '127.0.0.1', timeoutMs: 5000, signal: never });

    expect(await probe(port)).toEqual({ port, state: 'closed' });
  });

  it('reports a port that does not answer as filtered', async () => {
    // 192.0.2.0/24는 문서용 예시 대역이라 어떤 호스트에도 닿지 않습니다.
    const probe = createTcpProbe({ address: '192.0.2.1', timeoutMs: 300, signal: never });

    expect(await probe(80)).toEqual({ port: 80, state: 'filtered' });
  });

  it('returns nothing once cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const probe = createTcpProbe({
      address: '127.0.0.1',
      timeoutMs: 1000,
      signal: controller.signal,
    });

    expect(await probe(80)).toBeUndefined();
  });

  it('hands open sockets to the banner reader with a way to reconnect', async () => {
    const { server, port } = await listenLocally();
    try {
      const remotePorts: (number | undefined)[] = [];
      const readBanner: BannerReader = async (socket, _port, reconnect) => {
        const again = await reconnect();
        for (const each of [socket, again]) {
          remotePorts.push(each?.remotePort);
          each?.destroy();
        }
        return { text: 'hello' };
      };
      const probe = createTcpProbe({
        address: '127.0.0.1',
        timeoutMs: 2000,
        signal: never,
        readBanner,
      });

      expect(await probe(port)).toEqual({ port, state: 'open', banner: { text: 'hello' } });
      expect(remotePorts).toEqual([port, port]);
    } finally {
      await closeServer(server);
    }
  });
});
