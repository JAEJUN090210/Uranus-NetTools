import { isIP } from 'node:net';

export interface HopAddress {
  readonly address: string;
  readonly name?: string;
}

export interface Hop {
  readonly hop: number;
  /** probe마다의 응답 시간(ms)입니다. 응답이 없으면 undefined입니다. */
  readonly times: readonly (number | undefined)[];
  /** 응답한 주소입니다. 경로가 여러 갈래면 둘 이상일 수 있습니다. */
  readonly addresses: readonly HopAddress[];
}

const WINDOWS_TIME = String.raw`(?:<?\d+\s*ms|\*)`;
const WINDOWS_HOP = new RegExp(
  String.raw`^\s*(\d+)\s+(${WINDOWS_TIME}\s+${WINDOWS_TIME}\s+${WINDOWS_TIME})\s+(.*?)\s*$`,
);

/**
 * Windows tracert의 경유지 줄을 읽습니다. 예: "  4    12 ms     *    11 ms  router [72.14.202.18]"
 * 안내 문장은 OS 언어로 번역되지만 시간과 주소 부분은 그대로라서 언어와 상관없이 읽을 수 있습니다.
 */
export function parseWindowsHop(line: string): Hop | undefined {
  const match = WINDOWS_HOP.exec(line);
  if (!match) {
    return undefined;
  }
  const [, hop = '0', timesText = '', where = ''] = match;
  const times = [...timesText.matchAll(/(<?)(\d+)\s*ms|\*/g)].map(([token, less, value]) => {
    if (token === '*') {
      return undefined;
    }
    // tracert는 1ms 미만을 "<1 ms"로만 알려주므로 중간값으로 기록합니다.
    return less === '<' ? Number(value) / 2 : Number(value);
  });
  return { hop: Number(hop), times, addresses: parseWindowsAddress(where) };
}

function parseWindowsAddress(text: string): HopAddress[] {
  const named = /^(.+?)\s+\[([0-9a-f:.%]+)\]$/i.exec(text);
  if (named) {
    const [, name = '', address = ''] = named;
    return [{ address, name }];
  }
  // 모든 probe가 실패하면 주소 대신 "Request timed out." 같은 번역된 문장이 옵니다.
  return isIP(text) === 0 ? [] : [{ address: text }];
}

/**
 * Linux·macOS·BusyBox traceroute의 경유지 줄을 읽습니다.
 * 예: " 4  a.example.net (72.14.202.18)  12.010 ms b.example.net (108.170.1.1)  12.120 ms *"
 */
export function parseTracerouteHop(line: string): Hop | undefined {
  const match = /^\s*(\d+)\s+(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, hop = '0', rest = ''] = match;
  const tokens = rest.trim().split(/\s+/);
  const times: (number | undefined)[] = [];
  const addresses: HopAddress[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? '';
    const next = tokens[index + 1] ?? '';
    const inParentheses = /^\((.+)\)$/.exec(next)?.[1];
    if (token === '*') {
      times.push(undefined);
    } else if (next === 'ms' && /^\d+(?:\.\d+)?$/.test(token)) {
      times.push(Number(token));
      index++;
    } else if (inParentheses !== undefined && isIP(inParentheses) !== 0) {
      addresses.push(
        token === inParentheses ? { address: token } : { address: inParentheses, name: token },
      );
      index++;
    } else if (isIP(token) !== 0) {
      addresses.push({ address: token });
    }
    // !H, !N 같은 표시는 건너뜁니다.
  }
  return times.length === 0 ? undefined : { hop: Number(hop), times, addresses };
}

export interface TracepathProbe {
  readonly hop: number;
  readonly time?: number;
  readonly address?: HopAddress;
}

/**
 * Linux tracepath의 줄 하나(probe 하나)를 읽습니다.
 * 예: " 3:  dns.google (8.8.8.8)   12.110ms reached", " 2:  no reply"
 */
export function parseTracepathLine(line: string): TracepathProbe | undefined {
  const match = /^\s*(\d+)(\??):\s+(.*?)\s*$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, hopText = '0', localhost = '', rest = ''] = match;
  const hop = Number(hopText);
  // "1?: [LOCALHOST]  pmtu 1500"은 자기 자신을 가리키는 줄입니다.
  if (localhost === '?' || rest.startsWith('[LOCALHOST]')) {
    return undefined;
  }
  if (rest.startsWith('no reply')) {
    return { hop };
  }

  const [first = '', second = ''] = rest.split(/\s+/);
  const inParentheses = /^\((.+)\)$/.exec(second)?.[1];
  let address: HopAddress | undefined;
  if (inParentheses !== undefined && isIP(inParentheses) !== 0) {
    address =
      first === inParentheses ? { address: first } : { address: inParentheses, name: first };
  } else if (isIP(first) !== 0) {
    address = { address: first };
  }
  const time = /(\d+(?:\.\d+)?)ms\b/.exec(rest)?.[1];
  return {
    hop,
    ...(time === undefined ? {} : { time: Number(time) }),
    ...(address === undefined ? {} : { address }),
  };
}
