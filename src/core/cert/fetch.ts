import { connect as connectTcp, isIP, type Socket } from 'node:net';
import { connect as connectTls, type DetailedPeerCertificate, type TLSSocket } from 'node:tls';

import { UserError } from '../../cli/errors';
import { startTlsOn, type StartTlsProtocol } from './starttls';

export interface CertificateResult {
  readonly certificate: DetailedPeerCertificate;
  /** 운영체제의 인증기관 목록으로 검증에 성공했는지 여부입니다. */
  readonly trusted: boolean;
  /** 검증에 실패한 이유입니다. (예: CERT_HAS_EXPIRED) */
  readonly trustError?: string;
  readonly protocol?: string;
  readonly cipher?: string;
  readonly address?: string;
  /** 핸드셰이킹까지 걸린 시간(ms)입니다. */
  readonly elapsed: number;
}

export interface FetchOptions {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** 평문으로 시작해 TLS로 전환하는 서버의 종류입니다. */
  readonly starttls?: StartTlsProtocol;
}

/**
 * 서버의 인증서를 가져옵니다.
 * 만료되거나 자체 서명된 인증서도 내용을 봐야 하므로 검증 실패로 연결을 끊지 않고 결과만 기록합니다.
 */
export async function fetchCertificate(options: FetchOptions): Promise<CertificateResult> {
  const startedAt = performance.now();
  const plain = await openSocket(options);
  if (options.starttls !== undefined) {
    await startTlsOn(plain, options.starttls, options);
  }
  return upgrade(plain, options, startedAt);
}

function openSocket(options: FetchOptions): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason as Error);
      return;
    }
    const socket = connectTcp({ host: options.host, port: options.port });
    const finish = (error?: Error) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      socket.removeListener('error', onError);
      socket.removeListener('connect', onConnect);
      if (error === undefined) {
        resolve(socket);
      } else {
        socket.destroy();
        reject(error);
      }
    };
    const onAbort = () => {
      finish(options.signal.reason as Error);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      finish(describe(error, options));
    };
    const onConnect = () => {
      finish();
    };
    const timer = setTimeout(() => {
      finish(new UserError(`${options.host}:${options.port} did not answer in time`));
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
    socket.once('error', onError);
    socket.once('connect', onConnect);
  });
}

/** 이미 연결된 소켓 위에 TLS 핸드셰이킹을 합니다. */
function upgrade(
  plain: Socket,
  options: FetchOptions,
  startedAt: number,
): Promise<CertificateResult> {
  return new Promise((resolve, reject) => {
    const secure: TLSSocket = connectTls({
      socket: plain,
      // IP 주소로는 SNI를 보낼 수 없습니다. (RFC 6066)
      ...(isIP(options.host) === 0 ? { servername: options.host } : {}),
      // 만료·자체 서명 인증서도 읽어야 하므로 검증 실패로 끊지 않고 결과만 받습니다.
      rejectUnauthorized: false,
      minVersion: 'TLSv1',
    });

    let settled = false;
    const finish = (error: Error | undefined, result?: CertificateResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      secure.destroy();
      plain.destroy();
      if (result === undefined) {
        reject(error ?? new UserError(`${options.host} did not complete the TLS handshake`));
      } else {
        resolve(result);
      }
    };
    const onAbort = () => {
      finish(options.signal.reason as Error);
    };

    const timer = setTimeout(() => {
      finish(new UserError(`${options.host}:${options.port} did not answer in time`));
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
    secure.once('error', (error: NodeJS.ErrnoException) => {
      finish(describe(error, options));
    });
    secure.once('secureConnect', () => {
      const certificate = secure.getPeerCertificate(true);
      // 인증서를 보내지 않으면 Node는 빈 객체를 줍니다. 타입에는 그 경우가 없어 키 수로 확인합니다.
      if (Object.keys(certificate).length === 0) {
        finish(new UserError(`${options.host} did not send a certificate`));
        return;
      }
      const cipher = secure.getCipher();
      const protocol = secure.getProtocol();
      const reason = secure.authorized ? undefined : trustReason(secure.authorizationError);
      finish(undefined, {
        certificate,
        trusted: secure.authorized,
        ...(reason === undefined ? {} : { trustError: reason }),
        ...(protocol === null ? {} : { protocol }),
        ...(cipher.name === '' ? {} : { cipher: cipher.name }),
        ...(secure.remoteAddress === undefined ? {} : { address: secure.remoteAddress }),
        elapsed: performance.now() - startedAt,
      });
    });
  });
}

/** 검증 실패 이유입니다. Node 버전에 따라 Error나 문자열로 오고, 통과하면 비어 있습니다. */
function trustReason(error: unknown): string | undefined {
  if (typeof error === 'string' && error !== '') {
    return error;
  }
  if (error instanceof Error) {
    return (error as NodeJS.ErrnoException).code ?? error.message;
  }
  return undefined;
}

function describe(error: NodeJS.ErrnoException, options: FetchOptions): Error {
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
    case 'ECONNRESET':
      return new UserError(
        `${where} closed the connection; it may not speak TLS on this port (try --starttls)`,
      );
    default:
      // ERR_SSL_* 는 상대가 TLS가 아닌 것을 보냈다는 뜻입니다. (평문 서비스에 붙었을 때)
      if (error.code === 'EPROTO' || error.code?.startsWith('ERR_SSL_') === true) {
        return new UserError(
          `${where} does not speak TLS on this port (${error.code}); try --starttls`,
        );
      }
      return new UserError(`${where}: ${error.code ?? error.message}`);
  }
}
