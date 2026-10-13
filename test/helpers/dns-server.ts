import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { createServer, type Server } from 'node:net';

import {
  buildQuery,
  encodeName,
  parseMessage,
  readName,
  RECORD_TYPES,
} from '../../src/core/dns/wire';

export interface FakeRecord {
  readonly name: string;
  readonly type: number;
  readonly ttl?: number;
  /** 레코드 내용입니다. 이름이 들어가는 타입은 이름을, A/AAAA는 주소를 적습니다. */
  readonly data: string;
}

export interface FakeAnswer {
  readonly answers?: readonly FakeRecord[];
  readonly authorities?: readonly FakeRecord[];
  readonly additionals?: readonly FakeRecord[];
  readonly rcode?: number;
  readonly authoritative?: boolean;
  /** UDP 응답에 잘림 표시를 세워 클라이언트가 TCP로 다시 묻게 만듭니다. */
  readonly truncateOverUdp?: boolean;
}

/** 질의 이름·타입에 따라 어떤 응답을 줄지 정하는 함수입니다. */
export type FakeZone = (name: string, type: number) => FakeAnswer;

function encodeRecord(record: FakeRecord): Buffer {
  const head = Buffer.alloc(10);
  head.writeUInt16BE(record.type, 0);
  head.writeUInt16BE(1, 2); // IN
  head.writeUInt32BE(record.ttl ?? 300, 4);
  const data = encodeRecordData(record);
  head.writeUInt16BE(data.length, 8);
  return Buffer.concat([encodeName(record.name), head, data]);
}

function encodeRecordData(record: FakeRecord): Buffer {
  switch (record.type) {
    case RECORD_TYPES.A:
      return Buffer.from(record.data.split('.').map(Number));
    case RECORD_TYPES.AAAA: {
      const groups = record.data.split(':');
      const bytes = Buffer.alloc(16);
      groups.forEach((group, index) => {
        bytes.writeUInt16BE(Number.parseInt(group || '0', 16), index * 2);
      });
      return bytes;
    }
    case RECORD_TYPES.MX: {
      const [preference = '0', exchange = ''] = record.data.split(' ');
      const head = Buffer.alloc(2);
      head.writeUInt16BE(Number(preference), 0);
      return Buffer.concat([head, encodeName(exchange)]);
    }
    case RECORD_TYPES.TXT: {
      const text = Buffer.from(record.data, 'utf8');
      return Buffer.concat([Buffer.from([text.length]), text]);
    }
    case RECORD_TYPES.SOA: {
      const [primary = '', mailbox = '', ...numbers] = record.data.split(' ');
      const tail = Buffer.alloc(20);
      numbers.slice(0, 5).forEach((value, index) => {
        tail.writeUInt32BE(Number(value), index * 4);
      });
      return Buffer.concat([encodeName(primary), encodeName(mailbox), tail]);
    }
    case RECORD_TYPES.CAA: {
      const [flags = '0', tag = '', ...rest] = record.data.split(' ');
      const value = rest.join(' ').replace(/^"|"$/g, '');
      return Buffer.concat([
        Buffer.from([Number(flags), tag.length]),
        Buffer.from(tag, 'utf8'),
        Buffer.from(value, 'utf8'),
      ]);
    }
    default:
      return Buffer.concat([encodeName(record.data)]);
  }
}

function buildReply(request: Buffer, zone: FakeZone, overTcp: boolean): Buffer {
  const { name, next } = readName(request, 12);
  const type = request.readUInt16BE(next);
  const answer = zone(name, type);
  const truncated = answer.truncateOverUdp === true && !overTcp;

  let flags = 0x8000; // 응답
  if (answer.authoritative === true) {
    flags |= 0x0400;
  }
  if (truncated) {
    flags |= 0x0200;
  }
  flags |= 0x0080; // 재귀 가능
  flags |= answer.rcode ?? 0;

  const sections = truncated
    ? { answers: [], authorities: [], additionals: [] }
    : {
        answers: answer.answers ?? [],
        authorities: answer.authorities ?? [],
        additionals: answer.additionals ?? [],
      };

  const header = Buffer.alloc(12);
  header.writeUInt16BE(request.readUInt16BE(0), 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(sections.answers.length, 6);
  header.writeUInt16BE(sections.authorities.length, 8);
  header.writeUInt16BE(sections.additionals.length, 10);

  const question = request.subarray(12, next + 4);
  return Buffer.concat([
    header,
    question,
    ...sections.answers.map(encodeRecord),
    ...sections.authorities.map(encodeRecord),
    ...sections.additionals.map(encodeRecord),
  ]);
}

export interface FakeDnsServer {
  readonly address: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

/**
 * 127.0.0.1에서 UDP와 TCP로 DNS 질의를 받는 가짜 서버를 엽니다.
 * 실제 DNS 서버 없이 질의 생성과 응답 해석을 함께 확인할 수 있습니다.
 */
export async function listenFakeDns(zone: FakeZone): Promise<FakeDnsServer> {
  const udp: UdpSocket = createSocket('udp4');
  udp.on('message', (request, from) => {
    udp.send(buildReply(request, zone, false), from.port, from.address);
  });
  await new Promise<void>((resolve) => {
    udp.bind(0, '127.0.0.1', resolve);
  });
  const port = udp.address().port;

  const tcp: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length < 2) {
        return;
      }
      const expected = data.readUInt16BE(0);
      if (data.length < expected + 2) {
        return;
      }
      const reply = buildReply(data.subarray(2, expected + 2), zone, true);
      const length = Buffer.alloc(2);
      length.writeUInt16BE(reply.length, 0);
      socket.write(Buffer.concat([length, reply]));
    });
  });
  await new Promise<void>((resolve) => {
    tcp.listen(port, '127.0.0.1', resolve);
  });

  return {
    address: '127.0.0.1',
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        udp.close(resolve);
      });
      await new Promise<void>((resolve) => {
        tcp.close(() => {
          resolve();
        });
      });
    },
  };
}

export { buildQuery, parseMessage };
