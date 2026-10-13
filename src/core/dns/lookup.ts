import { UserError } from '../../cli/errors';
import { getJson, type HttpOptions } from '../lookup/http';
import { looksUnusable, query, type QuerySettings, systemServers } from './client';
import { rcodeName, recordType, type ResourceRecord, typeName } from './wire';

/** 타입을 지정하지 않았을 때 함께 조회하는 레코드입니다. */
export const DEFAULT_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA'] as const;

/** --compare로 비교하는, API 키가 필요 없는 공개 DNS 서버입니다. */
export const PUBLIC_RESOLVERS: readonly { readonly name: string; readonly address: string }[] = [
  { name: 'Cloudflare', address: '1.1.1.1' },
  { name: 'Google', address: '8.8.8.8' },
  { name: 'Quad9', address: '9.9.9.9' },
];

export interface TypeResult {
  readonly type: string;
  readonly records: readonly ResourceRecord[];
  /** NOERROR가 아니면 그 이름입니다. (예: NXDOMAIN) */
  readonly status?: string;
  readonly elapsed?: number;
  readonly transport?: 'udp' | 'tcp' | 'https';
  /** 조회 자체가 실패한 이유입니다. */
  readonly error?: string;
}

export interface LookupReport {
  readonly name: string;
  /** 실제로 물어본 곳입니다. (서버 주소 또는 "https://dns.google") */
  readonly server: string;
  readonly transport: 'udp' | 'tcp' | 'https';
  readonly results: readonly TypeResult[];
}

export interface Resolution {
  readonly server: string;
  readonly settings: QuerySettings;
  /** 시스템 DNS에 닿지 못할 때 쓸 DNS-over-HTTPS 설정입니다. */
  readonly doh?: { readonly http: HttpOptions; readonly url: string; readonly name: string };
}

/** 시스템 DNS가 쓸 만한지 보고, 아니면 왜 DoH로 넘어가는지 알려 줍니다. */
export function chooseServer(
  requested: string | undefined,
  onFallback?: (message: string) => void,
): { readonly server?: string; readonly servers: readonly string[] } {
  if (requested !== undefined) {
    return { server: requested, servers: [requested] };
  }
  const servers = systemServers();
  if (looksUnusable(servers)) {
    onFallback?.(
      'the system DNS servers cannot be used directly, asking over DNS-over-HTTPS instead',
    );
    return { servers };
  }
  const [first] = servers;
  return first === undefined ? { servers } : { server: first, servers };
}

/** 한 서버에 여러 타입을 한 번에(동시에) 물어봅니다. */
export async function lookupTypes(
  name: string,
  types: readonly string[],
  resolution: Resolution,
): Promise<LookupReport> {
  const results = await Promise.all(types.map((type) => lookupOne(name, type, resolution)));
  return {
    name,
    server: resolution.doh?.name ?? resolution.server,
    // 하나라도 TCP로 다시 물었으면 TCP로 표시합니다.
    transport: results.some((result) => result.transport === 'tcp')
      ? 'tcp'
      : (results.find((result) => result.transport !== undefined)?.transport ?? 'udp'),
    results,
  };
}

async function lookupOne(name: string, type: string, resolution: Resolution): Promise<TypeResult> {
  try {
    if (resolution.doh !== undefined) {
      return await lookupOverHttps(name, type, resolution.doh);
    }
    const wanted = recordType(type);
    const { message, elapsed, transport } = await query(
      resolution.server,
      name,
      wanted,
      resolution.settings,
    );
    // 물어본 타입만 보여주고, 그게 없으면 CNAME 같은 중간 응답을 그대로 보여 줍니다.
    const matching = message.answers.filter((record) => record.type === wanted);
    return {
      type,
      records: matching.length > 0 ? matching : message.answers,
      ...(message.rcode === 0 ? {} : { status: rcodeName(message.rcode) }),
      elapsed,
      transport,
    };
  } catch (error) {
    if (resolution.settings.signal.aborted) {
      throw error;
    }
    return { type, records: [], error: error instanceof Error ? error.message : String(error) };
  }
}

interface DohAnswer {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly TTL?: unknown;
  readonly data?: unknown;
}

/** UDP 53이 막힌 네트워크를 위해 JSON 형식의 DNS-over-HTTPS로 묻습니다. TTL도 함께 옵니다. */
async function lookupOverHttps(
  name: string,
  type: string,
  doh: NonNullable<Resolution['doh']>,
): Promise<TypeResult> {
  const url = `${doh.url}?name=${encodeURIComponent(name)}&type=${type}`;
  const startedAt = performance.now();
  const response = await getJson(url, doh.http);
  const elapsed = performance.now() - startedAt;
  const body = (typeof response.body === 'object' ? response.body : null) as {
    Status?: unknown;
    Answer?: unknown;
  } | null;
  if (response.status !== 200 || typeof body?.Status !== 'number') {
    throw new UserError(`${doh.name} answered HTTP ${response.status}`);
  }
  if (body.Status !== 0) {
    return { type, records: [], status: rcodeName(body.Status), elapsed, transport: 'https' };
  }
  const wanted = recordType(type);
  const answers = Array.isArray(body.Answer) ? (body.Answer as DohAnswer[]) : [];
  const records = answers.flatMap((answer): ResourceRecord[] => {
    if (answer.type !== wanted || typeof answer.data !== 'string') {
      return [];
    }
    return [
      {
        name: typeof answer.name === 'string' ? answer.name.replace(/\.$/, '') : name,
        type: wanted,
        typeName: typeName(wanted),
        ttl: typeof answer.TTL === 'number' ? answer.TTL : 0,
        data: cleanDohData(answer.data),
      },
    ];
  });
  return { type, records, elapsed, transport: 'https' };
}

/** DoH는 이름 끝에 점을 붙이고 TXT를 따옴표로 감싸서 보냅니다. */
function cleanDohData(data: string): string {
  if (data.startsWith('"')) {
    return [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map(([, chunk = '']) => chunk.replace(/\\(.)/g, '$1'))
      .join('');
  }
  // 이름이 여러 개 섞인 레코드(MX, SOA)도 있으므로 조각마다 끝점을 뗍니다. 루트(".")는 그대로 둡니다.
  return data
    .split(/\s+/)
    .map((part) => (part === '.' ? part : part.replace(/\.$/, '')))
    .join(' ');
}
