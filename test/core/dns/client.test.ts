import { createSocket } from 'node:dgram';

import { afterEach, describe, expect, it } from 'vitest';

import { looksUnusable, query, systemServers } from '../../../src/core/dns/client';
import { RECORD_TYPES } from '../../../src/core/dns/wire';
import { type FakeDnsServer, listenFakeDns } from '../../helpers/dns-server';

const servers: FakeDnsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(...args: Parameters<typeof listenFakeDns>): Promise<FakeDnsServer> {
  const server = await listenFakeDns(...args);
  servers.push(server);
  return server;
}

const settings = (port: number, extra: Record<string, unknown> = {}) => ({
  timeoutMs: 2000,
  signal: new AbortController().signal,
  port,
  ...extra,
});

describe('query', () => {
  it('asks over UDP and reports how long it took', async () => {
    const server = await serve(() => ({
      answers: [{ name: 'example.com', type: RECORD_TYPES.A, ttl: 120, data: '93.184.216.34' }],
      authoritative: true,
    }));

    const result = await query('127.0.0.1', 'example.com', RECORD_TYPES.A, settings(server.port));

    expect(result.transport).toBe('udp');
    expect(result.server).toBe('127.0.0.1');
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
    expect(result.message.authoritative).toBe(true);
    expect(result.message.rcode).toBe(0);
    expect(result.message.question).toEqual({ name: 'example.com', type: RECORD_TYPES.A });
    expect(result.message.answers).toEqual([
      {
        name: 'example.com',
        type: RECORD_TYPES.A,
        typeName: 'A',
        ttl: 120,
        data: '93.184.216.34',
      },
    ]);
  });

  it('asks again over TCP when the UDP answer is truncated', async () => {
    const server = await serve(() => ({
      truncateOverUdp: true,
      answers: [{ name: 'example.com', type: RECORD_TYPES.TXT, data: 'x'.repeat(200) }],
    }));

    const result = await query('127.0.0.1', 'example.com', RECORD_TYPES.TXT, settings(server.port));

    expect(result.transport).toBe('tcp');
    expect(result.message.truncated).toBe(false);
    expect(result.message.answers[0]?.data).toBe('x'.repeat(200));
  });

  it('passes on the status when the server reports an error', async () => {
    const server = await serve(() => ({ rcode: 3 }));

    const result = await query('127.0.0.1', 'nope.invalid', RECORD_TYPES.A, settings(server.port));

    expect(result.message.rcode).toBe(3);
    expect(result.message.answers).toEqual([]);
  });

  it('gives up when the server never answers', async () => {
    const silent = createSocket('udp4');
    await new Promise<void>((resolve) => {
      silent.bind(0, '127.0.0.1', resolve);
    });
    const { port } = silent.address();
    try {
      await expect(
        query('127.0.0.1', 'example.com', RECORD_TYPES.A, settings(port, { timeoutMs: 150 })),
      ).rejects.toThrow('127.0.0.1 did not answer in time');
    } finally {
      await new Promise<void>((resolve) => {
        silent.close(resolve);
      });
    }
  });

  it('is rejected once cancelled', async () => {
    const server = await serve(() => ({ answers: [] }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      query('127.0.0.1', 'example.com', RECORD_TYPES.A, {
        timeoutMs: 2000,
        signal: controller.signal,
        port: server.port,
      }),
    ).rejects.toBeDefined();
  });
});

describe('systemServers', () => {
  it('returns the addresses as plain strings', () => {
    for (const server of systemServers()) {
      expect(server).not.toMatch(/[[\]%]/);
    }
  });
});

describe('looksUnusable', () => {
  it.each([
    [[], true],
    [['127.0.0.1'], true],
    [['::1'], true],
    [['127.0.0.1', '127.0.0.53'], true],
    [['1.1.1.1'], false],
    [['127.0.0.1', '1.1.1.1'], false],
  ])('%j -> %s', (list, expected) => {
    expect(looksUnusable(list)).toBe(expected);
  });
});
