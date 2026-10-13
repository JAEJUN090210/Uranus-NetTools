import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { followRedirects } from '../../../src/core/http/follow';

let server: Server | undefined;

afterEach(async () => {
  const running = server;
  server = undefined;
  if (running !== undefined) {
    await new Promise<void>((resolve) => {
      running.close(() => {
        resolve();
      });
    });
  }
});

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly body: string;
}

/** 경로마다 정해진 응답을 주고, 받은 요청을 기록하는 서버를 엽니다. */
async function serve(
  routes: Record<string, { status: number; location?: string }>,
): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      seen.push({ method: request.method ?? '', url: request.url ?? '', body });
      const route = routes[request.url ?? ''] ?? { status: 404 };
      response.writeHead(
        route.status,
        route.location === undefined ? {} : { location: route.location },
      );
      response.end();
    });
  });
  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${String(port)}`, seen };
}

const base = {
  method: 'GET',
  headers: {},
  timeoutMs: 5000,
  signal: new AbortController().signal,
  maxRedirects: 10,
};

describe('followRedirects', () => {
  it('follows the chain and keeps every response', async () => {
    const { base: origin } = await serve({
      '/a': { status: 302, location: '/b' },
      '/b': { status: 301, location: '/c' },
      '/c': { status: 200 },
    });
    const seenStatuses: number[] = [];

    const result = await followRedirects({
      ...base,
      url: `${origin}/a`,
      onResponse: (response) => {
        seenStatuses.push(response.status);
      },
    });

    expect(result.stopped).toBe(false);
    expect(result.responses.map((response) => response.status)).toEqual([302, 301, 200]);
    expect(result.responses.at(-1)?.url).toBe(`${origin}/c`);
    expect(seenStatuses).toEqual([302, 301, 200]);
  });

  it('does not follow anything when maxRedirects is 0', async () => {
    const { base: origin } = await serve({ '/a': { status: 302, location: '/b' } });

    const result = await followRedirects({ ...base, url: `${origin}/a`, maxRedirects: 0 });

    expect(result.responses).toHaveLength(1);
    expect(result.stopped).toBe(false);
  });

  it('stops and says so when there are too many redirects', async () => {
    const { base: origin } = await serve({ '/loop': { status: 302, location: '/loop' } });

    const result = await followRedirects({ ...base, url: `${origin}/loop`, maxRedirects: 3 });

    expect(result.responses).toHaveLength(4);
    expect(result.stopped).toBe(true);
  });

  it('resolves a relative location against the current URL', async () => {
    const { base: origin, seen } = await serve({
      '/deep/a': { status: 302, location: '../b' },
      '/b': { status: 200 },
    });

    const result = await followRedirects({ ...base, url: `${origin}/deep/a` });

    expect(result.responses.at(-1)?.url).toBe(`${origin}/b`);
    expect(seen.map((request) => request.url)).toEqual(['/deep/a', '/b']);
  });

  it('switches a POST to GET and drops the body on 303', async () => {
    const { base: origin, seen } = await serve({
      '/post': { status: 303, location: '/done' },
      '/done': { status: 200 },
    });

    await followRedirects({ ...base, url: `${origin}/post`, method: 'POST', body: 'a=1' });

    expect(seen).toEqual([
      { method: 'POST', url: '/post', body: 'a=1' },
      { method: 'GET', url: '/done', body: '' },
    ]);
  });

  it('keeps the method on a 307', async () => {
    const { base: origin, seen } = await serve({
      '/post': { status: 307, location: '/done' },
      '/done': { status: 200 },
    });

    await followRedirects({ ...base, url: `${origin}/post`, method: 'POST', body: 'a=1' });

    expect(seen.map((request) => request.method)).toEqual(['POST', 'POST']);
  });

  it('stops at a redirect without a location header', async () => {
    const { base: origin } = await serve({ '/a': { status: 302 } });

    const result = await followRedirects({ ...base, url: `${origin}/a` });

    expect(result.responses).toHaveLength(1);
    expect(result.stopped).toBe(false);
  });
});
