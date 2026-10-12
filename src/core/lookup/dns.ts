import { Resolver } from 'node:dns/promises';

export interface DnsTools {
  readonly resolveTxt: (name: string) => Promise<string[][]>;
  /** PTR 레코드가 없으면 빈 배열입니다. local은 사설 주소처럼 내부망 이름만 있을 수 있는 주소인지 여부입니다. */
  readonly reverse: (address: string, local: boolean) => Promise<string[]>;
}

/** 시스템 DNS 서버에 닿지 못할 때 대신 물어볼 공개 DNS 서버입니다. */
export const FALLBACK_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

/** 시스템 DNS 서버에 닿는지 확인할 때 묻는 이름입니다. 어차피 ASN 조회에 쓰는 서버입니다. */
const PROBE_NAME = 'AS15169.asn.cymru.com';
const PROBE_TIMEOUT_MS = 2000;

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

/**
 * 질의마다 시간 제한이 있고, 취소되면 진행 중인 질의를 멈추는 DNS 조회 도구를 만듭니다.
 * 처음 쓸 때 시스템 DNS 서버에 닿는지 한 번 확인하고, 닿지 않으면 공개 DNS로 묻습니다.
 * OS 해석기(getnameinfo)는 응답이 없으면 프로세스 종료까지 붙잡아서 쓰지 않습니다.
 */
export function createDnsTools(
  timeoutMs: number,
  signal: AbortSignal,
  onFallback?: (message: string) => void,
): DnsTools {
  const resolvers: Resolver[] = [];
  const createResolver = (options: { timeout: number; tries: number }, servers?: string[]) => {
    const resolver = new Resolver(options);
    if (servers !== undefined) {
      resolver.setServers(servers);
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
  let choice: Promise<Resolver> | undefined;
  const pickResolver = () => {
    choice ??= createResolver({ timeout: PROBE_TIMEOUT_MS, tries: 1 })
      .resolveTxt(PROBE_NAME)
      .then(
        () => true,
        (error: unknown) => !hasCode(error, UNREACHABLE_CODES),
      )
      .then((reachable) => {
        if (reachable) {
          return system;
        }
        onFallback?.(
          `system DNS servers are unreachable, asking ${FALLBACK_DNS_SERVERS.join(', ')} instead`,
        );
        return createResolver({ timeout: timeoutMs, tries: 2 }, FALLBACK_DNS_SERVERS);
      });
    return choice;
  };

  return {
    resolveTxt: async (name) => (await pickResolver()).resolveTxt(name),
    reverse: async (address, local) => {
      const resolver = await pickResolver();
      // 공개 DNS는 내부망 이름을 모르므로 사설 주소는 시스템 DNS 서버에만 묻습니다.
      if (local && resolver !== system) {
        return [];
      }
      try {
        return await resolver.reverse(address);
      } catch (error) {
        if (isMissingRecord(error)) {
          return [];
        }
        throw error;
      }
    },
  };
}
