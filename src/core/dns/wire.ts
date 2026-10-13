/**
 * DNS 메시지(RFC 1035)를 만들고 읽습니다.
 * Node의 dns 모듈은 대부분의 레코드에서 TTL을 주지 않고 특정 서버에 직접 묻기도 어려워서 직접 다룹니다.
 */

export const RECORD_TYPES = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  CAA: 257,
} as const;

export type RecordTypeName = keyof typeof RECORD_TYPES;

const TYPE_NAMES = new Map<number, RecordTypeName>(
  Object.entries(RECORD_TYPES).map(([name, value]) => [value, name as RecordTypeName]),
);

/** 숫자 타입의 이름입니다. 모르는 타입은 "TYPE65" 처럼 숫자를 그대로 보여줍니다. */
export function typeName(type: number): string {
  return TYPE_NAMES.get(type) ?? `TYPE${type}`;
}

export function isRecordType(name: string): name is RecordTypeName {
  return Object.hasOwn(RECORD_TYPES, name.toUpperCase());
}

export function recordType(name: string): number {
  const upper = name.toUpperCase();
  if (!isRecordType(upper)) {
    throw new RangeError(`${name} is not a record type I know.`);
  }
  return RECORD_TYPES[upper];
}

const RCODE_NAMES: Readonly<Record<number, string>> = {
  0: 'NOERROR',
  1: 'FORMERR',
  2: 'SERVFAIL',
  3: 'NXDOMAIN',
  4: 'NOTIMP',
  5: 'REFUSED',
};

export function rcodeName(rcode: number): string {
  return RCODE_NAMES[rcode] ?? `RCODE${rcode}`;
}

export interface ResourceRecord {
  readonly name: string;
  readonly type: number;
  /** 사람이 읽는 타입 이름입니다. (예: AAAA) */
  readonly typeName: string;
  readonly ttl: number;
  /** 레코드 내용을 dig과 비슷한 한 줄로 적은 것입니다. */
  readonly data: string;
}

export interface DnsMessage {
  readonly id: number;
  readonly response: boolean;
  /** 권한 있는 서버가 직접 답했는지 여부입니다. */
  readonly authoritative: boolean;
  /** 응답이 잘려서 TCP로 다시 물어야 하는지 여부입니다. */
  readonly truncated: boolean;
  readonly recursionAvailable: boolean;
  readonly rcode: number;
  readonly question?: { readonly name: string; readonly type: number };
  readonly answers: readonly ResourceRecord[];
  /** 위임을 따라갈 때 쓰는 NS 레코드입니다. */
  readonly authorities: readonly ResourceRecord[];
  /** 위임받은 서버의 주소(글루 레코드)입니다. */
  readonly additionals: readonly ResourceRecord[];
}

const MAX_LABEL = 63;
const POINTER_MASK = 0xc0;

