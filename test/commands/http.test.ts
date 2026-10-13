import { describe, expect, it, vi } from 'vitest';

import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createHttpCommand, type HttpServices } from '../../src/commands/http';
import type { FollowOptions, FollowResult } from '../../src/core/http/follow';
import type { HttpResponse } from '../../src/core/http/request';
import { createTestRuntime } from '../helpers/runtime';

function response(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    url: 'https://example.com/',
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'text/html',
      server: 'nginx',
      'content-encoding': 'gzip',
      // 헤더 표에만 나오는 값이라 표가 그려졌는지 확인할 때 씁니다.
      'x-request-id': 'abc123',
    },
    httpVersion: '2',
    timing: { dns: 5, tcp: 10, tls: 20, firstByte: 40, total: 50 },
    bytes: 2048,
    address: '93.184.216.34',
    ...overrides,
  };
}

function fakeServices(overrides: Partial<HttpServices> = {}): HttpServices {
  return {
    follow: (options: FollowOptions) => {
      const result: FollowResult = { responses: [response()], stopped: false };
      for (const each of result.responses) {
        options.onResponse?.(each);
      }
      return Promise.resolve(result);
    },
    ...overrides,
  };
}

function groupsWith(services: HttpServices): readonly CommandGroup[] {
  return [{ heading: 'Lookup:', commands: [(runtime) => createHttpCommand(runtime, services)] }];
}

