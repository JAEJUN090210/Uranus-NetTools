import { runProcess } from '../process';
import { isCommandNotFound } from '../stream';

export interface ArpOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly onCommand?: (commandLine: string) => void;
}

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const MAC = /\b(?:[0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}\b/;
// 비어 있거나 브로드캐스트·멀티캐스트인 MAC은 특정 기기가 아니므로 무시합니다.
const IGNORED_MACS = new Set(['00:00:00:00:00:00', 'FF:FF:FF:FF:FF:FF']);

/**
 * OS의 ARP 테이블을 읽어 IP → MAC 주소 지도를 만듭니다.
 * 호스트에 먼저 연결을 시도한 뒤 읽어야 테이블이 채워져 있습니다. ARP는 같은 LAN의 주소만 담깁니다.
 */
export async function readArpTable(options: ArpOptions): Promise<Map<string, string>> {
  const attempts: readonly (readonly [string, readonly string[]])[] =
    options.platform === 'win32'
      ? [['arp', ['-a']]]
      : [
          ['arp', ['-an']],
          ['ip', ['neighbor', 'show']],
        ];

  let lastError: unknown;
  for (const [file, args] of attempts) {
    options.onCommand?.(`${file} ${args.join(' ')}`);
    try {
      const { stdout } = await runProcess(file, args, {
        timeout: options.timeoutMs,
        signal: options.signal,
        env: options.env,
      });
      return parseArpTable(stdout);
    } catch (error) {
      if (!isCommandNotFound(error)) {
        throw error;
      }
      lastError = error;
    }
  }
  // arp도 ip도 없으면 MAC 없이 진행합니다. 호스트 찾기는 계속됩니다.
  if (lastError !== undefined) {
    return new Map();
  }
  return new Map();
}

/** arp -a(Windows), arp -an(Linux·macOS), ip neigh 출력에서 IP와 MAC을 뽑습니다. */
export function parseArpTable(output: string): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of output.split('\n')) {
    const ip = IPV4.exec(line)?.[0];
    const rawMac = MAC.exec(line)?.[0];
    if (ip === undefined || rawMac === undefined) {
      continue;
    }
    const mac = normalizeMac(rawMac);
    if (!IGNORED_MACS.has(mac)) {
      table.set(ip, mac);
    }
  }
  return table;
}

/** 구분 기호가 : 든 - 든, 자리를 0으로 채워 "AA:BB:CC:DD:EE:FF" 형식으로 통일합니다. */
function normalizeMac(mac: string): string {
  return mac
    .split(/[:-]/)
    .map((octet) => octet.toUpperCase().padStart(2, '0'))
    .join(':');
}
