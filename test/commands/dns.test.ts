import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createDnsCommand, type DnsServices } from '../../src/commands/dns';
import type { LookupReport } from '../../src/core/dns/lookup';
import type { TraceStep } from '../../src/core/dns/trace';
import { RECORD_TYPES, type ResourceRecord } from '../../src/core/dns/wire';
import { createTestRuntime } from '../helpers/runtime';

function record(type: number, typeName: string, data: string, ttl = 300): ResourceRecord {
  return { name: 'example.com', type, typeName, ttl, data };
}

const aRecord = record(RECORD_TYPES.A, 'A', '93.184.216.34', 3600);
const mxRecord = record(RECORD_TYPES.MX, 'MX', '10 mail.example.com', 60);

function report(overrides: Partial<LookupReport> = {}): LookupReport {
  return {
    name: 'example.com',
    server: '1.1.1.1',
    transport: 'udp',
    results: [
      { type: 'A', records: [aRecord], elapsed: 12, transport: 'udp' },
      { type: 'MX', records: [mxRecord], elapsed: 20, transport: 'udp' },
    ],
    ...overrides,
  };
}

function fakeServices(overrides: Partial<DnsServices> = {}): DnsServices {
  return {
    chooseServer: () => ({ server: '1.1.1.1', servers: ['1.1.1.1'] }),
    lookupTypes: () => Promise.resolve(report()),
    trace: () => Promise.resolve([]),
    resolvers: [{ name: 'Cloudflare', address: '1.1.1.1' }],
    ...overrides,
  };
}

function groupsWith(services: DnsServices): readonly CommandGroup[] {
  return [{ heading: 'Lookup:', commands: [(runtime) => createDnsCommand(runtime, services)] }];
}

