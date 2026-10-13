import { describe, expect, it } from 'vitest';

import {
  buildQuery,
  encodeName,
  formatIpv6,
  isRecordType,
  parseMessage,
  rcodeName,
  readName,
  RECORD_TYPES,
  recordType,
  typeName,
} from '../../../src/core/dns/wire';
import { listenFakeDns } from '../../helpers/dns-server';

describe('encodeName', () => {
  it('writes each label with its length and a zero terminator', () => {
    expect([...encodeName('a.bc')]).toEqual([1, 0x61, 2, 0x62, 0x63, 0]);
  });

  it('writes the root as a single zero', () => {
    expect([...encodeName('.')]).toEqual([0]);
    expect([...encodeName('')]).toEqual([0]);
  });

  it('ignores a trailing dot', () => {
    expect(encodeName('a.')).toEqual(encodeName('a'));
  });

  it('refuses a label that is empty or too long', () => {
    expect(() => encodeName('a..b')).toThrow('empty or too long');
    expect(() => encodeName(`${'x'.repeat(64)}.com`)).toThrow('empty or too long');
  });
});

describe('readName', () => {
  it('reads a plain name and the offset after it', () => {
    const message = Buffer.concat([encodeName('example.com'), Buffer.from([0xff])]);

    expect(readName(message, 0)).toEqual({ name: 'example.com', next: message.length - 1 });
  });

  it('follows a compression pointer and returns the offset after the pointer', () => {
    const message = Buffer.concat([
      Buffer.alloc(2), // 앞의 두 바이트는 이름이 아닙니다.
      encodeName('example.com'),
      Buffer.from([0xc0, 0x02]), // 오프셋 2를 가리키는 포인터
    ]);
    const pointerAt = message.length - 2;

    expect(readName(message, pointerAt)).toEqual({ name: 'example.com', next: message.length });
  });

  it('refuses names whose pointers loop', () => {
    const message = Buffer.from([0xc0, 0x00, 0x00]);

    expect(() => readName(message, 0)).toThrow('looping name pointers');
  });

  it('refuses a name that runs past the end', () => {
    expect(() => readName(Buffer.from([5, 0x61]), 0)).toThrow('ends inside a name');
  });
});

describe('record types', () => {
  it('maps names and numbers both ways', () => {
    expect(recordType('aaaa')).toBe(RECORD_TYPES.AAAA);
    expect(typeName(RECORD_TYPES.CAA)).toBe('CAA');
    expect(isRecordType('mx')).toBe(true);
    expect(isRecordType('nope')).toBe(false);
  });

  it('shows unknown types as a number', () => {
    expect(typeName(65)).toBe('TYPE65');
  });

  it('refuses a type it does not know', () => {
    expect(() => recordType('nope')).toThrow('not a record type I know');
  });
});

describe('rcodeName', () => {
  it.each([
    [0, 'NOERROR'],
    [3, 'NXDOMAIN'],
    [5, 'REFUSED'],
    [11, 'RCODE11'],
  ])('%i -> %s', (rcode, name) => {
    expect(rcodeName(rcode)).toBe(name);
  });
});

describe('formatIpv6', () => {
  it.each([
    ['20010db8000000000000000000000001', '2001:db8::1'],
    ['00000000000000000000000000000001', '::1'],
    ['20010db8000000000001000000000001', '2001:db8::1:0:0:1'],
    ['20010db8111122223333444455556666', '2001:db8:1111:2222:3333:4444:5555:6666'],
  ])('%s -> %s', (hex, expected) => {
    expect(formatIpv6(Buffer.from(hex, 'hex'))).toBe(expected);
  });
});

describe('buildQuery', () => {
  it('asks for recursion by default and can turn it off', () => {
    expect(buildQuery({ id: 1, name: 'a.com', type: 1 }).readUInt16BE(2)).toBe(0x0100);
    expect(
      buildQuery({ id: 1, name: 'a.com', type: 1, recursionDesired: false }).readUInt16BE(2),
    ).toBe(0x0000);
  });

  it('carries the id, one question, and the type', () => {
    const packet = buildQuery({ id: 0xbeef, name: 'a.com', type: RECORD_TYPES.MX });

    expect(packet.readUInt16BE(0)).toBe(0xbeef);
    expect(packet.readUInt16BE(4)).toBe(1);
    expect(packet.readUInt16BE(packet.length - 4)).toBe(RECORD_TYPES.MX);
  });
});

describe('parseMessage', () => {
  it('refuses a response that is too short', () => {
    expect(() => parseMessage(Buffer.alloc(5))).toThrow('too short');
  });

  /** 가짜 서버로 실제 응답을 받아 각 타입의 내용을 읽어 봅니다. */
  async function answerFor(data: string, type: number): Promise<string> {
    const server = await listenFakeDns(() => ({
      answers: [{ name: 'example.com', type, ttl: 60, data }],
      authoritative: true,
    }));
    try {
      const { query } = await import('../../../src/core/dns/client');
      const result = await query('127.0.0.1', 'example.com', type, {
        timeoutMs: 2000,
        signal: new AbortController().signal,
        port: server.port,
      });
      return result.message.answers[0]?.data ?? '';
    } finally {
      await server.close();
    }
  }

  it.each([
    ['A', RECORD_TYPES.A, '93.184.216.34'],
    ['AAAA', RECORD_TYPES.AAAA, '2606:2800:220:1:248:1893:25c8:1946'],
    ['CNAME', RECORD_TYPES.CNAME, 'www.example.com'],
    ['NS', RECORD_TYPES.NS, 'ns1.example.com'],
    ['PTR', RECORD_TYPES.PTR, 'host.example.com'],
    ['MX', RECORD_TYPES.MX, '10 mail.example.com'],
    ['TXT', RECORD_TYPES.TXT, 'v=spf1 -all'],
    ['SOA', RECORD_TYPES.SOA, 'ns1.example.com hostmaster.example.com 2024 7200 3600 1209600 300'],
    ['CAA', RECORD_TYPES.CAA, '0 issue "letsencrypt.org"'],
  ])('reads a %s record', async (_label, type, data) => {
    expect(await answerFor(data, type)).toBe(data);
  });

  it('reads the root zone in a name as a single dot', async () => {
    expect(await answerFor('0 .', RECORD_TYPES.MX)).toBe('0 .');
  });
});
