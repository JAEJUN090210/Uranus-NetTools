import { request as httpRequest } from 'node:http';
import { connect as connectHttp2, constants as http2 } from 'node:http2';
import { request as httpsRequest } from 'node:https';

import { UserError } from '../../cli/errors';
import { type ConnectTiming, openConnection } from './connect';

export interface RequestTiming extends ConnectTiming {
  /** 요청을 보낸 뒤 첫 응답 바이트까지 걸린 시간(ms)입니다. */
  readonly firstByte: number;
  readonly total: number;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly statusText?: string;
  /** 소문자 이름으로 모은 응답 헤더입니다. 같은 이름이 여러 번 오면 쉼표로 잇습니다. */
  readonly headers: Readonly<Record<string, string>>;
  readonly httpVersion: string;
  readonly timing: RequestTiming;
  /** 받은 본문의 바이트 수입니다. 압축돼 있으면 압축된 크기입니다. */
  readonly bytes: number;
  readonly address?: string;
}

export interface RequestOptions {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly insecure?: boolean;
  /** HTTP/2를 쓸 수 있으면 쓸지 여부입니다. */
  readonly http2?: boolean;
}

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 } as const;

export function parseUrl(input: string): URL {
  const text = /^[a-z][a-z\d+\-.]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UserError(`${input} is not a URL I can use`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UserError(`${url.protocol} is not supported; use http or https`);
  }
  return url;
}

/** 한 번 요청을 보내고 응답의 상태·헤더·시간을 돌려줍니다. 본문은 크기만 세고 버립니다. */
export async function sendRequest(options: RequestOptions): Promise<HttpResponse> {
  const url = parseUrl(options.url);
  const secure = url.protocol === 'https:';
  const port = url.port === '' ? DEFAULT_PORTS[secure ? 'https:' : 'http:'] : Number(url.port);
  const wantsHttp2 = secure && options.http2 !== false;

  const connection = await openConnection({
    host: url.hostname,
    port,
    tls: secure,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    ...(options.insecure === undefined ? {} : { insecure: options.insecure }),
    ...(wantsHttp2 ? { alpn: ['h2', 'http/1.1'] } : {}),
  });

  const startedAt = performance.now();
  const common = { url, port, connection, startedAt, options };
  return connection.protocol === 'h2' ? sendOverHttp2(common) : sendOverHttp1(common);
}

interface Attempt {
  readonly url: URL;
  readonly port: number;
  readonly connection: Awaited<ReturnType<typeof openConnection>>;
  readonly startedAt: number;
  readonly options: RequestOptions;
}

function sendOverHttp1(attempt: Attempt): Promise<HttpResponse> {
  const { url, port, connection, startedAt, options } = attempt;
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send({
      method: options.method,
      host: url.hostname,
      port,
      path: `${url.pathname}${url.search}`,
      headers: options.headers,
      // 이미 시간을 재며 맺어 둔 소켓을 그대로 씁니다.
      createConnection: () => connection.socket,
      signal: options.signal,
    });

    let bytes = 0;
    const fail = (error: Error) => {
      request.destroy();
      connection.socket.destroy();
      reject(error);
    };

    request.setTimeout(options.timeoutMs, () => {
      fail(new UserError(`${url.host} did not answer within ${options.timeoutMs} ms`));
    });
    request.on('error', (error: NodeJS.ErrnoException) => {
      fail(error.name === 'AbortError' ? error : new UserError(`${url.host}: ${error.message}`));
    });
    request.on('response', (response) => {
      const firstByte = performance.now() - startedAt;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      response.on('end', () => {
        connection.socket.destroy();
        resolve({
          url: url.toString(),
          status: response.statusCode ?? 0,
          ...(response.statusMessage === undefined || response.statusMessage === ''
            ? {}
            : { statusText: response.statusMessage }),
          headers: flatten(response.headers),
          httpVersion: response.httpVersion,
          timing: {
            ...connection.timing,
            firstByte,
            total: performance.now() - startedAt,
          },
          bytes,
          ...(connection.address === undefined ? {} : { address: connection.address }),
        });
      });
      response.on('error', fail);
    });

    if (options.body !== undefined) {
      request.write(options.body);
    }
    request.end();
  });
}

function sendOverHttp2(attempt: Attempt): Promise<HttpResponse> {
  const { url, connection, startedAt, options } = attempt;
  return new Promise((resolve, reject) => {
    const session = connectHttp2(url.origin, {
      // 협상까지 끝난 소켓을 넘겨 다시 연결하지 않게 합니다.
      createConnection: () => connection.socket,
    });

    let bytes = 0;
    const fail = (error: Error) => {
      session.destroy();
      connection.socket.destroy();
      reject(error);
    };
    session.on('error', (error: NodeJS.ErrnoException) => {
      fail(error.name === 'AbortError' ? error : new UserError(`${url.host}: ${error.message}`));
    });

    const stream = session.request({
      [http2.HTTP2_HEADER_METHOD]: options.method,
      [http2.HTTP2_HEADER_PATH]: `${url.pathname}${url.search}`,
      ...options.headers,
    });
    stream.setTimeout(options.timeoutMs, () => {
      fail(new UserError(`${url.host} did not answer within ${options.timeoutMs} ms`));
    });
    const onAbort = () => {
      fail(options.signal.reason as Error);
    };
    options.signal.addEventListener('abort', onAbort, { once: true });

    stream.on('response', (headers) => {
      const firstByte = performance.now() - startedAt;
      const status = Number(headers[http2.HTTP2_HEADER_STATUS] ?? 0);
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
      });
      stream.on('end', () => {
        options.signal.removeEventListener('abort', onAbort);
        session.close();
        connection.socket.destroy();
        resolve({
          url: url.toString(),
          status,
          headers: flatten(headers),
          httpVersion: '2',
          timing: { ...connection.timing, firstByte, total: performance.now() - startedAt },
          bytes,
          ...(connection.address === undefined ? {} : { address: connection.address }),
        });
      });
    });
    stream.on('error', fail);

    if (options.body !== undefined) {
      stream.write(options.body);
    }
    stream.end();
  });
}

/** 헤더 값을 문자열로 통일합니다. HTTP/2의 의사 헤더(:status 등)는 따로 쓰므로 뺍니다. */
function flatten(
  headers: Readonly<Record<string, string | string[] | number | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name.startsWith(':')) {
      continue;
    }
    result[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return result;
}
