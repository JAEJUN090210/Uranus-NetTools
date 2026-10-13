import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { followRedirects, type FollowResult } from '../core/http/follow';
import type { HttpResponse } from '../core/http/request';
import { parseUrl } from '../core/http/request';
import { checkSecurityHeaders, type SecurityHeader } from '../core/http/security';
import type { Probe } from '../core/ping/pinger';
import { summarize } from '../core/ping/stats';
import { Output } from '../ui/output';
import type { Field } from '../ui/fields';
import type { Column } from '../ui/table';

const DEFAULT_MAX_REDIRECTS = 10;
const USER_AGENT_HEADER = 'user-agent';

interface HttpOptions {
  readonly method?: string;
  readonly head?: boolean;
  readonly header?: readonly string[];
  readonly data?: string;
  readonly follow: boolean;
  readonly maxRedirects: number;
  readonly count: number;
  readonly timeout: number;
  readonly insecure?: boolean;
  readonly http2: boolean;
  readonly headers?: boolean;
}

/** 테스트에서 실제 요청 대신 가짜를 넣을 수 있도록 모아 둡니다. */
export interface HttpServices {
  readonly follow: typeof followRedirects;
}

const defaultServices: HttpServices = { follow: followRedirects };

export function createHttpCommand(
  runtime: Runtime,
  services: HttpServices = defaultServices,
): Command {
  return new Command('http')
    .description('check an HTTP response: status, headers, timing and redirects')
    .argument('<url>', 'URL to request (https:// is assumed when no scheme is given)')
    .option('-X, --method <method>', 'HTTP method to use (default: GET)')
    .addOption(new Option('-I, --head', 'send HEAD instead of GET').conflicts('method'))
    .option('-H, --header <header...>', 'extra request header, such as "Accept: text/html"')
    .option('-d, --data <body>', 'request body, implies POST unless --method is given')
    .option('--no-follow', 'do not follow redirects')
    .addOption(
      new Option('--max-redirects <n>', 'how many redirects to follow')
        .argParser(parsePositiveInteger)
        .default(DEFAULT_MAX_REDIRECTS),
    )
    .addOption(
      new Option('-c, --count <n>', 'request this many times and summarize the timing')
        .argParser(parsePositiveInteger)
        .default(1),
    )
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for the server')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .option('-k, --insecure', 'carry on even if the certificate cannot be verified')
    .option('--no-http2', 'do not offer HTTP/2')
    .option('--no-headers', 'do not list the response headers')
    .action(async (input: string, options: HttpOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const url = parseUrl(input);
      const method = chooseMethod(options);
      const headers = buildHeaders(url, options);

      const request = {
        url: url.toString(),
        method,
        headers,
        ...(options.data === undefined ? {} : { body: options.data }),
        timeoutMs: options.timeout,
        signal: runtime.signal,
        ...(options.insecure === undefined ? {} : { insecure: options.insecure }),
        http2: options.http2,
        maxRedirects: options.follow ? options.maxRedirects : 0,
      };

      output.hint(`${method} ${url.toString()}`);
      const first = await services.follow({
        ...request,
        onResponse: (response) => {
          if (!output.json && options.count === 1) {
            output.line(describeHop(response, output));
          }
        },
      });
      const final = first.responses.at(-1);
      if (final === undefined) {
        throw new UserError('the server sent no response');
      }

      // -c로 반복할 때는 첫 요청까지 포함해 응답 시간을 모읍니다.
      const times = [final.timing.total];
      for (let seq = 1; seq < options.count && !runtime.signal.aborted; seq++) {
        const repeat = await services.follow(request);
        const last = repeat.responses.at(-1);
        if (last !== undefined) {
          times.push(last.timing.total);
        }
      }

      const security = checkSecurityHeaders(final.headers);
      const stats = summarize(times.map((time, index): Probe => ({ seq: index + 1, time })));

      output.result(toJson(first, final, security, times), () => {
        output.line('');
        output.fields(summaryFields(final, first, output));
        if (options.headers !== false) {
          output.line('');
          output.table(headerRows(final.headers), headerColumns(output));
        }
        output.line('');
        output.line(output.colors.bold('TIMING'));
        output.fields(timingFields(final));
        if (options.count > 1 && stats.avg !== undefined) {
          output.line(
            `  ${options.count} requests  min/avg/max ${format(stats.min)}/${format(stats.avg)}/${format(stats.max)}`,
          );
        }
        output.line('');
        output.line(output.colors.bold('SECURITY HEADERS'));
        output.table(security, securityColumns(output));
        printSummary(output, final, first);
      });
      runtime.exitCode = final.status >= 400 || first.stopped ? 1 : 0;
    });
}

function chooseMethod(options: HttpOptions): string {
  if (options.method !== undefined) {
    return options.method.toUpperCase();
  }
  if (options.head === true) {
    return 'HEAD';
  }
  return options.data === undefined ? 'GET' : 'POST';
}

