import { describe, expect, it } from 'vitest';

import type { Hop } from '../../../src/core/trace/parse';
import {
  buildTraceCommand,
  createHopCollector,
  traceToolsFor,
} from '../../../src/core/trace/tracer';

const settings = { maxHops: 30, timeoutMs: 1500, resolveNames: true };
const ipv4 = { address: '8.8.8.8', family: 4 as const };

describe('traceToolsFor', () => {
  it('falls back to tracepath only on Linux', () => {
    expect(traceToolsFor('win32', 4)).toEqual(['tracert']);
    expect(traceToolsFor('darwin', 4)).toEqual(['traceroute']);
    expect(traceToolsFor('darwin', 6)).toEqual(['traceroute6']);
    expect(traceToolsFor('linux', 4)).toEqual(['traceroute', 'tracepath']);
  });
});

describe('buildTraceCommand', () => {
  it('builds tracert arguments with -d only for numeric output', () => {
    expect(buildTraceCommand('tracert', ipv4, settings, 'win32', {}).args).toEqual([
      '-h',
      '30',
      '-w',
      '1500',
      '-4',
      '8.8.8.8',
    ]);
    expect(
      buildTraceCommand('tracert', ipv4, { ...settings, resolveNames: false }, 'win32', {}).args,
    ).toContain('-d');
  });

  it('uses whole seconds, three probes and the C locale for traceroute', () => {
    expect(buildTraceCommand('traceroute', ipv4, settings, 'linux', { PATH: '/bin' })).toEqual({
      file: 'traceroute',
      args: ['-m', '30', '-w', '2', '-q', '3', '-4', '8.8.8.8'],
      env: { PATH: '/bin', LC_ALL: 'C' },
    });
  });

  it('leaves out -4/-6 for traceroute on macOS', () => {
    expect(buildTraceCommand('traceroute', ipv4, settings, 'darwin', {}).args).not.toContain('-4');
  });

  it('asks tracepath for names and addresses together', () => {
    expect(buildTraceCommand('tracepath', ipv4, settings, 'linux', {}).args).toEqual([
      '-b',
      '-m',
      '30',
      '-4',
      '8.8.8.8',
    ]);
  });
});

describe('createHopCollector', () => {
  it('passes each traceroute hop on right away', () => {
    const hops: Hop[] = [];
    const collector = createHopCollector('traceroute', (hop) => hops.push(hop));

    collector.line('traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets');
    collector.line(' 1  192.168.0.1  0.512 ms  0.456 ms  0.440 ms');

    expect(hops.map((hop) => hop.hop)).toEqual([1]);
  });

  it('merges the probe lines of tracepath into hops', () => {
    const hops: Hop[] = [];
    const collector = createHopCollector('tracepath', (hop) => hops.push(hop));

    for (const line of [
      ' 1?: [LOCALHOST]                      pmtu 1500',
      ' 1:  _gateway (192.168.0.1)          0.512ms',
      ' 1:  _gateway (192.168.0.1)          0.402ms',
      ' 2:  no reply',
      ' 3:  dns.google (8.8.8.8)           12.110ms reached',
    ]) {
      collector.line(line);
    }
    expect(hops).toHaveLength(2);
    collector.flush();

    expect(hops).toEqual([
      {
        hop: 1,
        times: [0.512, 0.402],
        addresses: [{ address: '192.168.0.1', name: '_gateway' }],
      },
      { hop: 2, times: [undefined], addresses: [] },
      { hop: 3, times: [12.11], addresses: [{ address: '8.8.8.8', name: 'dns.google' }] },
    ]);
  });
});
