import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

import { UserError } from '../../cli/errors';

/** 연결 과정을 단계별로 잰 시간(ms)입니다. 평문 연결에는 tls가 없습니다. */
export interface ConnectTiming {
  readonly dns?: number;
  readonly tcp: number;
  readonly tls?: number;
}

export interface Connection {
  readonly socket: Socket;
  readonly timing: ConnectTiming;
  /** TLS에서 합의한 프로토콜입니다. (h2 또는 http/1.1) */
  readonly protocol?: string;
  readonly address?: string;
}

export interface ConnectOptions {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** 자체 서명 인증서 등 검증 실패를 무시합니다. */
  readonly insecure?: boolean;
  /** 제안할 프로토콜 목록입니다. 서버가 h2를 고르면 HTTP/2로 말할 수 있습니다. */
  readonly alpn?: readonly string[];
}

/**
 * TCP(필요하면 TLS까지) 연결을 맺으면서 각 단계에 걸린 시간을 잽니다.
 * fetch는 이 시간들을 알려주지 않아서 소켓을 직접 만듭니다.
 */
export function openConnection(options: ConnectOptions): Promise<Connection> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason as Error);
      return;
    }

    const startedAt = performance.now();
    let lookedUpAt: number | undefined;
    let connectedAt: number | undefined;
    let address: string | undefined;
    let settled = false;

    const socket: Socket = options.tls
      ? connectTls({
          host: options.host,
          port: options.port,
          servername: isIpLiteral(options.host) ? undefined : options.host,
          rejectUnauthorized: options.insecure !== true,
          ...(options.alpn === undefined ? {} : { ALPNProtocols: [...options.alpn] }),
        })
      : connectTcp({ host: options.host, port: options.port });

    const finish = (error: Error | undefined, connection?: Connection) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      socket.removeListener('error', onError);
      if (connection === undefined) {
        socket.destroy();
        reject(error ?? new UserError(`could not connect to ${options.host}`));
      } else {
        resolve(connection);
      }
    };
    const onAbort = () => {
      finish(options.signal.reason as Error);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      finish(describe(error, options));
    };

    const timer = setTimeout(() => {
      finish(new UserError(`${options.host} did not answer within ${options.timeoutMs} ms`));
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
    socket.on('error', onError);

    socket.once('lookup', (error: Error | null, resolved: string) => {
      if (error === null) {
        lookedUpAt = performance.now();
        address = resolved;
      }
    });

    const ready = options.tls ? 'secureConnect' : 'connect';
    socket.once('connect', () => {
      connectedAt = performance.now();
    });
    socket.once(ready, () => {
      const now = performance.now();
      const dnsDone = lookedUpAt ?? startedAt;
      const tcpDone = connectedAt ?? now;
      const secure = socket as TLSSocket;
      finish(undefined, {
        socket,
        timing: {
          ...(lookedUpAt === undefined ? {} : { dns: lookedUpAt - startedAt }),
          tcp: tcpDone - dnsDone,
          ...(options.tls ? { tls: now - tcpDone } : {}),
        },
        ...(options.tls && secure.alpnProtocol ? { protocol: secure.alpnProtocol } : {}),
        ...(address === undefined ? {} : { address }),
      });
    });
  });
}

function isIpLiteral(host: string): boolean {
  return /^[\d.]+$/.test(host) || host.includes(':');
}

function describe(error: NodeJS.ErrnoException, options: ConnectOptions): Error {
  if (error.name === 'AbortError') {
    return error;
  }
  const where = `${options.host}:${options.port}`;
  switch (error.code) {
    case 'ECONNREFUSED':
      return new UserError(`${where} refused the connection`);
    case 'ENOTFOUND':
      return new UserError(`cannot resolve ${options.host}`);
    case 'ETIMEDOUT':
      return new UserError(`${where} did not answer`);
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'CERT_HAS_EXPIRED':
      return new UserError(
        `the certificate of ${options.host} could not be verified (${error.code}); add --insecure to ignore it`,
      );
    default:
      return new UserError(`${where}: ${error.code ?? error.message}`);
  }
}
