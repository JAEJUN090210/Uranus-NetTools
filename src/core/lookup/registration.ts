import { UserError } from '../../cli/errors';
import { findAsnServer, findDomainServer, findIpServer, IANA_BOOTSTRAP } from './bootstrap';
import { getJson, type HttpOptions, type JsonResponse } from './http';
import { toAsnRecord, toDomainRecord, toIpRecord } from './rdap';
import type { AsnRecord, DomainRecord, IpRecord, Registration } from './records';
import { isReservedAddress } from './reserved';
import {
  formatWhoisQuery,
  IANA_WHOIS,
  isNotFound,
  parseReferral,
  parseWhoisDomain,
  queryWhois,
  type WhoisServer,
} from './whois';

export interface LookupContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  /** --verbose에서 어느 서버에 묻는지 보여줄 때 씁니다. */
  readonly onRequest?: (description: string) => void;
}

/** 도메인, IP, AS 번호의 등록 정보를 조회합니다. */
export interface RegistrationService {
  domain(name: string, context: LookupContext): Promise<Registration<DomainRecord>>;
  ip(address: string, family: 4 | 6, context: LookupContext): Promise<Registration<IpRecord>>;
  asn(asn: number, context: LookupContext): Promise<Registration<AsnRecord>>;
}

export interface RegistrationServiceOptions {
  /** RDAP 부트스트랩 파일이 있는 주소입니다. 테스트에서 로컬 서버로 바꿉니다. */
  readonly bootstrap?: string;
  readonly ianaWhois?: WhoisServer;
  /** IANA가 알려준 WHOIS 서버에 접속할 포트입니다. */
  readonly whoisPort?: number;
  readonly fetch?: typeof fetch;
}

/** www.example.co.kr → www.example.co.kr, example.co.kr, co.kr 순서로 등록된 도메인을 찾아봅니다. */
function registrableCandidates(name: string): string[] {
  const labels = name.split('.');
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'));
}

function assertOk(response: JsonResponse, url: string): void {
  if (response.status === 429) {
    throw new UserError('the RDAP server is limiting requests, try again later');
  }
  if (response.status < 200 || response.status >= 300 || response.body === undefined) {
    throw new UserError(`the RDAP server answered ${response.status} for ${url}`);
  }
}

export function createRegistrationService(
  options: RegistrationServiceOptions = {},
): RegistrationService {
  const bootstrap = options.bootstrap ?? IANA_BOOTSTRAP;
  const ianaWhois = options.ianaWhois ?? IANA_WHOIS;
  const http = (context: LookupContext): HttpOptions => ({
    signal: context.signal,
    timeoutMs: context.timeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  async function rdap(url: string, context: LookupContext): Promise<JsonResponse> {
    context.onRequest?.(`RDAP ${url}`);
    return getJson(url, http(context));
  }

  async function whois(server: WhoisServer, query: string, context: LookupContext) {
    context.onRequest?.(`WHOIS ${server.host} ${query}`);
    return queryWhois(server, query, context);
  }

  async function domainByWhois(
    name: string,
    tld: string,
    context: LookupContext,
  ): Promise<Registration<DomainRecord>> {
    const host = parseReferral(await whois(ianaWhois, tld, context));
    if (host === undefined) {
      throw new UserError(`no RDAP or WHOIS server is known for .${tld}`);
    }
    const server = {
      host,
      ...(options.whoisPort === undefined ? {} : { port: options.whoisPort }),
    };
    for (const candidate of registrableCandidates(name)) {
      const text = await whois(server, formatWhoisQuery(host, candidate), context);
      if (!isNotFound(text)) {
        return {
          source: 'whois',
          server: host,
          record: parseWhoisDomain(text, candidate),
          raw: text,
        };
      }
    }
    throw new UserError(`no registration found for ${name}`);
  }

  return {
    async domain(name, context) {
      const tld = name.split('.').at(-1) ?? name;
      const server = await findDomainServer(tld, bootstrap, http(context));
      // RDAP을 지원하지 않는 TLD는 IANA가 알려주는 WHOIS 서버로 조회합니다.
      if (server === undefined) {
        return domainByWhois(name, tld, context);
      }
      for (const candidate of registrableCandidates(name)) {
        const url = new URL(`domain/${candidate}`, server).href;
        const response = await rdap(url, context);
        if (response.status !== 404) {
          assertOk(response, url);
          return {
            source: 'rdap',
            server: response.url,
            record: toDomainRecord(response.body),
            raw: response.body,
          };
        }
      }
      throw new UserError(`no registration found for ${name}`);
    },

    async ip(address, family, context) {
      if (isReservedAddress(address, family)) {
        throw new UserError(
          `${address} is a private or reserved address with no public registration`,
        );
      }
      const server = await findIpServer(address, family, bootstrap, http(context));
      if (server === undefined) {
        throw new UserError(`no RDAP server is known for ${address}`);
      }
      const url = new URL(`ip/${address}`, server).href;
      const response = await rdap(url, context);
      assertOk(response, url);
      return {
        source: 'rdap',
        server: response.url,
        record: toIpRecord(response.body),
        raw: response.body,
      };
    },

    async asn(asn, context) {
      const server = await findAsnServer(asn, bootstrap, http(context));
      if (server === undefined) {
        throw new UserError(`no RDAP server is known for AS${asn}`);
      }
      const url = new URL(`autnum/${asn}`, server).href;
      const response = await rdap(url, context);
      if (response.status === 404) {
        throw new UserError(`AS${asn} is not registered`);
      }
      assertOk(response, url);
      return {
        source: 'rdap',
        server: response.url,
        record: toAsnRecord(response.body, asn),
        raw: response.body,
      };
    },
  };
}
