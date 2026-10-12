import { Socket } from 'node:net';

import { UserError } from '../../cli/errors';
import type { DomainRecord } from './records';

export interface WhoisServer {
  readonly host: string;
  readonly port?: number;
}

export const IANA_WHOIS: WhoisServer = { host: 'whois.iana.org' };

export interface WhoisQueryOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** 대부분 UTF-8로 응답하지만 한국(.kr) 등 일부 WHOIS 서버는 EUC-KR 같은 지역 인코딩을 씁니다. */
export function decodeWhois(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    // UTF-8이 아니면 다음 인코딩을 시도합니다.
  }
  try {
    return new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

/** WHOIS 서버(43번 포트)에 질의하고 응답 전체를 텍스트로 돌려줍니다. */
export function queryWhois(
  server: WhoisServer,
  query: string,
  options: WhoisQueryOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const { signal, timeoutMs } = options;
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const socket = new Socket();
    const chunks: Buffer[] = [];

    function finish(): void {
      signal.removeEventListener('abort', onAbort);
      socket.destroy();
    }
    function fail(error: Error): void {
      finish();
      reject(error);
    }
    function onAbort(): void {
      fail(signal.reason as Error);
    }

    signal.addEventListener('abort', onAbort, { once: true });
    socket.setTimeout(timeoutMs, () => {
      fail(new UserError(`the WHOIS server ${server.host} did not answer within ${timeoutMs} ms`));
    });
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.once('end', () => {
      finish();
      resolve(decodeWhois(Buffer.concat(chunks)));
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      fail(
        new UserError(
          `cannot reach the WHOIS server ${server.host} (${error.code ?? error.message})`,
        ),
      );
    });
    socket.connect({ host: server.host, port: server.port ?? 43 }, () => {
      socket.write(`${query}\r\n`);
    });
  });
}

/** IANA WHOIS의 TLD 정보에서 그 TLD를 담당하는 WHOIS 서버 이름을 꺼냅니다. */
export function parseReferral(text: string): string | undefined {
  return /^\s*(?:whois|refer):\s*(\S+)/im.exec(text)?.[1];
}

const NOT_FOUND =
  /no match|not found|no data found|no entries found|no object found|status:\s*(?:free|available)|is available for registration/i;

export function isNotFound(text: string): boolean {
  return NOT_FOUND.test(text);
}

/** "Label: value"(대부분), "Label   : value"(.kr), "[Label]   value"(.jp) 형식의 줄을 모두 읽습니다. */
function fields(text: string, labels: string): string[] {
  const pattern = new RegExp(
    String.raw`^[ \t]*(?:\[(?:${labels})\]|(?:${labels})[ \t]*:)[ \t]*(.*?)[ \t]*$`,
    'gim',
  );
  return [...text.matchAll(pattern)].flatMap(([, value]) =>
    value === undefined || value === '' ? [] : [value],
  );
}

function field(text: string, labels: string): string | undefined {
  return fields(text, labels)[0];
}

/**
 * "1997. 09. 12."(.kr), "2001/02/02"(.jp), "2024-01-02" 같은 날짜는 YYYY-MM-DD로,
 * 시각까지 있는 ISO 날짜는 ISO 형식으로 맞춥니다.
 */
export function normalizeDate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = /^(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})\.?(?:\s.*)?$/.exec(value);
  if (date) {
    const [, year = '', month = '', day = ''] = date;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

/** .kr은 한글 항목("미서명")이 영어 항목("unsigned")보다 먼저 나오므로 알아볼 수 있는 첫 값을 씁니다. */
function parseDnssec(values: readonly string[]): boolean | undefined {
  for (const value of values) {
    if (/^(?:unsigned|no\b|미서명)/i.test(value)) {
      return false;
    }
    if (/^(?:signed|yes\b|서명)/i.test(value)) {
      return true;
    }
  }
  return undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * WHOIS 텍스트에서 도메인 정보를 뽑습니다. 등록소마다 형식이 다르므로 흔한 항목 이름을 모두 시도합니다.
 * .kr은 한글 항목 다음에 영어 항목이 오므로 영어 항목 이름으로 읽힙니다.
 */
export function parseWhoisDomain(text: string, query: string): DomainRecord {
  return {
    domain: (field(text, 'domain name|domain') ?? query).toLowerCase(),
    registrar: field(text, 'registrar|sponsoring registrar|registrar name|authorized agency'),
    registrant: field(text, 'registrant organization|registrant name|registrant'),
    created: normalizeDate(
      field(
        text,
        'creation date|created on|created|registered date|registered on|registration date',
      ),
    ),
    updated: normalizeDate(
      field(
        text,
        'updated date|last updated date|last updated on|last updated|last modified|changed',
      ),
    ),
    expires: normalizeDate(
      field(
        text,
        'registry expiry date|registrar registration expiration date|expiration date|expiry date|expires on|expires|paid-till',
      ),
    ),
    status: unique(
      fields(text, 'domain status|status').map((status) =>
        status.replace(/\s+\(?https?:\/\/\S+\)?$/, ''),
      ),
    ),
    nameservers: unique(
      fields(text, 'name server|nameserver|nserver|host name').map((server) =>
        (server.split(/\s+/)[0] ?? server).toLowerCase().replace(/\.$/, ''),
      ),
    ),
    // DNSSEC 항목이 없는 등록소(.de, .jp)는 서명 키가 있으면 서명된 것으로 봅니다.
    dnssec:
      parseDnssec(fields(text, 'dnssec')) ??
      (fields(text, 'dnskey|signing key|ds record').length > 0 ? true : undefined),
  };
}

/** 일부 WHOIS 서버는 질의 형식을 바꿔야 영어 응답(.jp)이나 자세한 응답(.de)을 줍니다. */
export function formatWhoisQuery(server: string, domain: string): string {
  switch (server.toLowerCase()) {
    case 'whois.jprs.jp':
      return `${domain}/e`;
    case 'whois.denic.de':
      return `-T dn ${domain}`;
    default:
      return domain;
  }
}
