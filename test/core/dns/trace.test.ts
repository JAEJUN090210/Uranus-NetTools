import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROOT_SERVERS, traceDelegation, type TraceStep } from '../../../src/core/dns/trace';
import { RECORD_TYPES } from '../../../src/core/dns/wire';
import { type FakeAnswer, type FakeDnsServer, listenFakeDns } from '../../helpers/dns-server';

const servers: FakeDnsServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** 호출될 때마다 다음 단계의 응답을 돌려주는 가짜 서버입니다. 위임 사슬을 한 포트로 흉내 냅니다. */
async function serveChain(chain: readonly FakeAnswer[]): Promise<FakeDnsServer> {
  let step = 0;
  const server = await listenFakeDns(() => chain[Math.min(step++, chain.length - 1)] ?? {});
  servers.push(server);
  return server;
}

const glue = (name: string) => ({ name, type: RECORD_TYPES.A, data: '127.0.0.1' });

const settings = (port: number) => ({
  timeoutMs: 2000,
  signal: new AbortController().signal,
  port,
  roots: [{ name: 'fake-root', address: '127.0.0.1' }],
});

describe('ROOT_SERVERS', () => {
  it('lists the 13 root servers with IPv4 addresses', () => {
    expect(ROOT_SERVERS).toHaveLength(13);
    for (const root of ROOT_SERVERS) {
      expect(root.name).toMatch(/^[a-m]\.root-servers\.net$/);
      expect(root.address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    }
  });
});

describe('traceDelegation', () => {
  it('follows referrals from the root down to the authoritative answer', async () => {
    const server = await serveChain([
      {
        authorities: [{ name: 'com', type: RECORD_TYPES.NS, data: 'a.gtld-servers.net' }],
        additionals: [glue('a.gtld-servers.net')],
      },
      {
        authorities: [{ name: 'example.com', type: RECORD_TYPES.NS, data: 'ns1.example.com' }],
        additionals: [glue('ns1.example.com')],
      },
      {
        answers: [{ name: 'example.com', type: RECORD_TYPES.A, data: '93.184.216.34' }],
        authoritative: true,
      },
    ]);
    const seen: TraceStep[] = [];

    const steps = await traceDelegation('example.com', RECORD_TYPES.A, {
      ...settings(server.port),
      onStep: (step) => {
        seen.push(step);
      },
    });

    expect(steps).toHaveLength(3);
    expect(steps.map((step) => step.zone)).toEqual(['com', 'example.com', 'example.com']);
    expect(steps[0]?.serverName).toBe('fake-root');
    expect(steps[0]?.nameservers).toEqual(['a.gtld-servers.net']);
    // 두 번째 단계는 첫 단계가 알려 준 서버에 묻습니다.
    expect(steps[1]?.serverName).toBe('a.gtld-servers.net');
    expect(steps[2]?.serverName).toBe('ns1.example.com');
    expect(steps[2]?.answers?.[0]?.data).toBe('93.184.216.34');
    expect(seen).toEqual(steps);
  });

  it('looks up a name server address when the referral has no glue', async () => {
    const server = await serveChain([
      { authorities: [{ name: 'example.test', type: RECORD_TYPES.NS, data: 'ns.other.test' }] },
      {
        answers: [{ name: 'example.test', type: RECORD_TYPES.A, data: '10.0.0.1' }],
        authoritative: true,
      },
    ]);
    const resolveNameserver = vi.fn(() => Promise.resolve('127.0.0.1'));

    const steps = await traceDelegation('example.test', RECORD_TYPES.A, {
      ...settings(server.port),
      resolveNameserver,
    });

    expect(resolveNameserver).toHaveBeenCalledWith('ns.other.test');
    expect(steps.at(-1)?.answers?.[0]?.data).toBe('10.0.0.1');
  });

  it('stops when a referral has no address to follow', async () => {
    const server = await serveChain([
      { authorities: [{ name: 'example.test', type: RECORD_TYPES.NS, data: 'ns.other.test' }] },
    ]);

    await expect(
      traceDelegation('example.test', RECORD_TYPES.A, settings(server.port)),
    ).rejects.toThrow('could not find an address for the example.test name servers');
  });

  it('stops at a server that offers neither an answer nor a referral', async () => {
    const server = await serveChain([{}]);

    const steps = await traceDelegation('example.test', RECORD_TYPES.A, settings(server.port));

    expect(steps).toHaveLength(1);
    expect(steps[0]?.answers).toBeUndefined();
    expect(steps[0]?.nameservers).toEqual([]);
  });
});
