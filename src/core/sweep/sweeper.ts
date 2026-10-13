import type { HostnameLookup } from './hostname';
import { ipToInt } from './range';

/** 호스트가 살아 있으면 어떻게 찾았는지와 응답 시간(거부 응답은 시간 없음), 없으면 undefined입니다. */
export type Liveness = { readonly via: 'icmp' | 'tcp'; readonly time?: number } | undefined;
export type HostProbe = (address: string) => Promise<Liveness>;

export interface Host {
  readonly address: string;
  /** 처음 찾은 방법입니다. icmp/tcp는 응답, arp는 응답은 없지만 ARP 테이블에 있는 경우입니다. */
  readonly via: 'icmp' | 'tcp' | 'arp';
  readonly time?: number;
  readonly mac?: string;
  readonly vendor?: string;
  readonly hostname?: string;
}

export interface SweepOptions {
  readonly addresses: readonly string[];
  readonly concurrency: number;
  readonly signal: AbortSignal;
  readonly probe: HostProbe;
  /** 탐색이 끝난 뒤 OS의 ARP 테이블을 읽습니다. */
  readonly arp: () => Promise<Map<string, string>>;
  readonly hostname?: HostnameLookup;
  readonly vendor?: (mac: string) => string | undefined;
  /** done은 지금까지 ping·연결을 시도한 주소 수입니다. */
  readonly onProgress?: (done: number, total: number, found: number) => void;
}

export interface SweepResult {
  readonly hosts: Host[];
  /** 끝까지 탐색했는지 여부입니다. 중간에 취소되면 false입니다. */
  readonly complete: boolean;
}

/**
 * 범위의 모든 주소에 ICMP·TCP로 연결을 시도해 살아 있는 호스트를 찾고,
 * ARP 테이블에서 MAC과 제조사를, 이름 조회로 호스트 이름을 채웁니다.
 */
export async function sweepHosts(options: SweepOptions): Promise<SweepResult> {
  const { addresses, signal } = options;
  const found = new Map<string, { via: Host['via']; time?: number }>();
  let done = 0;

  // 1단계: 모든 주소에 ping과 TCP 연결을 시도합니다.
  await pool(addresses, options.concurrency, signal, async (address) => {
    const live = await options.probe(address);
    done++;
    if (live !== undefined) {
      found.set(address, { via: live.via, time: live.time });
    }
    options.onProgress?.(done, addresses.length, found.size);
  });
  const complete = !signal.aborted && done === addresses.length;

  // 2단계: ARP 테이블을 읽어 MAC을 채우고, 응답은 없지만 ARP에 있는 호스트도 더합니다.
  const targets = new Set(addresses);
  const macs = signal.aborted ? new Map<string, string>() : await safeArp(options.arp);
  for (const address of macs.keys()) {
    if (targets.has(address) && !found.has(address)) {
      found.set(address, { via: 'arp' });
    }
  }

  // 3단계: 찾은 호스트의 이름을 조회합니다.
  const hosts = [...found.keys()].sort((a, b) => ipToInt(a) - ipToInt(b));
  const names = new Map<string, string>();
  if (options.hostname !== undefined && !signal.aborted) {
    const lookup = options.hostname;
    await pool(hosts, Math.min(options.concurrency, 64), signal, async (address) => {
      const name = await lookup(address);
      if (name !== undefined) {
        names.set(address, name);
      }
    });
  }

  return {
    hosts: hosts.map((address) => {
      const entry = found.get(address);
      const mac = macs.get(address);
      return {
        address,
        via: entry?.via ?? 'arp',
        ...(entry?.time !== undefined ? { time: entry.time } : {}),
        ...(mac !== undefined ? { mac } : {}),
        ...(mac !== undefined && options.vendor?.(mac) !== undefined
          ? { vendor: options.vendor(mac) }
          : {}),
        ...(names.has(address) ? { hostname: names.get(address) } : {}),
      };
    }),
    complete,
  };
}

async function safeArp(arp: () => Promise<Map<string, string>>): Promise<Map<string, string>> {
  try {
    return await arp();
  } catch {
    // ARP를 읽지 못해도 ICMP·TCP로 찾은 호스트는 그대로 보여 줍니다.
    return new Map();
  }
}

/** items를 최대 concurrency개씩 동시에 처리합니다. 취소되면 남은 항목은 건너뜁니다. */
async function pool<T>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const run = async () => {
    while (!signal.aborted) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}