/** 사용자가 준 헤더를 더합니다. 같은 이름을 주면 기본값을 덮어씁니다. */
function buildHeaders(url: URL, options: HttpOptions): Record<string, string> {
  const headers: Record<string, string> = {
    // 압축을 쓰는지 보려면 받을 수 있다고 알려야 합니다.
    'accept-encoding': 'gzip, br',
    accept: '*/*',
    [USER_AGENT_HEADER]: 'uranus-nettools',
    host: url.host,
  };
  if (options.data !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['content-length'] = String(Buffer.byteLength(options.data));
  }
  for (const entry of options.header ?? []) {
    const colon = entry.indexOf(':');
    if (colon <= 0) {
      throw new UserError(`${entry} is not a header; write it as "Name: value"`);
    }
    headers[entry.slice(0, colon).trim().toLowerCase()] = entry.slice(colon + 1).trim();
  }
  return headers;
}

function statusColor(output: Output, status: number): string {
  const text = String(status);
  if (status >= 500) {
    return output.colors.red(text);
  }
  if (status >= 400) {
    return output.colors.yellow(text);
  }
  if (status >= 300) {
    return output.colors.cyan(text);
  }
  return output.colors.green(text);
}

/** 리다이렉션을 거칠 때마다 한 줄씩 보여 줍니다. */
function describeHop(response: HttpResponse, output: Output): string {
  const where = response.headers.location;
  const arrow = where === undefined ? '' : output.colors.dim(`  -> ${where}`);
  return `  ${statusColor(output, response.status)} ${response.url}${arrow}`;
}

function summaryFields(final: HttpResponse, result: FollowResult, output: Output): Field[] {
  const fields: Field[] = [
    ['Status', `${statusColor(output, final.status)} ${final.statusText ?? ''}`.trimEnd()],
    ['URL', final.url],
    ['HTTP', `HTTP/${final.httpVersion}`],
    ['Address', final.address],
    ['Type', final.headers['content-type']],
    ['Body', describeBody(final)],
    ['Server', final.headers.server],
    ['Redirects', result.responses.length > 1 ? String(result.responses.length - 1) : undefined],
  ];
  return fields;
}

function describeBody(response: HttpResponse): string {
  const size = formatBytes(response.bytes);
  // HEAD 응답이나 204처럼 본문이 없으면 압축 여부를 말해도 뜻이 없습니다.
  if (response.bytes === 0) {
    return size;
  }
  const encoding = response.headers['content-encoding'];
  return encoding === undefined ? `${size} (not compressed)` : `${size} (${encoding})`;
}

function timingFields(final: HttpResponse): Field[] {
  const { timing } = final;
  return [
    ['DNS', timing.dns === undefined ? undefined : format(timing.dns)],
    ['TCP', format(timing.tcp)],
    ['TLS', timing.tls === undefined ? undefined : format(timing.tls)],
    ['First byte', format(timing.firstByte)],
    ['Total', format(timing.total)],
  ];
}

function printSummary(output: Output, final: HttpResponse, result: FollowResult): void {
  if (result.stopped) {
    output.summary(`stopped after ${result.responses.length - 1} redirects`);
    return;
  }
  const missing = checkSecurityHeaders(final.headers).filter(
    (header) => header.value === undefined,
  ).length;
  const parts = [`${final.status} in ${format(final.timing.total)}`];
  if (missing > 0) {
    parts.push(`${missing} security headers missing`);
  }
  output.summary(parts.join(', '));
}

function toJson(
  result: FollowResult,
  final: HttpResponse,
  security: readonly SecurityHeader[],
  times: readonly number[],
) {
  const round = (value: number | undefined) => (value === undefined ? null : Math.round(value));
  return {
    url: final.url,
    status: final.status,
    httpVersion: final.httpVersion,
    address: final.address ?? null,
    bytes: final.bytes,
    headers: final.headers,
    redirects: result.responses.slice(0, -1).map((response) => ({
      url: response.url,
      status: response.status,
      location: response.headers.location ?? null,
    })),
    stopped: result.stopped,
    timing: {
      dns: round(final.timing.dns),
      tcp: round(final.timing.tcp),
      tls: round(final.timing.tls),
      firstByte: round(final.timing.firstByte),
      total: round(final.timing.total),
    },
    ...(times.length > 1 ? { totals: times.map((time) => Math.round(time)) } : {}),
    security: security.map((header) => ({
      name: header.name,
      present: header.value !== undefined,
      value: header.value ?? null,
    })),
  };
}

function format(ms: number | undefined): string {
  return ms === undefined ? '-' : `${Math.round(ms)} ms`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface HeaderRow {
  readonly name: string;
  readonly value: string;
}

function headerRows(headers: Readonly<Record<string, string>>): HeaderRow[] {
  return Object.entries(headers)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function headerColumns(output: Output): Column<HeaderRow>[] {
  return [
    { header: 'HEADER', value: (row) => output.colors.cyan(row.name) },
    { header: 'VALUE', value: (row) => row.value },
  ];
}

function securityColumns(output: Output): Column<SecurityHeader>[] {
  return [
    {
      header: '',
      value: (header) =>
        header.value === undefined
          ? output.colors.yellow(output.symbols.warning)
          : output.colors.green(output.symbols.success),
    },
    { header: 'HEADER', value: (header) => header.name },
    { header: 'VALUE', value: (header) => header.value ?? output.colors.dim(header.purpose) },
  ];
}