describe('unt http', () => {
  it('is listed under Lookup in the help', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['--help'], runtime);

    expect(stdout()).toMatch(/Lookup:\n(?:.*\n)*?\s+http/);
  });

  it('shows the status, version, body and timing broken down by step', async () => {
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['http', 'example.com'], runtime, groupsWith(fakeServices()));

    expect(code).toBe(0);
    expect(stdout()).toMatch(/Status\s+200 OK/);
    expect(stdout()).toMatch(/HTTP\s+HTTP\/2/);
    expect(stdout()).toMatch(/Address\s+93\.184\.216\.34/);
    expect(stdout()).toMatch(/Body\s+2\.0 KB \(gzip\)/);
    expect(stdout()).toMatch(/DNS\s+5 ms/);
    expect(stdout()).toMatch(/TCP\s+10 ms/);
    expect(stdout()).toMatch(/TLS\s+20 ms/);
    expect(stdout()).toMatch(/First byte\s+40 ms/);
    expect(stdout()).toMatch(/Total\s+50 ms/);
  });

  it('lists the response headers unless --no-headers is given', async () => {
    const shown = createTestRuntime();
    await runCommand(['http', 'example.com'], shown.runtime, groupsWith(fakeServices()));
    // 보안 헤더 표에도 HEADER 열이 있고 x-content-type-options 같은 이름이 섞이므로,
    // 응답 헤더 표에만 있는 값으로 확인합니다.
    expect(shown.stdout()).toContain('x-request-id');
    expect(shown.stdout()).toContain('abc123');

    const hidden = createTestRuntime();
    await runCommand(
      ['http', 'example.com', '--no-headers'],
      hidden.runtime,
      groupsWith(fakeServices()),
    );
    expect(hidden.stdout()).not.toContain('abc123');
    expect(hidden.stdout()).toContain('SECURITY HEADERS');
  });

  it('points out the security headers that are missing', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['http', 'example.com'], runtime, groupsWith(fakeServices()));

    expect(stdout()).toContain('SECURITY HEADERS');
    expect(stdout()).toContain('strict-transport-security');
    expect(stdout()).toContain('6 security headers missing');
  });

  it('uses GET by default, HEAD with -I, and POST when a body is given', async () => {
    const follow = vi.fn<HttpServices['follow']>(() =>
      Promise.resolve<FollowResult>({ responses: [response()], stopped: false }),
    );
    const { runtime } = createTestRuntime();
    const groups = groupsWith(fakeServices({ follow }));

    await runCommand(['http', 'example.com'], runtime, groups);
    await runCommand(['http', 'example.com', '-I'], runtime, groups);
    await runCommand(['http', 'example.com', '-d', 'a=1'], runtime, groups);
    await runCommand(['http', 'example.com', '-X', 'put'], runtime, groups);

    expect(follow.mock.calls.map(([options]) => options.method)).toEqual([
      'GET',
      'HEAD',
      'POST',
      'PUT',
    ]);
    // 본문을 주면 길이와 형식을 함께 보냅니다.
    expect(follow.mock.calls[2]?.[0].headers['content-length']).toBe('3');
    expect(follow.mock.calls[2]?.[0].body).toBe('a=1');
  });

  it('adds the headers given with -H and lets them override the defaults', async () => {
    const follow = vi.fn<HttpServices['follow']>(() =>
      Promise.resolve<FollowResult>({ responses: [response()], stopped: false }),
    );
    const { runtime } = createTestRuntime();

    await runCommand(
      ['http', 'example.com', '-H', 'Accept: text/plain', '-H', 'X-Trace: 1'],
      runtime,
      groupsWith(fakeServices({ follow })),
    );

    const headers = follow.mock.calls[0]?.[0].headers;
    expect(headers?.accept).toBe('text/plain');
    expect(headers?.['x-trace']).toBe('1');
  });

  it('rejects a header that is not written as "Name: value"', async () => {
    const { runtime, stderr } = createTestRuntime();

    const code = await runCommand(
      ['http', 'example.com', '-H', 'nonsense'],
      runtime,
      groupsWith(fakeServices()),
    );

    expect(code).toBe(1);
    expect(stderr()).toContain('write it as "Name: value"');
  });

  it('shows every hop of a redirect chain', async () => {
    const services = fakeServices({
      follow: (options: FollowOptions) => {
        const result: FollowResult = {
          responses: [
            response({
              url: 'http://example.com/',
              status: 301,
              headers: { location: 'https://example.com/' },
              bytes: 0,
            }),
            response(),
          ],
          stopped: false,
        };
        for (const each of result.responses) {
          options.onResponse?.(each);
        }
        return Promise.resolve(result);
      },
    });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['http', 'http://example.com'], runtime, groupsWith(services));

    expect(stdout()).toContain('301 http://example.com/');
    expect(stdout()).toContain('-> https://example.com/');
    expect(stdout()).toMatch(/Redirects\s+1/);
  });

  it('does not follow redirects with --no-follow', async () => {
    const follow = vi.fn<HttpServices['follow']>(() =>
      Promise.resolve<FollowResult>({ responses: [response()], stopped: false }),
    );
    const { runtime } = createTestRuntime();

    await runCommand(
      ['http', 'example.com', '--no-follow'],
      runtime,
      groupsWith(fakeServices({ follow })),
    );

    expect(follow.mock.calls[0]?.[0].maxRedirects).toBe(0);
  });

  it('repeats the request with -c and summarizes the timing', async () => {
    let call = 0;
    const services = fakeServices({
      follow: (options: FollowOptions) => {
        call++;
        const result: FollowResult = {
          responses: [response({ timing: { tcp: 1, firstByte: 2, total: call * 10 } })],
          stopped: false,
        };
        for (const each of result.responses) {
          options.onResponse?.(each);
        }
        return Promise.resolve(result);
      },
    });
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['http', 'example.com', '-c', '3'], runtime, groupsWith(services));

    expect(call).toBe(3);
    expect(stdout()).toContain('3 requests  min/avg/max 10 ms/20 ms/30 ms');
  });

  it('exits 1 for a 4xx or 5xx answer', async () => {
    const services = fakeServices({
      follow: () =>
        Promise.resolve<FollowResult>({
          responses: [response({ status: 503, statusText: 'Service Unavailable' })],
          stopped: false,
        }),
    });
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['http', 'example.com'], runtime, groupsWith(services));

    expect(code).toBe(1);
    expect(stdout()).toMatch(/Status\s+503 Service Unavailable/);
  });

  it('exits 1 and says so when there were too many redirects', async () => {
    const services = fakeServices({
      follow: () =>
        Promise.resolve<FollowResult>({
          responses: [response({ status: 302 }), response({ status: 302 })],
          stopped: true,
        }),
    });
    const { runtime, stdout } = createTestRuntime();

    const code = await runCommand(['http', 'example.com'], runtime, groupsWith(services));

    expect(code).toBe(1);
    expect(stdout()).toContain('stopped after 1 redirects');
  });

  it('prints a JSON report', async () => {
    const { runtime, stdout } = createTestRuntime();

    await runCommand(['http', 'example.com', '--json'], runtime, groupsWith(fakeServices()));

    const report = JSON.parse(stdout()) as { security: unknown[] };
    expect(report).toMatchObject({
      url: 'https://example.com/',
      status: 200,
      httpVersion: '2',
      bytes: 2048,
      redirects: [],
      stopped: false,
      timing: { dns: 5, tcp: 10, tls: 20, firstByte: 40, total: 50 },
    });
    expect(report.security).toHaveLength(6);
    expect(report.security).toContainEqual({
      name: 'strict-transport-security',
      present: false,
      value: null,
    });
  });
});
