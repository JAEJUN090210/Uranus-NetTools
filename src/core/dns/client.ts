import { createSocket } from 'node:dgram';
import { getServers } from 'node:dns';
import { isIPv6, Socket } from 'node:net';

import { UserError } from '../../cli/errors';
import { buildQuery, type DnsMessage, parseMessage } from './wire';

export const DNS_PORT = 53;

export interface QuerySettings {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** 위임을 따라갈 때는 서버가 대신 찾아 주지 않도록 false로 둡니다. */
  readonly recursionDesired?: boolean;
  /** 기본은 53번입니다. 테스트에서 다른 포트의 가짜 서버를 쓸 때 지정합니다. */
  readonly port?: number;
}

export interface QueryResult {
  readonly message: DnsMessage;
  /** 질의부터 응답까지 걸린 시간(ms)입니다. */
  readonly elapsed: number;
  readonly transport: 'udp' | 'tcp';
  readonly server: string;
}

/** 질의 ID는 응답이 섞이지 않게 매번 다르게 만듭니다. */
function nextId(): number {
  return Math.floor(Math.random() * 0xffff);
}

/**
 * DNS 서버 하나에 질의를 보냅니다. 응답이 잘렸으면(TC) TCP로 다시 묻습니다.
 * 서버가 답하지 않거나 취소되면 사용자에게 보여줄 메시지와 함께 UserError를 던집니다.
 */
export async function query(
  server: string,
  name: string,
  type: number,
  settings: QuerySettings,
): Promise<QueryResult> {
  const id = nextId();
  const packet = buildQuery({
    id,
    name,
    type,
    ...(settings.recursionDesired === undefined
      ? {}
      : { recursionDesired: settings.recursionDesired }),
  });

  const startedAt = performance.now();
  const reply = await sendUdp(server, packet, settings);
  const message = parseMessage(reply);
  if (!message.truncated) {
    return {
      message,
      elapsed: performance.now() - startedAt,
      transport: 'udp',
      server,
    };
  }

  // 응답이 잘렸으면 길이 제한이 없는 TCP로 다시 묻습니다. (큰 TXT나 NS 목록)
  const overTcp = await sendTcp(server, packet, settings);
  return {
    message: parseMessage(overTcp),
    elapsed: performance.now() - startedAt,
    transport: 'tcp',
    server,
  };
}

function sendUdp(server: string, packet: Buffer, settings: QuerySettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (settings.signal.aborted) {
      reject(settings.signal.reason as Error);
      return;
    }

    const socket = createSocket(isIPv6(server) ? 'udp6' : 'udp4');
    let settled = false;
    const finish = (error: Error | undefined, reply?: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      settings.signal.removeEventListener('abort', onAbort);
      socket.close();
      if (reply === undefined) {
        reject(error ?? timeoutError(server));
      } else {
        resolve(reply);
      }
    };
    const onAbort = () => {
      finish(settings.signal.reason as Error);
    };

    socket.on('message', (reply) => {
      finish(undefined, reply);
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(describe(error, server));
    });
    const timer = setTimeout(() => {
      finish(timeoutError(server));
    }, settings.timeoutMs);
    settings.signal.addEventListener('abort', onAbort, { once: true });
    socket.send(
      packet,
      settings.port ?? DNS_PORT,
      server,
      (error: NodeJS.ErrnoException | null) => {
        if (error) {
          finish(describe(error, server));
        }
      },
    );
  });
}

/** TCP로 보내는 DNS 메시지는 앞에 2바이트 길이가 붙습니다. */
function sendTcp(server: string, packet: Buffer, settings: QuerySettings): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (settings.signal.aborted) {
      reject(settings.signal.reason as Error);
      return;
    }

    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error: Error | undefined, reply?: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      settings.signal.removeEventListener('abort', onAbort);
      socket.destroy();
      if (reply === undefined) {
        reject(error ?? timeoutError(server));
      } else {
        resolve(reply);
      }
    };
    const onAbort = () => {
      finish(settings.signal.reason as Error);
    };

    const length = Buffer.alloc(2);
    length.writeUInt16BE(packet.length, 0);
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length >= 2) {
        const expected = data.readUInt16BE(0);
        if (data.length >= expected + 2) {
          finish(undefined, data.subarray(2, expected + 2));
        }
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(describe(error, server));
    });
    socket.on('close', () => {
      finish(new UserError(`${server} closed the connection before answering`));
    });
    const timer = setTimeout(() => {
      finish(timeoutError(server));
    }, settings.timeoutMs);
    settings.signal.addEventListener('abort', onAbort, { once: true });
    socket.connect({ host: server, port: settings.port ?? DNS_PORT }, () => {
      socket.write(Buffer.concat([length, packet]));
    });
  });
}

function timeoutError(server: string): UserError {
  return new UserError(`${server} did not answer in time`);
}

function describe(error: NodeJS.ErrnoException, server: string): Error {
  if (error.name === 'AbortError') {
    return error;
  }
  const reason =
    error.code === 'ECONNREFUSED'
      ? 'refused the connection'
      : error.code === 'EACCES' || error.code === 'EPERM'
        ? 'was blocked (a firewall may block DNS)'
        : (error.code ?? error.message);
  return new UserError(`${server} ${reason}`);
}

/**
 * 시스템에 설정된 DNS 서버입니다.
 * Windows에서 VPN을 쓰면 Node가 127.0.0.1만 알려 주는 경우가 있어, 그때는 호출한 쪽이 다른 길을 택합니다.
 */
export function systemServers(): string[] {
  return getServers().map((server) => server.replace(/^\[|]$/g, '').replace(/%.*$/, ''));
}

/** 127.0.0.1처럼 실제로는 답하지 못하는 서버만 설정돼 있는지 봅니다. */
export function looksUnusable(servers: readonly string[]): boolean {
  return (
    servers.length === 0 || servers.every((server) => /^(127\.|::1$|0\.0\.0\.0$)/.test(server))
  );
}