describe('unt dns', () => {
  it('is listed under Lookup in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Lookup:\n(?:.*\n)*?\s+dns/);
  });

  it('shows the records with their type, TTL and data', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['dns', 'example.com'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toMatch(/TYPE\s+TTL\s+DATA/);
    expect(stdout()).toMatch(/A\s+1h\s+93\.184\.216\.34/);
    expect(stdout()).toMatch(/MX\s+1m\s+10 mail\.example\.com/);
    expect(stdout()).toContain('▸ 2 records from 1.1.1.1 in 20 ms');
  });

  it('asks for the main records by default and for the ones given with --type', async () => {
    const lookupTypes = vi.fn<DnsServices['lookupTypes']>(() => Promise.resolve(report()));
    const { runtime } = createTestRuntime();

    await runCommand(['dns', 'example.com'], runtime, groupsWith(fakeServices({ lookupTypes })));
    expect(lookupTypes.mock.calls[0]?.[1]).toEqual([
      'A',
      'AAAA',
      'CNAME',
      'MX',
      'NS',
      'TXT',
      'SOA',
      'CAA',
    ]);

    await runCommand(
      ['dns', 'example.com', '-t', 'mx', '-t', 'ns'],
      runtime,
      groupsWith(fakeServices({ lookupTypes })),
    );
    expect(lookupTypes.mock.calls[1]?.[1]).toEqual(['MX', 'NS']);
  });

  it('rejects a record type it does not know', async () => {
    const { runtime, stderr } = createTestRuntime();

    const code = await runCommand(
      ['dns', 'example.com', '-t', 'nope'],
      runtime,
      groupsWith(fakeServices()),
    );

    expect(code).toBe(1);
    expect(stderr()).toContain('not a record type I know');
  });

  it('asks for PTR when given an IP address', async () => {
    const lookupTypes = vi.fn<DnsServices['lookupTypes']>(() =>
      Promise.resolve(report({ results: [] })),
    );
    const { runtime } = createTestRuntime();

    await runCommand(['dns', '8.8.8.8'], runtime, groupsWith(fakeServices({ lookupTypes })));

    expect(lookupTypes.mock.calls[0]?.[0]).toBe('8.8.8.8.in-addr.arpa');
    expect(lookupTypes.mock.calls[0]?.[1]).toEqual(['PTR']);
  });

  it('uses the server given with --server', async () => {
    const lookupTypes = vi.fn<DnsServices['lookupTypes']>(() =>
      Promise.resolve(report({ server: '9.9.9.9' })),
    );
    const { runtime, stdout } = createTestRuntime();

    await runCommand(
      ['dns', 'example.com', '--server', '9.9.9.9'],
      runtime,
      groupsWith(fakeServices({ lookupTypes })),
    );

    expect(lookupTypes.mock.calls[0]?.[2]).toMatchObject({ server: '9.9.9.9' });
    expect(stdout()).toContain('9.9.9.9');
  });

  it('rejects a server that is not an IP address', async () => {
    const { runtime, stderr } = createTestRuntime();

    expect(
      await runCommand(
        ['dns', 'example.com', '--server', 'dns.example'],
        runtime,
        groupsWith(fakeServices()),
      ),
    ).toBe(1);
    expect(stderr()).toContain('must be an IP address');
  });

  it('warns about a type the server could not answer and exits 1 with no records', async () => {
    const services = fakeServices({
      lookupTypes: () =>
        Promise.resolve(
          report({
            results: [
              { type: 'A', records: [], error: '1.1.1.1 did not answer in time' },
              { type: 'MX', records: [], status: 'SERVFAIL' },
            ],
          }),
        ),
    });
    const { runtime, stdout, stderr } = createTestRuntime();

    const code = await runCommand(['dns', 'example.com'], runtime, groupsWith(services));

    expect(code).toBe(1);
    expect(stderr()).toContain('A: 1.1.1.1 did not answer in time');
    expect(stderr()).toContain('MX: the server answered SERVFAIL');
    expect(stdout()).toContain('▸ no records for example.com');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['dns', 'example.com', '--json'], runtime, groupsWith(fakeServices()));

    expect(JSON.parse(stdout()) as unknown).toMatchObject({
      name: 'example.com',
      query: 'example.com',
      server: '1.1.1.1',
      transport: 'udp',
      types: [
        {
          type: 'A',
          status: 'NOERROR',
          elapsed: 12,
          records: [{ name: 'example.com', type: 'A', ttl: 3600, data: '93.184.216.34' }],
        },
        { type: 'MX', status: 'NOERROR', elapsed: 20 },
      ],
    });
  });

  describe('--compare', () => {
    it('shows each server and says so when they agree', async () => {
      const { runtime, stdout } = createTestRuntime();

      const code = await runCommand(
        ['dns', 'example.com', '--compare', '-t', 'A'],
        runtime,
        groupsWith(fakeServices()),
      );

      expect(code).toBe(0);
      expect(stdout()).toMatch(/SERVER\s+ADDRESS\s+TIME\s+RECORDS/);
      expect(stdout()).toContain('system');
      expect(stdout()).toContain('Cloudflare');
      expect(stdout()).toContain('▸ all 2 servers that answered agree');
    });

    it('leaves out a server that did not answer instead of calling it a disagreement', async () => {
      let call = 0;
      const services = fakeServices({
        lookupTypes: () => {
          call++;
          return Promise.resolve(
            report({
              results:
                call === 1
                  ? [{ type: 'A', records: [], error: '1.1.1.1 did not answer in time' }]
                  : [{ type: 'A', records: [aRecord], elapsed: 7 }],
            }),
          );
        },
      });
      const { runtime, stdout, stderr } = createTestRuntime();

      const code = await runCommand(
        ['dns', 'example.com', '--compare', '-t', 'A'],
        runtime,
        groupsWith(services),
      );

      expect(stdout()).toContain('no answer');
      expect(stderr()).toContain('did not answer');
      // 하나만 답했으므로 비교할 것이 없고, 불일치로 치지 않습니다.
      expect(stdout()).toContain('nothing to compare');
      expect(code).toBe(0);
    });

    it('exits 1 when the servers disagree', async () => {
      let call = 0;
      const services = fakeServices({
        lookupTypes: () => {
          call++;
          return Promise.resolve(
            report({
              results: [
                {
                  type: 'A',
                  records: [record(RECORD_TYPES.A, 'A', call === 1 ? '1.2.3.4' : '5.6.7.8')],
                  elapsed: 5,
                },
              ],
            }),
          );
        },
      });
      const { runtime, stdout } = createTestRuntime();

      const code = await runCommand(
        ['dns', 'example.com', '--compare', '-t', 'A'],
        runtime,
        groupsWith(services),
      );

      expect(code).toBe(1);
      expect(stdout()).toContain('1.2.3.4');
      expect(stdout()).toContain('5.6.7.8');
      expect(stdout()).toContain('do not agree');
    });
  });

  describe('--trace', () => {
    const steps: TraceStep[] = [
      {
        server: '198.41.0.4',
        serverName: 'a.root-servers.net',
        zone: 'com',
        elapsed: 30,
        nameservers: ['a.gtld-servers.net', 'b.gtld-servers.net'],
      },
      {
        server: '192.5.6.30',
        serverName: 'a.gtld-servers.net',
        zone: 'example.com',
        elapsed: 40,
        nameservers: ['ns1.example.com'],
        answers: [aRecord],
      },
    ];

    it('shows each step and the final answer', async () => {
      const trace = vi.fn(
        (_name: string, _type: number, options: { onStep?: (step: TraceStep) => void }) => {
          for (const step of steps) {
            options.onStep?.(step);
          }
          return Promise.resolve(steps);
        },
      );
      const { runtime, stdout } = createTestRuntime();

      const code = await runCommand(
        ['dns', 'example.com', '--trace'],
        runtime,
        groupsWith(fakeServices({ trace: trace as unknown as DnsServices['trace'] })),
      );

      expect(code).toBe(0);
      expect(stdout()).toContain('com');
      expect(stdout()).toContain('a.gtld-servers.net');
      expect(stdout()).toContain('answer from');
      expect(stdout()).toContain('93.184.216.34');
      expect(stdout()).toContain('▸ answered by a.gtld-servers.net after 2 steps');
    });

    it('cannot be combined with --compare', async () => {
      const { runtime, stderr } = createTestRuntime();

      const code = await runCommand(
        ['dns', 'example.com', '--trace', '--compare'],
        runtime,
        groupsWith(fakeServices()),
      );

      expect(code).toBe(1);
      expect(stderr()).toContain('cannot be used with');
    });
  });
});
