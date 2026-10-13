import { isIP, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

import { USER_AGENT } from '../lookup/http';

export interface Banner {
  /** 서비스가 먼저 보낸 첫 줄, 또는 HTTP 요청에 대한 상태 줄과 Server 헤더입니다. */
  readonly text?: string;
  /** TLS로 연결했을 때의 프로토콜 버전입니다. (예: TLSv1.3) */
  readonly tls?: string;
}

export interface BannerOptions {
  /** 사용자가 입력한 호스트입니다. 이름이면 TLS SNI와 HTTP Host 헤더에 씁니다. */
  readonly host: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * 연결된 소켓에서 배너를 읽고 소켓을 닫습니다. 아무것도 받지 못하면 undefined입니다.
 * TLS를 다시 시도하려면 새 연결이 필요하므로 reconnect를 함께 받습니다.
 */
export type BannerReader = (
  socket: Socket,
  port: number,
  reconnect: () => Promise<Socket | undefined>,
) => Promise<Banner | undefined>;

// 처음부터 TLS로 말을 거는 포트입니다.
const TLS_PORTS = new Set([
  443, 465, 563, 636, 853, 989, 990, 992, 993, 994, 995, 5061, 6697, 8443, 9443,
]);

// 서버가 먼저 말하지 않는 HTTP 포트입니다. 인사말을 기다리지 않고 바로 요청을 보냅니다.
const HTTP_PORTS = new Set([
  80, 81, 443, 591, 3000, 5000, 8000, 8008, 8080, 8081, 8443, 8888, 9443,
]);

const MAX_BYTES = 4096;
const MAX_TEXT_LENGTH = 200;
/** 데이터가 오다가 멈추면 이만큼 더 기다린 뒤 받은 데까지 씁니다. */
const IDLE_MS = 300;

/**
 * 열린 포트가 스스로 밝히는 정보를 읽는 함수를 만듭니다.
 * 서버가 먼저 보내는 인사말(SSH, FTP, SMTP 등)을 기다리고, 없으면 HTTP HEAD 요청을 보내 봅니다.
 * TLS 포트는 TLS로 연결하고, 평문으로 아무 응답이 없던 포트도 새 연결에서 TLS를 시도합니다.
 */
export function createBannerReader(options: BannerOptions): BannerReader {
  return async (socket, port, reconnect) => {
    if (TLS_PORTS.has(port)) {
      const secure = await startTls(socket, options);
      if (secure !== undefined) {
        return talk(secure, port, options, secure.getProtocol() ?? undefined);
      }
      const plain = await reconnect();
      return plain === undefined ? undefined : talk(plain, port, options);
    }

    const banner = await talk(socket, port, options);
    if (banner !== undefined || options.signal.aborted) {
      return banner;
    }
    const retry = await reconnect();
    const secure = retry === undefined ? undefined : await startTls(retry, options);
    return secure === undefined
      ? undefined
      : talk(secure, port, options, secure.getProtocol() ?? undefined);
  };
}

/** 인사말을 기다리고, 없으면 HTTP 요청을 보내 응답을 읽은 뒤 소켓을 닫습니다. */
async function talk(
  socket: Socket,
  port: number,
  options: BannerOptions,
  tls?: string,
): Promise<Banner | undefined> {
  socket.on('error', () => undefined);
  try {
    let data = HTTP_PORTS.has(port) ? Buffer.alloc(0) : await receive(socket, options, endsLine);
    if (data.length === 0 && socket.writable && !options.signal.aborted) {
      socket.write(httpRequest(options.host, port));
      data = await receive(socket, options, endsHttpHead);
    }
    const text = describeBanner(data);
    return text === undefined && tls === undefined ? undefined : { text, tls };
  } finally {
    socket.destroy();
  }
}

/** isComplete가 참이 되거나, 연결이 끝나거나, 시간이 다 될 때까지 받은 데이터를 모읍니다. */
function receive(
  socket: Socket,
  options: BannerOptions,
  isComplete: (data: Buffer) => boolean,
): Promise<Buffer> {
  return new Promise((resolve) => {
    if (socket.destroyed || !socket.readable) {
      resolve(Buffer.alloc(0));
      return;
    }

    const chunks: Buffer[] = [];
    let idle: NodeJS.Timeout | undefined;
    const finish = () => {
      clearTimeout(timer);
      clearTimeout(idle);
      socket.off('data', onData);
      socket.off('end', finish);
      socket.off('close', finish);
      options.signal.removeEventListener('abort', finish);
      resolve(Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length >= MAX_BYTES || isComplete(data)) {
        finish();
        return;
      }
      clearTimeout(idle);
      idle = setTimeout(finish, IDLE_MS);
    };

    const timer = setTimeout(finish, options.timeoutMs);
    socket.on('data', onData);
    socket.once('end', finish);
    socket.once('close', finish);
    options.signal.addEventListener('abort', finish, { once: true });
  });
}

function endsLine(data: Buffer): boolean {
  return data.includes('\n');
}

function endsHttpHead(data: Buffer): boolean {
  const text = data.toString('latin1');
  return text.startsWith('HTTP/') ? /\r?\n\r?\n/.test(text) : text.includes('\n');
}

function httpRequest(host: string, port: number): string {
  const name = isIP(host) === 6 ? `[${host}]` : host;
  const authority = port === 80 || port === 443 ? name : `${name}:${port}`;
  return `HEAD / HTTP/1.0\r\nHost: ${authority}\r\nUser-Agent: ${USER_AGENT}\r\nAccept: */*\r\n\r\n`;
}

/** TLS 핸드셰이크를 합니다. 실패하면 소켓을 닫고 undefined를 돌려줍니다. */
function startTls(socket: Socket, options: BannerOptions): Promise<TLSSocket | undefined> {
  return new Promise((resolve) => {
    const secure = connectTls({
      socket,
      // IP 주소로는 SNI를 보낼 수 없습니다. (RFC 6066)
      ...(isIP(options.host) === 0 ? { servername: options.host } : {}),
      // 자체 서명 인증서나 오래된 TLS를 쓰는 장비(공유기 관리 페이지 등)도 읽을 수 있게 검증과 보안 수준을 낮춥니다.
      rejectUnauthorized: false,
      minVersion: 'TLSv1',
      ciphers: 'DEFAULT:@SECLEVEL=0',
      ALPNProtocols: ['http/1.1'],
    });
    let settled = false;
    const finish = (result: TLSSocket | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', fail);
      if (result === undefined) {
        secure.destroy();
      }
      resolve(result);
    };
    const fail = () => {
      finish(undefined);
    };

    const timer = setTimeout(fail, options.timeoutMs);
    secure.once('secureConnect', () => {
      finish(secure);
    });
    secure.on('error', fail);
    secure.once('close', fail);
    options.signal.addEventListener('abort', fail, { once: true });
  });
}

/** 받은 데이터를 한 줄로 요약합니다. 보여줄 글자가 없으면 undefined입니다. */
export function describeBanner(data: Buffer): string | undefined {
  if (data.length === 0) {
    return undefined;
  }
  const text = describeMysql(data) ?? describeText(data.toString('utf8'));
  return text === '' ? undefined : text;
}

function describeText(text: string): string {
  const lines = text.split(/\r?\n/);
  if (text.startsWith('HTTP/')) {
    const status = clean(lines[0] ?? '');
    const server = lines.find((line) => /^server:/i.test(line));
    return server === undefined ? status : `${status} · ${clean(server.slice('server:'.length))}`;
  }
  return lines.map(clean).find((line) => line !== '') ?? '';
}

/** MySQL과 MariaDB는 연결하자마자 이진 형식의 패킷을 보내므로 버전이나 에러 메시지만 꺼냅니다. */
function describeMysql(data: Buffer): string | undefined {
  // 패킷은 길이 3바이트(리틀 엔디언), 순번 1바이트(첫 패킷은 0), 본문 순서입니다.
  if (data.length < 5 || data[3] !== 0) {
    return undefined;
  }
  const length = data.readUIntLE(0, 3);
  if (length + 4 > data.length) {
    return undefined;
  }
  const body = data.subarray(4, 4 + length);
  if (body[0] === 0x0a) {
    const end = body.indexOf(0, 1);
    const version = end > 1 ? body.subarray(1, end).toString('latin1') : '';
    return /^[\x20-\x7e]+$/.test(version) ? `MySQL ${version}` : undefined;
  }
  if (body[0] === 0xff && body.length > 3) {
    const message = body.subarray(3).toString('utf8');
    // 4.1 이후 형식은 메시지 앞에 '#'과 SQLSTATE 다섯 글자가 붙습니다.
    const plain = message.startsWith('#') ? message.slice(6) : message;
    return `MySQL error ${body.readUInt16LE(1)}: ${clean(plain)}`;
  }
  return undefined;
}

/** 제어 문자와 깨진 글자를 공백으로 바꾸고, 공백을 하나로 줄이고, 너무 길면 자릅니다. */
function clean(text: string): string {
  let result = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const unprintable = code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0xfffd;
    result += unprintable ? ' ' : char;
  }
  return result.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}
