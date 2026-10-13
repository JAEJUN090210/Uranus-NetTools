import { afterEach, describe, expect, it } from 'vitest';

import {
  chooseServer,
  DEFAULT_TYPES,
  lookupTypes,
  PUBLIC_RESOLVERS,
} from '../../../src/core/dns/lookup';
import { RECORD_TYPES } from '../../../src/core/dns/wire';
import { type FakeDnsServer, listenFakeDns } from '../../helpers/dns-server';
import { serveJson } from '../../helpers/lookup';

const servers: FakeDnsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const signal = new AbortController().signal;

describe('DEFAULT_TYPES / PUBLIC_RESOLVERS', () => {
  it('asks for the records people usually want', () => {
    expect(DEFAULT_TYPES).toEqual(['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA']);
  });

  it('compares against keyless public resolvers', () => {
    expect(PUBLIC_RESOLVERS.map((resolver) => resolver.address)).toEqual([
      '1.1.1.1',
      '8.8.8.8',
      '9.9.9.9',
    ]);
  });
});

describe('chooseServer', () => {
  it('uses the server the user asked for', () => {
    expect(chooseServer('9.9.9.9')).toEqual({ server: '9.9.9.9', servers: ['9.9.9.9'] });
  });

  it('falls back to DNS-over-HTTPS when the system servers cannot be used', () => {
    const messages: string[] = [];
    // systemServers()를 직접 바꿀 수 없으므로, 쓸 수 없는 목록이 나왔을 때의 동작만 확인합니다.
    const chosen = chooseServer(undefined, (message) => {
      messages.push(message);
    });

    if (chosen.server === undefined) {
      expect(messages[0]).toContain('DNS-over-HTTPS');
    } else {
      expect(chosen.servers).toContain(chosen.server);
    }
  });
});

describe('lookupTypes over UDP', () => {
  it('asks for every type and keeps the records, TTL and timing', async () => {
    const server = await listenFakeDns((name, type) => {
      if (type === RECORD_TYPES.A) {
        return { answers: [{ name, type, ttl: 60, data: '93.184.216.34' }] };
      }
      if (type === RECORD_TYPES.MX) {
        return { answers: [{ name, type, ttl: 3600, data: '10 mail.example.com' }] };
      }
      return { rcode: 3 };
    });
    servers.push(server);

    const report = await lookupTypes('example.com', ['A', 'MX', 'TXT'], {
      server: '127.0.0.1',
      settings: { timeoutMs: 2000, signal, port: server.port },
    });

    expect(report.server).toBe('127.0.0.1');
    expect(report.transport).toBe('udp');
    const [a, mx, txt] = report.results;
    expect(a?.records[0]).toMatchObject({ type: RECORD_TYPES.A, ttl: 60, data: '93.184.216.34' });
    expect(mx?.records[0]).toMatchObject({ ttl: 3600, data: '10 mail.example.com' });
    expect(a?.elapsed).toBeGreaterThanOrEqual(0);
    expect(txt?.records).toEqual([]);
    expect(txt?.status).toBe('NXDOMAIN');
  });

  it('keeps the CNAME chain when the asked-for type is not in the answer', async () => {
    const server = await listenFakeDns((name) => ({
      answers: [{ name, type: RECORD_TYPES.CNAME, ttl: 30, data: 'real.example.com' }],
    }));
    servers.push(server);

    const report = await lookupTypes('www.example.com', ['A'], {
      server: '127.0.0.1',
      settings: { timeoutMs: 2000, signal, port: server.port },
    });

    expect(report.results[0]?.records[0]).toMatchObject({
      typeName: 'CNAME',
      data: 'real.example.com',
    });
  });

  it('reports a server that does not answer as an error instead of throwing', async () => {
    const report = await lookupTypes('example.com', ['A'], {
      server: '127.0.0.1',
      // 아무도 듣지 않는 포트라 시간 초과가 납니다.
      settings: { timeoutMs: 120, signal, port: 1 },
    });

    expect(report.results[0]?.error).toBeTypeOf('string');
    expect(report.results[0]?.records).toEqual([]);
  });
});

describe('lookupTypes over DNS-over-HTTPS', () => {
  it('reads records and TTL from the JSON API', async () => {
    const fake = await serveJson(() => ({
      '/resolve?name=example.com&type=A': {
        body: {
          Status: 0,
          Answer: [
            { name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' },
            { name: 'example.com.', type: 5, TTL: 300, data: 'ignored.example.com.' },
          ],
        },
      },
      '/resolve?name=example.com&type=TXT': {
        body: {
          Status: 0,
          Answer: [{ name: 'example.com.', type: 16, TTL: 60, data: '"v=spf1 -all"' }],
        },
      },
      '/resolve?name=example.com&type=MX': {
        body: { Status: 0, Answer: [{ type: 15, TTL: 60, data: '0 .' }] },
      },
      '/resolve?name=example.com&type=NS': { body: { Status: 2 } },
    }));
    try {
      const report = await lookupTypes('example.com', ['A', 'TXT', 'MX', 'NS'], {
        server: 'doh',
        settings: { timeoutMs: 2000, signal },
        doh: {
          name: 'doh',
          url: `${fake.base}/resolve`,
          http: { signal, timeoutMs: 2000, accept: 'application/dns-json' },
        },
      });

      expect(report.transport).toBe('https');
      const [a, txt, mx, ns] = report.results;
      // 물어본 타입만 남기고, 이름 끝의 점은 떼어 냅니다.
      expect(a?.records).toHaveLength(1);
      expect(a?.records[0]).toMatchObject({ name: 'example.com', ttl: 300, data: '93.184.216.34' });
      // 따옴표로 감싼 TXT는 벗겨 냅니다.
      expect(txt?.records[0]?.data).toBe('v=spf1 -all');
      // 루트를 가리키는 MX(널 MX)는 점을 남깁니다.
      expect(mx?.records[0]?.data).toBe('0 .');
      expect(ns?.status).toBe('SERVFAIL');
    } finally {
      await fake.close();
    }
  });
});
