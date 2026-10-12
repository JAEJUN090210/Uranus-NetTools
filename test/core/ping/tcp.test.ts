import { describe, expect, it } from 'vitest';

import { probeTcp } from '../../../src/core/ping/tcp';
import { closedPort, closeServer, listenLocally } from '../../helpers/server';

const never = new AbortController().signal;

describe('probeTcp', () => {
  it('measures the time to connect to an open port', async () => {
    const { server, port } = await listenLocally();
    try {
      const outcome = await probeTcp('127.0.0.1', port, 2000, never);

      expect(outcome.error).toBeUndefined();
      expect(outcome.time).toBeGreaterThanOrEqual(0);
    } finally {
      await closeServer(server);
    }
  });

  // Windows는 닫힌 포트의 연결 거부를 확인하기까지 약 2초가 걸립니다.
  it('reports a closed port as refused', { timeout: 15_000 }, async () => {
    const port = await closedPort();

    expect(await probeTcp('127.0.0.1', port, 10_000, never)).toEqual({ error: 'refused' });
  });

  it('rejects right away when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(probeTcp('127.0.0.1', 1, 2000, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
