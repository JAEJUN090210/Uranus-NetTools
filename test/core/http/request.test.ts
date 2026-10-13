import { createServer as createHttpServer, type Server } from 'node:http';
import { createSecureServer, type Http2SecureServer } from 'node:http2';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { parseUrl, sendRequest } from '../../../src/core/http/request';
import { TEST_TLS_CERT, TEST_TLS_KEY } from '../../fixtures/tls';

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function track(server: Server | Http2SecureServer): void {
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
}

async function listen(server: Server | Http2SecureServer): Promise<number> {
  track(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

const signal = new AbortController().signal;
const base = { method: 'GET', headers: {}, timeoutMs: 5000, signal };

describe('parseUrl', () => {
  it('assumes https when no scheme is given', () => {
    expect(parseUrl('example.com').toString()).toBe('https://example.com/');
  });

  it('keeps the path and query', () => {
    expect(parseUrl('http://example.com/a?b=1').toString()).toBe('http://example.com/a?b=1');
  });

  it.each(['', 'ftp://example.com', 'http://'])('refuses %j', (input) => {
    expect(() => parseUrl(input)).toThrow();
  });
});

describe('sendRequest over HTTP/1.1', () => {
  it('reports the status, headers, version, size and timing', async () => {
    const port = await listen(
      createHttpServer((request, response) => {
        response.writeHead(201, { 'content-type': 'text/plain', 'x-method': request.method ?? '' });
        response.end('hello');
      }),
    );

    const response = await sendRequest({ ...base, url: `http://127.0.0.1:${String(port)}/` });

    expect(response.status).toBe(201);
    expect(response.httpVersion).toBe('1.1');
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['x-method']).toBe('GET');
    expect(response.bytes).toBe(5);
    expect(response.timing.tcp).toBeGreaterThanOrEqual(0);
    expect(response.timing.firstByte).toBeGreaterThanOrEqual(0);
    expect(response.timing.total).toBeGreaterThanOrEqual(response.timing.firstByte);
    // 평문 연결에는 TLS 단계가 없습니다.
    expect(response.timing.tls).toBeUndefined();
  });

  it('sends the method, headers and body it was given', async () => {
    let seen: { method?: string; auth?: string; body: string } | undefined;
    const port = await listen(
      createHttpServer((request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        request.on('end', () => {
          seen = {
            ...(request.method === undefined ? {} : { method: request.method }),
            ...(typeof request.headers.authorization === 'string'
              ? { auth: request.headers.authorization }
              : {}),
            body,
          };
          response.writeHead(204);
          response.end();
        });
      }),
    );

    await sendRequest({
      ...base,
      url: `http://127.0.0.1:${String(port)}/`,
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: 'a=1',
    });

    expect(seen).toEqual({ method: 'POST', auth: 'Bearer x', body: 'a=1' });
  });

  it('counts an empty body as zero bytes', async () => {
    const port = await listen(
      createHttpServer((_request, response) => {
        response.writeHead(204);
        response.end();
      }),
    );

    const response = await sendRequest({
      ...base,
      url: `http://127.0.0.1:${String(port)}/`,
      method: 'HEAD',
    });

    expect(response.bytes).toBe(0);
  });

  it('gives up when the server never answers', async () => {
    const port = await listen(createHttpServer(() => undefined));

    await expect(
      sendRequest({ ...base, url: `http://127.0.0.1:${String(port)}/`, timeoutMs: 150 }),
    ).rejects.toThrow('did not answer within 150 ms');
  });

  it('explains that a connection was refused', async () => {
    // 열렸다가 닫힌 포트는 연결을 거부합니다.
    const port = await listen(createHttpServer(() => undefined));
    await Promise.all(closers.splice(0).map((close) => close()));

    await expect(
      sendRequest({ ...base, url: `http://127.0.0.1:${String(port)}/`, timeoutMs: 5000 }),
    ).rejects.toThrow('refused the connection');
  });
});

describe('sendRequest over TLS', () => {
  it('measures the TLS handshake and refuses a certificate it cannot verify', async () => {
    const port = await listen(
      createHttpsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (_request, response) => {
        response.writeHead(200);
        response.end('ok');
      }),
    );
    const url = `https://127.0.0.1:${String(port)}/`;

    await expect(sendRequest({ ...base, url, http2: false })).rejects.toThrow('--insecure');

    const response = await sendRequest({ ...base, url, http2: false, insecure: true });
    expect(response.status).toBe(200);
    expect(response.timing.tls).toBeGreaterThanOrEqual(0);
  });

  it('uses HTTP/2 when the server negotiates it over ALPN', async () => {
    const server = createSecureServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT });
    server.on('stream', (stream) => {
      stream.respond({ ':status': 200, 'content-type': 'text/plain' });
      stream.end('h2');
    });
    const port = await listen(server);

    const response = await sendRequest({
      ...base,
      url: `https://127.0.0.1:${String(port)}/`,
      insecure: true,
    });

    expect(response.httpVersion).toBe('2');
    expect(response.status).toBe(200);
    expect(response.bytes).toBe(2);
    // 의사 헤더(:status)는 헤더 목록에서 빠집니다.
    expect(Object.keys(response.headers)).not.toContain(':status');
    expect(response.headers['content-type']).toBe('text/plain');
  });
});
