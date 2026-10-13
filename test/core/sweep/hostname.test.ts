import { describe, expect, it } from 'vitest';

import { encodeDnsName, parseNetbios, parsePtrAnswer } from '../../../src/core/sweep/hostname';

/** 컴퓨터 이름 하나(접미사 지정)를 담은 NetBIOS 노드 상태 응답을 만듭니다. */
function netbiosReply(name: string, suffix: number, group = false): Buffer {
  const reply = Buffer.alloc(63 + 18);
  reply[50] = 0xc0; // 응답 RR 이름은 질문을 가리키는 압축 포인터입니다.
  reply[51] = 0x0c;
  reply[62] = 1; // 이름 1개
  const entry = Buffer.alloc(18, 0x20); // 이름 15바이트는 공백으로 채웁니다.
  entry.write(name, 0, 'latin1');
  entry[15] = suffix;
  entry.writeUInt16BE(group ? 0x8000 : 0x0000, 16);
  entry.copy(reply, 63);
  return reply;
}

describe('parseNetbios', () => {
  it('reads the unique workstation name (suffix 0x00)', () => {
    expect(parseNetbios(netbiosReply('DESKTOP-1A2B', 0x00))).toBe('DESKTOP-1A2B');
  });

  it('ignores group names and other suffixes', () => {
    expect(parseNetbios(netbiosReply('WORKGROUP', 0x00, true))).toBeUndefined();
    expect(parseNetbios(netbiosReply('FILESERVER', 0x20))).toBeUndefined();
  });

  it('returns nothing for a truncated reply', () => {
    expect(parseNetbios(Buffer.alloc(20))).toBeUndefined();
  });
});

/** "질문 이름 / PTR 응답(rdata = name)" 형태의 DNS 응답을 만듭니다. */
function ptrReply(query: string, answer: string | undefined): Buffer {
  const header = Buffer.from([0x13, 0x37, 0x84, 0x00, 0, 1, answer ? 1 : 0, 0, 0, 0, 0, 0]);
  const question = Buffer.concat([encodeDnsName(query), Buffer.from([0x00, 0x0c, 0x00, 0x01])]);
  if (answer === undefined) {
    return Buffer.concat([header, question]);
  }
  const rdata = encodeDnsName(answer);
  const rdLength = Buffer.alloc(2);
  rdLength.writeUInt16BE(rdata.length, 0);
  const rr = Buffer.concat([
    Buffer.from([0xc0, 0x0c]), // 질문 이름을 가리키는 포인터
    Buffer.from([0x00, 0x0c, 0x00, 0x01, 0, 0, 0, 60]), // PTR, IN, TTL 60
    rdLength,
    rdata,
  ]);
  return Buffer.concat([header, question, rr]);
}

describe('parsePtrAnswer', () => {
  it('reads the PTR name from a response', () => {
    const reply = ptrReply('5.0.168.192.in-addr.arpa', 'printer.local');

    expect(parsePtrAnswer(reply)).toBe('printer.local');
  });

  it('returns nothing when there is no answer', () => {
    expect(parsePtrAnswer(ptrReply('5.0.168.192.in-addr.arpa', undefined))).toBeUndefined();
  });
});

describe('encodeDnsName', () => {
  it('encodes each label with its length and a zero terminator', () => {
    expect([...encodeDnsName('a.bc')]).toEqual([1, 0x61, 2, 0x62, 0x63, 0]);
  });
});
