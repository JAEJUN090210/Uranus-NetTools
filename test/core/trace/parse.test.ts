import { describe, expect, it } from 'vitest';

import {
  parseTracepathLine,
  parseTracerouteHop,
  parseWindowsHop,
} from '../../../src/core/trace/parse';

function parseAll<T>(output: string, parse: (line: string) => T | undefined): T[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const parsed = parse(line);
    return parsed === undefined ? [] : [parsed];
  });
}

describe('parseWindowsHop', () => {
  it('reads every hop of an English tracert', () => {
    const output = [
      '',
      'Tracing route to dns.google [8.8.8.8]',
      'over a maximum of 30 hops:',
      '',
      '  1    <1 ms    <1 ms    <1 ms  192.168.0.1',
      '  2     3 ms     2 ms     3 ms  10.10.0.1',
      '  3     *        *        *     Request timed out.',
      '  4    12 ms     *       11 ms  router.example.net [72.14.202.18]',
      '  5    12 ms    12 ms    12 ms  dns.google [8.8.8.8]',
      '',
      'Trace complete.',
    ].join('\r\n');

    expect(parseAll(output, parseWindowsHop)).toEqual([
      { hop: 1, times: [0.5, 0.5, 0.5], addresses: [{ address: '192.168.0.1' }] },
      { hop: 2, times: [3, 2, 3], addresses: [{ address: '10.10.0.1' }] },
      { hop: 3, times: [undefined, undefined, undefined], addresses: [] },
      {
        hop: 4,
        times: [12, undefined, 11],
        addresses: [{ address: '72.14.202.18', name: 'router.example.net' }],
      },
      { hop: 5, times: [12, 12, 12], addresses: [{ address: '8.8.8.8', name: 'dns.google' }] },
    ]);
  });

  it('reads a Korean tracert the same way', () => {
    const output = [
      '최대 30홉 이상의',
      'dns.google [8.8.8.8](으)로 가는 경로 추적:',
      '',
      '  1    <1 ms    <1 ms    <1 ms  192.168.0.1',
      '  2     *        *        *     요청 시간이 만료되었습니다.',
      '  3    12 ms    11 ms    12 ms  dns.google [8.8.8.8]',
      '',
      '추적을 완료했습니다.',
    ].join('\r\n');

    expect(parseAll(output, parseWindowsHop).map((hop) => hop.addresses)).toEqual([
      [{ address: '192.168.0.1' }],
      [],
      [{ address: '8.8.8.8', name: 'dns.google' }],
    ]);
  });
});

describe('parseTracerouteHop', () => {
  it('reads names, lost probes, several addresses and annotations', () => {
    const output = [
      'traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 60 byte packets',
      ' 1  _gateway (192.168.0.1)  0.512 ms  0.456 ms  0.440 ms',
      ' 2  * * *',
      ' 3  10.10.0.1 (10.10.0.1)  4.512 ms *  4.456 ms',
      ' 4  a.example.net (72.14.202.18)  12.010 ms b.example.net (108.170.1.1)  12.120 ms  11.900 ms',
      ' 5  dns.google (8.8.8.8)  12.100 ms !H  12.000 ms  12.400 ms',
    ].join('\n');

    expect(parseAll(output, parseTracerouteHop)).toEqual([
      {
        hop: 1,
        times: [0.512, 0.456, 0.44],
        addresses: [{ address: '192.168.0.1', name: '_gateway' }],
      },
      { hop: 2, times: [undefined, undefined, undefined], addresses: [] },
      { hop: 3, times: [4.512, undefined, 4.456], addresses: [{ address: '10.10.0.1' }] },
      {
        hop: 4,
        times: [12.01, 12.12, 11.9],
        addresses: [
          { address: '72.14.202.18', name: 'a.example.net' },
          { address: '108.170.1.1', name: 'b.example.net' },
        ],
      },
      {
        hop: 5,
        times: [12.1, 12, 12.4],
        addresses: [{ address: '8.8.8.8', name: 'dns.google' }],
      },
    ]);
  });

  it('reads numeric output (-n) and macOS output', () => {
    expect(parseTracerouteHop(' 1  192.168.0.1  0.512 ms  0.456 ms  0.440 ms')).toEqual({
      hop: 1,
      times: [0.512, 0.456, 0.44],
      addresses: [{ address: '192.168.0.1' }],
    });
    expect(
      parseTracerouteHop(' 1  192.168.0.1 (192.168.0.1)  1.234 ms  0.987 ms  1.012 ms'),
    ).toEqual({ hop: 1, times: [1.234, 0.987, 1.012], addresses: [{ address: '192.168.0.1' }] });
  });
});

describe('parseTracepathLine', () => {
  it.each([
    [' 1?: [LOCALHOST]                      pmtu 1500', undefined],
    [
      ' 1:  _gateway (192.168.0.1)                                0.512ms',
      { hop: 1, time: 0.512, address: { address: '192.168.0.1', name: '_gateway' } },
    ],
    [
      ' 1:  192.168.0.1                                           0.402ms',
      { hop: 1, time: 0.402, address: { address: '192.168.0.1' } },
    ],
    [' 2:  no reply', { hop: 2 }],
    [
      ' 3:  dns.google (8.8.8.8)                                 12.110ms reached',
      { hop: 3, time: 12.11, address: { address: '8.8.8.8', name: 'dns.google' } },
    ],
    ['     Resume: pmtu 1500 hops 3 back 3', undefined],
  ])('%j', (line, expected) => {
    expect(parseTracepathLine(line)).toEqual(expected);
  });
});
