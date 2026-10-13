import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';

import { encodeName, readName } from '../dns/wire';

export interface HostnameOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/** 주소 하나의 이름을 찾습니다. 못 찾으면 undefined입니다. */
export type HostnameLookup = (address: string) => Promise<string | undefined>;

const NETBIOS_PORT = 137;
const MDNS_PORT = 5353;

/**
 * 호스트 이름을 세 가지로 찾아 처음 성공한 것을 씁니다.
 * 1) 역방향 DNS(PTR) 2) NetBIOS 이름(주로 Windows PC) 3) mDNS `.local` 이름(Apple 기기·프린터 등).
 * 집·사무실 기기는 PTR이 없는 경우가 많아 NetBIOS·mDNS가 이름을 채워 줍니다.
 */
export function createHostnameLookup(options: HostnameOptions): HostnameLookup {
  const resolver = new Resolver({ timeout: options.timeoutMs, tries: 1 });
  return async (address) => {
    if (options.signal.aborted) {
      return undefined;
    }
    return (
      (await reverseDns(resolver, address)) ??
      (await netbiosName(address, options)) ??
      (await mdnsName(address, options))
    );
  };
}

async function reverseDns(resolver: Resolver, address: string): Promise<string | undefined> {
  try {
    const [name] = await resolver.reverse(address);
    return name === undefined || name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

/** NetBIOS 노드 상태 요청을 보내 컴퓨터 이름(접미사 0x00, 고유)을 읽습니다. */
async function netbiosName(address: string, options: HostnameOptions): Promise<string | undefined> {
  // 헤더(트랜잭션 ID, 질의 1개) + "*" 이름을 NetBIOS 방식으로 인코딩한 질문입니다.
  const header = Buffer.from([0x13, 0x37, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  const name = Buffer.alloc(34);
  name[0] = 0x20;
  name[1] = 'C'.charCodeAt(0); // '*' = 0x2A → 상위 니블 2 → 'C'
  name[2] = 'K'.charCodeAt(0); // 하위 니블 A → 'K'
  name.fill('A'.charCodeAt(0), 3, 33); // 나머지 15바이트(널)는 'AA'로
  const question = Buffer.from([0x00, 0x21, 0x00, 0x01]); // NBSTAT, IN
  const reply = await queryUdp(
    address,
    NETBIOS_PORT,
    Buffer.concat([header, name, question]),
    options,
  );
  return reply === undefined ? undefined : parseNetbios(reply);
}

export function parseNetbios(reply: Buffer): string | undefined {
  try {
    // 헤더(12) + 질문 이름(34) + 타입·클래스(4)를 건너뜁니다. 응답 RR 이름은 포인터(2바이트)거나 전체(34바이트)입니다.
    let offset = 12 + 34 + 4;
    offset += ((reply[offset] ?? 0) & 0xc0) === 0xc0 ? 2 : 34;
    offset += 2 + 2 + 4 + 2; // 타입·클래스·TTL·RDLENGTH
    const count = reply[offset];
    if (count === undefined) {
      return undefined;
    }
    offset += 1;
    for (let index = 0; index < count; index++) {
      const entry = reply.subarray(offset, offset + 18);
      offset += 18;
      if (entry.length < 18) {
        break;
      }
      const suffix = entry[15];
      const flags = entry.readUInt16BE(16);
      const group = (flags & 0x8000) !== 0;
      // 접미사 0x00이면서 그룹이 아닌 항목이 컴퓨터 이름입니다.
      if (suffix === 0x00 && !group) {
        const label = entry.subarray(0, 15).toString('latin1').trim();
        return /^[\x20-\x7e]+$/.test(label) && label !== '' ? label : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** 주소의 역방향 이름(a.b.c.d.in-addr.arpa)을 mDNS로 물어 `.local` 이름을 읽습니다. */
async function mdnsName(address: string, options: HostnameOptions): Promise<string | undefined> {
  const labels = `${address.split('.').reverse().join('.')}.in-addr.arpa`;
  const question = [encodeName(labels), Buffer.from([0x00, 0x0c, 0x80, 0x01])]; // PTR, 유니캐스트 응답 요청(IN)
  const header = Buffer.from([0x13, 0x37, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  const reply = await queryUdp(address, MDNS_PORT, Buffer.concat([header, ...question]), options);
  return reply === undefined ? undefined : parsePtrAnswer(reply);
}

export function parsePtrAnswer(reply: Buffer): string | undefined {
  try {
    if (reply.readUInt16BE(6) < 1) {
      return undefined; // 응답(answer)이 없습니다.
    }
    const question = readName(reply, 12);
    const answer = readName(reply, question.next + 4); // 질문의 타입·클래스를 건너뜁니다.
    // 응답 RR의 타입·클래스·TTL·길이를 건너뛰면 이름이 담긴 rdata가 나옵니다.
    const { name } = readName(reply, answer.next + 2 + 2 + 4 + 2);
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

/** UDP 요청을 보내고 첫 응답을 기다립니다. 응답이 없거나 취소되면 undefined입니다. */
function queryUdp(
  address: string,
  port: number,
  packet: Buffer,
  options: HostnameOptions,
): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const finish = (reply: Buffer | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      socket.close();
      resolve(reply);
    };
    const onAbort = () => {
      finish(undefined);
    };

    socket.on('message', (message) => {
      finish(message);
    });
    socket.on('error', () => {
      finish(undefined);
    });
    const timer = setTimeout(() => {
      finish(undefined);
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
    socket.send(packet, port, address, (error) => {
      if (error) {
        finish(undefined);
      }
    });
  });
}
