import { isIP } from 'node:net';

import { runProcess } from '../process';
import { isCommandNotFound } from '../stream';

export interface Gateway {
  readonly address: string;
  readonly family: 4 | 6;
  /** 이 경로가 쓰는 어댑터입니다. 운영체제에 따라 이름 대신 내 주소가 올 수 있습니다. */
  readonly via?: string;
  /** 같은 목적지로 가는 경로가 여럿일 때 낮은 쪽이 먼저 쓰입니다. */
  readonly metric?: number;
}

export interface GatewayOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly onCommand?: (commandLine: string) => void;
}

type Attempt = readonly [
  file: string,
  args: readonly string[],
  parse: (output: string) => Gateway[],
];

/**
 * 운영체제의 라우팅 표를 읽어 기본 게이트웨이를 찾습니다. Node는 이 정보를 알려주지 않습니다.
 * 라우팅 표의 설명은 운영체제 언어에 따라 번역되므로 숫자와 형식만 보고 해석합니다.
 */
export async function findGateways(options: GatewayOptions): Promise<Gateway[]> {
  const attempts: readonly Attempt[] =
    options.platform === 'win32'
      ? [
          ['route', ['print', '-4'], parseWindowsIpv4],
          ['route', ['print', '-6'], parseWindowsIpv6],
        ]
      : options.platform === 'darwin'
        ? [
            ['netstat', ['-rnf', 'inet'], (output) => parseBsd(output, 4)],
            ['netstat', ['-rnf', 'inet6'], (output) => parseBsd(output, 6)],
          ]
        : [
            ['ip', ['-4', 'route', 'show', 'default'], (output) => parseIpRoute(output, 4)],
            ['ip', ['-6', 'route', 'show', 'default'], (output) => parseIpRoute(output, 6)],
            // ip 명령이 없는 오래된 배포판을 위한 대비입니다.
            ['route', ['-n'], parseLinuxRoute],
          ];

  const found: Gateway[] = [];
  for (const [file, args, parse] of attempts) {
    // IPv4를 이미 찾았으면 예비 수단은 건너뜁니다.
    if (file === 'route' && options.platform !== 'win32' && found.length > 0) {
      continue;
    }
    options.onCommand?.(`${file} ${args.join(' ')}`);
    try {
      const { stdout } = await runProcess(file, args, {
        timeout: options.timeoutMs,
        signal: options.signal,
        env: options.env,
      });
      found.push(...parse(stdout));
    } catch (error) {
      if (!isCommandNotFound(error)) {
        throw error;
      }
    }
  }
  return dedupe(found);
}

/** 같은 주소가 여러 경로로 나오면 metric이 낮은 것만 남깁니다. */
function dedupe(gateways: readonly Gateway[]): Gateway[] {
  const best = new Map<string, Gateway>();
  for (const gateway of gateways) {
    const previous = best.get(gateway.address);
    if (previous === undefined || (gateway.metric ?? Infinity) < (previous.metric ?? Infinity)) {
      best.set(gateway.address, gateway);
    }
  }
  return [...best.values()].sort(
    (a, b) => a.family - b.family || (a.metric ?? 0) - (b.metric ?? 0),
  );
}

/** "0.0.0.0 0.0.0.0 <게이트웨이> <내 주소> <메트릭>" 줄을 찾습니다. */
export function parseWindowsIpv4(output: string): Gateway[] {
  const gateways: Gateway[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (match && isIP(match[1] ?? '') === 4) {
      gateways.push({
        address: match[1] ?? '',
        family: 4,
        ...(match[2] === undefined ? {} : { via: match[2] }),
        metric: Number(match[3]),
      });
    }
  }
  return gateways;
}

/** IPv6 표는 "<어댑터 번호> <메트릭> ::/0 <게이트웨이>" 형식입니다. */
export function parseWindowsIpv6(output: string): Gateway[] {
  const gateways: Gateway[] = [];
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+::\/0\s+(\S+)/.exec(line);
    const address = match?.[3]?.split('%')[0] ?? '';
    if (match && isIP(address) === 6) {
      gateways.push({ address, family: 6, via: match[1], metric: Number(match[2]) });
    }
  }
  return gateways;
}

/** "default via 192.168.1.1 dev wlan0 metric 600" 형식입니다. */
export function parseIpRoute(output: string, family: 4 | 6): Gateway[] {
  const gateways: Gateway[] = [];
  for (const line of output.split('\n')) {
    const address = /\bvia\s+(\S+)/.exec(line)?.[1];
    if (address === undefined || isIP(address.split('%')[0] ?? '') !== family) {
      continue;
    }
    const metric = /\bmetric\s+(\d+)/.exec(line)?.[1];
    gateways.push({
      address: address.split('%')[0] ?? address,
      family,
      ...put('via', /\bdev\s+(\S+)/.exec(line)?.[1]),
      ...put('metric', metric === undefined ? undefined : Number(metric)),
    });
  }
  return gateways;
}

/** netstat -rn의 "default <게이트웨이> <플래그> <어댑터>" 줄입니다. */
export function parseBsd(output: string, family: 4 | 6): Gateway[] {
  const gateways: Gateway[] = [];
  for (const line of output.split('\n')) {
    const match = /^(?:default|0\.0\.0\.0\/0|::\/0)\s+(\S+)\s+\S+\s+(\S+)/.exec(line.trim());
    const address = match?.[1]?.split('%')[0] ?? '';
    if (match && isIP(address) === family) {
      gateways.push({ address, family, ...put('via', match[2]) });
    }
  }
  return gateways;
}

/** route -n의 "0.0.0.0 <게이트웨이> 0.0.0.0 UG <메트릭> ... <어댑터>" 줄입니다. */
export function parseLinuxRoute(output: string): Gateway[] {
  const gateways: Gateway[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const [destination, address, , flags, metric] = fields;
    if (destination !== '0.0.0.0' || isIP(address ?? '') !== 4 || flags?.includes('G') !== true) {
      continue;
    }
    gateways.push({
      address: address ?? '',
      family: 4,
      ...put('via', fields.at(-1)),
      ...put('metric', metric === undefined ? undefined : Number(metric)),
    });
  }
  return gateways;
}

function put<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
