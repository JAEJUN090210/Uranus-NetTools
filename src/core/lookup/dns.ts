import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

import { UserError } from '../../cli/errors';
import { getJson, type HttpOptions } from './http';
import { ptrQueryName } from './reverse-name';

export interface DnsTools {
  readonly resolveTxt: (name: string) => Promise<string[][]>;
  /** PTR 레코드가 없으면 빈 배열입니다. local은 사설 주소처럼 내부망 이름만 있을 수 있는 주소인지 여부입니다. */
  readonly reverse: (address: string, local: boolean) => Promise<string[]>;
}

export interface DohServer {
  readonly name: string;
  readonly url: (name: string, type: 'TXT' | 'PTR') => string;
  /** JSON 응답을 받는 데 필요한 Accept 헤더입니다. */
  readonly accept?: string;
}

/**
 * 시스템 DNS 서버에 닿지 못할 때 HTTPS로 대신 물어볼 서버입니다.
 * 공개 DNS로 가는 UDP 53을 막는 네트워크가 있어도 HTTPS(443)는 거의 열려 있습니다.
 */
export const DOH_SERVERS: readonly DohServer[] = [
  {
    name: 'dns.google',
    url: (name, type) => `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  },
  {
    name: 'cloudflare-dns.com',
    url: (name, type) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
    accept: 'application/dns-json',
  },
];

export interface DnsToolOptions {
  /** 시스템 DNS 서버 대신 쓸 서버입니다. 테스트에서 닿지 않는 서버를 넣어 대체 경로를 확인합니다. */
  readonly systemServers?: string[];
  readonly doh?: readonly DohServer[];
  readonly fetch?: typeof fetch;
}

/** 시스템 DNS 서버에 닿는지 확인할 때 묻는 이름입니다. 어차피 ASN 조회에 쓰는 서버입니다. */
const PROBE_NAME = 'AS15169.asn.cymru.com';
/** 제대로 동작하는 DNS 서버는 보통 0.1초 안에 답하므로 짧게 기다립니다. */
const PROBE_TIMEOUT_MS = 1000;
const RECORD_TYPES = { TXT: 16, PTR: 12 } as const;
/** DoH 응답의 Status 3은 NXDOMAIN(이름 없음)입니다. */
const NXDOMAIN = 3;

const MISSING_CODES = new Set(['ENOTFOUND', 'ENODATA']);
// VPN 등이 설치된 Windows에서는 Node가 시스템 DNS 서버를 찾지 못하고 127.0.0.1에 묻다가 이렇게 실패합니다.
const UNREACHABLE_CODES = new Set(['ECONNREFUSED', 'ETIMEOUT', 'EREFUSED']);

function hasCode(error: unknown, codes: ReadonlySet<string>): boolean {
  return error instanceof Error && codes.has((error as NodeJS.ErrnoException).code ?? '');
}

/** 이름이나 레코드가 없다는 응답인지 확인합니다. 시간 초과 같은 실패와 구분할 때 씁니다. */
export function isMissingRecord(error: unknown): boolean {
  return hasCode(error, MISSING_CODES);
}

/** DoH 응답의 TXT 값은 따옴표로 감싼 조각들입니다. 예: "\"15169 | 8.8.8.0/24\"" → ["15169 | 8.8.8.0/24"] */
export function parseTxtData(data: string): string[] {
  const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, chunk = '']) =>
    chunk.replace(/\\(.)/g, '$1'),
  );
  return chunks.length === 0 ? [data] : chunks;
}

/** JSON 형식의 DNS-over-HTTPS로 묻습니다. 서버를 순서대로 시도하고, 모두 실패하면 이유를 모아 알립니다. */
async function queryDoh(
  name: string,
  type: 'TXT' | 'PTR',
  servers: readonly DohServer[],
  http: HttpOptions,
): Promise<string[]> {
  const failures: string[] = [];
  for (const server of servers) {
    try {
      const response = await getJson(server.url(name, type), {
        ...http,
        ...(server.accept === undefined ? {} : { accept: server.accept }),
      });
      const body = (typeof response.body === 'object' ? response.body : null) as {
        Status?: unknown;
        Answer?: unknown;
      } | null;
      if (response.status !== 200 || typeof body?.Status !== 'number') {
        failures.push(`${server.name}: HTTP ${response.status}`);
        continue;
      }
      if (body.Status === NXDOMAIN) {
        return [];
      }
      if (body.Status !== 0) {
        failures.push(`${server.name}: DNS status ${body.Status}`);
        continue;
      }
      const answers = Array.isArray(body.Answer) ? (body.Answer as unknown[]) : [];
      return answers.flatMap((answer) => {
        const { type: answerType, data } = (answer ?? {}) as { type?: unknown; data?: unknown };
        return answerType === RECORD_TYPES[type] && typeof data === 'string' ? [data] : [];
      });
    } catch (error) {
      if (http.signal.aborted) {
        throw error;
      }
      failures.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new UserError(`DNS-over-HTTPS failed (${failures.join('; ')})`);
}

/**
 * 질의마다 시간 제한이 있고, 취소되면 진행 중인 질의를 멈추는 DNS 조회 도구를 만듭니다.
 * 처음 쓸 때 시스템 DNS 서버에 닿는지 한 번 확인하고, 닿지 않으면 DNS-over-HTTPS로 묻습니다.
 * OS 해석기(getnameinfo)는 응답이 없으면 프로세스 종료까지 붙잡아서 쓰지 않습니다.
 */
export function createDnsTools(
  timeoutMs: number,
  signal: AbortSignal,
  onFallback?: (message: string) => void,
  options: DnsToolOptions = {},
): DnsTools {
  const resolvers: Resolver[] = [];
  const createResolver = (resolverOptions: { timeout: number; tries: number }) => {
    const resolver = new Resolver(resolverOptions);
    if (options.systemServers !== undefined) {
      resolver.setServers(options.systemServers);
    }
    resolvers.push(resolver);
    return resolver;
  };
  signal.addEventListener(
    'abort',
    () => {
      for (const resolver of resolvers) {
        resolver.cancel();
      }
    },
    { once: true },
  );

  const system = createResolver({ timeout: timeoutMs, tries: 2 });
  const doh = options.doh ?? DOH_SERVERS;
  const http: HttpOptions = {
    signal,
    timeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };

  let reachable: Promise<boolean> | undefined;
  const systemReachable = () => {
    reachable ??= createResolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 })
      .resolveTxt(PROBE_NAME)
      .then(
        () => true,
        (error: unknown) => !hasCode(error, UNREACHABLE_CODES),
      )
      .then((ok) => {
        if (!ok) {
          const names = doh.map((server) => server.name).join(', ');
          onFallback?.(`system DNS servers are unreachable, using DNS-over-HTTPS (${names})`);
        }
        return ok;
      });
    return reachable;
  };

  return {
    resolveTxt: async (name) => {
      if (await systemReachable()) {
        return system.resolveTxt(name);
      }
      return (await queryDoh(name, 'TXT', doh, http)).map(parseTxtData);
    },
    reverse: async (address, local) => {
      if (await systemReachable()) {
        try {
          return await system.reverse(address);
        } catch (error) {
          if (isMissingRecord(error)) {
            return [];
          }
          throw error;
        }
      }
      // 공개 DNS는 내부망 이름을 모르므로 사설 주소는 묻지 않습니다.
      if (local) {
        return [];
      }
      const family = isIP(address) === 6 ? 6 : 4;
      const names = await queryDoh(ptrQueryName(address, family), 'PTR', doh, http);
      return names.map((name) => name.replace(/\.$/, ''));
    },
  };
}
