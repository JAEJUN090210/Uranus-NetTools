import { BlockList } from 'node:net';

import { UserError } from '../../cli/errors';
import { getJson, type HttpOptions } from './http';

/** IANA가 관리하는 RDAP 부트스트랩 파일 위치입니다. TLD, IP 대역, AS 번호별로 담당 RDAP 서버를 알려줍니다. */
export const IANA_BOOTSTRAP = 'https://data.iana.org/rdap/';

type Registry = 'dns' | 'ipv4' | 'ipv6' | 'asn';

interface BootstrapService {
  readonly keys: readonly string[];
  readonly url: string;
}

// 대화형 셸에서 같은 파일을 반복해서 받지 않도록 실행 중에는 기억해 둡니다.
const cache = new Map<string, Promise<BootstrapService[]>>();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseServices(body: unknown): BootstrapService[] | undefined {
  const services =
    typeof body === 'object' && body !== null
      ? (body as { services?: unknown }).services
      : undefined;
  if (!Array.isArray(services)) {
    return undefined;
  }
  return services.flatMap((entry: unknown) => {
    if (!Array.isArray(entry)) {
      return [];
    }
    const [keys, urls] = entry as unknown[];
    if (!isStringArray(keys) || !isStringArray(urls)) {
      return [];
    }
    // 서버 주소가 여러 개면 HTTPS를 고르고, 상대 경로를 붙이기 쉽게 끝에 /를 맞춥니다.
    const url = urls.find((candidate) => candidate.startsWith('https://')) ?? urls[0];
    return url === undefined ? [] : [{ keys, url: url.endsWith('/') ? url : `${url}/` }];
  });
}

function load(base: string, registry: Registry, options: HttpOptions): Promise<BootstrapService[]> {
  const url = new URL(`${registry}.json`, base).href;
  const cached = cache.get(url);
  if (cached) {
    return cached;
  }
  const services = getJson(url, options).then((response) => {
    const parsed = response.status === 200 ? parseServices(response.body) : undefined;
    if (parsed === undefined) {
      throw new UserError(`cannot read the RDAP bootstrap file ${url}`);
    }
    return parsed;
  });
  cache.set(url, services);
  // 실패한 결과는 기억하지 않고 다음에 다시 받습니다.
  services.catch(() => cache.delete(url));
  return services;
}

export async function findDomainServer(
  tld: string,
  base: string,
  options: HttpOptions,
): Promise<string | undefined> {
  const services = await load(base, 'dns', options);
  return services.find((service) => service.keys.includes(tld.toLowerCase()))?.url;
}

export async function findIpServer(
  address: string,
  family: 4 | 6,
  base: string,
  options: HttpOptions,
): Promise<string | undefined> {
  const type = family === 4 ? 'ipv4' : 'ipv6';
  const services = await load(base, type, options);
  return services.find((service) => {
    const ranges = new BlockList();
    for (const key of service.keys) {
      const [network = '', prefix = ''] = key.split('/');
      ranges.addSubnet(network, Number(prefix), type);
    }
    return ranges.check(address, type);
  })?.url;
}

export async function findAsnServer(
  asn: number,
  base: string,
  options: HttpOptions,
): Promise<string | undefined> {
  const services = await load(base, 'asn', options);
  return services.find((service) =>
    service.keys.some((range) => {
      const [start = Number.NaN, end = start] = range.split('-').map(Number);
      return asn >= start && asn <= end;
    }),
  )?.url;
}