/** 이름을 길이 접두사가 붙은 라벨들로 바꿉니다. 루트(".")는 0 한 바이트입니다. */
export function encodeName(name: string): Buffer {
  const trimmed = name.replace(/\.$/, '');
  if (trimmed === '') {
    return Buffer.from([0]);
  }
  const parts = trimmed.split('.').map((label) => {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length === 0 || bytes.length > MAX_LABEL) {
      throw new RangeError(`${name} has a label that is empty or too long.`);
    }
    return Buffer.concat([Buffer.from([bytes.length]), bytes]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/** 이름을 읽습니다. 압축 포인터를 따라가고, 이름 바로 뒤의 위치도 함께 돌려줍니다. */
export function readName(message: Buffer, start: number): { name: string; next: number } {
  const labels: string[] = [];
  let offset = start;
  let next = start;
  let fixed = false;
  // 포인터가 서로를 가리키며 무한 반복하는 응답을 막습니다.
  let hops = 0;

  for (;;) {
    if (offset >= message.length) {
      throw new RangeError('the DNS message ends inside a name.');
    }
    const length = message[offset] ?? 0;
    if (length === 0) {
      if (!fixed) {
        next = offset + 1;
      }
      break;
    }
    if ((length & POINTER_MASK) === POINTER_MASK) {
      if (hops++ > 64) {
        throw new RangeError('the DNS message has looping name pointers.');
      }
      const pointer = ((length & 0x3f) << 8) | (message[offset + 1] ?? 0);
      if (!fixed) {
        next = offset + 2;
        fixed = true;
      }
      offset = pointer;
      continue;
    }
    labels.push(message.subarray(offset + 1, offset + 1 + length).toString('utf8'));
    offset += 1 + length;
  }
  return { name: labels.join('.'), next };
}

/** 루트 영역의 이름은 빈 문자열로 읽히므로, 보여줄 때는 점 하나로 적습니다. */
function displayName(name: string): string {
  return name === '' ? '.' : name;
}

export interface QueryOptions {
  readonly id: number;
  readonly name: string;
  readonly type: number;
  /** 서버가 대신 끝까지 찾아 주길 바라는지 여부입니다. 위임 추적에서는 false로 둡니다. */
  readonly recursionDesired?: boolean;
}

export function buildQuery(options: QueryOptions): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(options.id, 0);
  header.writeUInt16BE(options.recursionDesired === false ? 0x0000 : 0x0100, 2);
  header.writeUInt16BE(1, 4); // 질문 1개
  const question = Buffer.alloc(4);
  question.writeUInt16BE(options.type, 0);
  question.writeUInt16BE(1, 2); // 클래스 IN
  return Buffer.concat([header, encodeName(options.name), question]);
}

export function parseMessage(message: Buffer): DnsMessage {
  if (message.length < 12) {
    throw new RangeError('the DNS response is too short.');
  }
  const flags = message.readUInt16BE(2);
  const counts = {
    question: message.readUInt16BE(4),
    answer: message.readUInt16BE(6),
    authority: message.readUInt16BE(8),
    additional: message.readUInt16BE(10),
  };

  let offset = 12;
  let question: DnsMessage['question'];
  for (let index = 0; index < counts.question; index++) {
    const { name, next } = readName(message, offset);
    question ??= { name, type: message.readUInt16BE(next) };
    offset = next + 4;
  }

  const read = (count: number) => {
    const records: ResourceRecord[] = [];
    for (let index = 0; index < count; index++) {
      if (offset >= message.length) {
        break;
      }
      const { name, next } = readName(message, offset);
      // 타입(2) 클래스(2) TTL(4) 길이(2) = 10바이트
      if (next + 10 > message.length) {
        break;
      }
      const type = message.readUInt16BE(next);
      const ttl = message.readUInt32BE(next + 4);
      const length = message.readUInt16BE(next + 8);
      const start = next + 10;
      const end = start + length;
      if (end > message.length) {
        break;
      }
      records.push({
        name,
        type,
        typeName: typeName(type),
        ttl,
        data: readData(message, type, start, end),
      });
      offset = end;
    }
    return records;
  };

  return {
    id: message.readUInt16BE(0),
    response: (flags & 0x8000) !== 0,
    authoritative: (flags & 0x0400) !== 0,
    truncated: (flags & 0x0200) !== 0,
    recursionAvailable: (flags & 0x0080) !== 0,
    rcode: flags & 0x000f,
    ...(question === undefined ? {} : { question }),
    answers: read(counts.answer),
    authorities: read(counts.authority),
    additionals: read(counts.additional),
  };
}

/** 레코드 내용을 타입에 맞게 한 줄 문자열로 만듭니다. 모르는 타입은 16진수로 보여줍니다. */
function readData(message: Buffer, type: number, start: number, end: number): string {
  switch (type) {
    case RECORD_TYPES.A:
      return [...message.subarray(start, end)].join('.');
    case RECORD_TYPES.AAAA:
      return formatIpv6(message.subarray(start, end));
    case RECORD_TYPES.NS:
    case RECORD_TYPES.CNAME:
    case RECORD_TYPES.PTR:
      return displayName(readName(message, start).name);
    case RECORD_TYPES.MX:
      return `${message.readUInt16BE(start)} ${displayName(readName(message, start + 2).name)}`;
    case RECORD_TYPES.TXT:
      return readTextChunks(message, start, end).join('');
    case RECORD_TYPES.SOA:
      return readSoa(message, start);
    case RECORD_TYPES.SRV:
      return [
        message.readUInt16BE(start),
        message.readUInt16BE(start + 2),
        message.readUInt16BE(start + 4),
        displayName(readName(message, start + 6).name),
      ].join(' ');
    case RECORD_TYPES.CAA:
      return readCaa(message, start, end);
    default:
      return message.subarray(start, end).toString('hex');
  }
}

/** 각 조각이 길이 한 바이트로 시작하는 문자열 목록입니다. 긴 TXT는 여러 조각으로 나뉩니다. */
function readTextChunks(message: Buffer, start: number, end: number): string[] {
  const chunks: string[] = [];
  let offset = start;
  while (offset < end) {
    const length = message[offset] ?? 0;
    chunks.push(message.subarray(offset + 1, Math.min(offset + 1 + length, end)).toString('utf8'));
    offset += 1 + length;
  }
  return chunks;
}

function readSoa(message: Buffer, start: number): string {
  const primary = readName(message, start);
  const mailbox = readName(message, primary.next);
  const numbers: number[] = [];
  for (let index = 0; index < 5; index++) {
    numbers.push(message.readUInt32BE(mailbox.next + index * 4));
  }
  return `${displayName(primary.name)} ${displayName(mailbox.name)} ${numbers.join(' ')}`;
}

function readCaa(message: Buffer, start: number, end: number): string {
  const flags = message[start] ?? 0;
  const tagLength = message[start + 1] ?? 0;
  const tag = message.subarray(start + 2, start + 2 + tagLength).toString('utf8');
  const value = message.subarray(start + 2 + tagLength, end).toString('utf8');
  return `${flags} ${tag} "${value}"`;
}

/** RFC 5952 형식으로 줄여 적습니다. 가장 긴 0 묶음을 "::"로 바꿉니다. */
export function formatIpv6(bytes: Buffer): string {
  const groups: string[] = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    groups.push(bytes.readUInt16BE(index).toString(16));
  }
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let index = 0; index <= groups.length; index++) {
    if (groups[index] === '0') {
      runStart = runStart === -1 ? index : runStart;
      continue;
    }
    if (runStart !== -1) {
      const length = index - runStart;
      if (length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }
      runStart = -1;
    }
  }
  if (bestLength < 2) {
    return groups.join(':');
  }
  const head = groups.slice(0, bestStart).join(':');
  const tail = groups.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}
