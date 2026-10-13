import { SERVICE_NAMES, TOP_PORTS } from './port-data';

export { TOP_PORTS };

const MAX_PORT = 65535;

/**
 * "22,80,443", "1-1024", "8000-", "-1024", "-"(전체) 형식의 포트 목록을 중복 없는 오름차순 배열로 바꿉니다.
 * 형식이 잘못되면 사용자에게 보여줄 메시지와 함께 RangeError를 던집니다.
 */
export function parsePortList(spec: string): number[] {
  const ports = new Set<number>();
  for (const part of spec.split(',')) {
    const item = part.trim();
    const range = /^(\d*)-(\d*)$/.exec(item);
    if (range === null) {
      ports.add(toPort(item));
      continue;
    }
    const [, from = '', to = ''] = range;
    const start = from === '' ? 1 : toPort(from);
    const end = to === '' ? MAX_PORT : toPort(to);
    if (start > end) {
      throw new RangeError(`${item} is not a valid port range.`);
    }
    for (let port = start; port <= end; port++) {
      ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

function toPort(text: string): number {
  const port = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
    const what = text === '' ? 'an empty entry' : text;
    throw new RangeError(`${what} is not a port number between 1 and ${MAX_PORT}.`);
  }
  return port;
}

/** IANA에 등록된 서비스 이름입니다. 기본 목록에 없는 포트는 대부분 이름이 없습니다. */
export function serviceName(port: number): string | undefined {
  return SERVICE_NAMES[port];
}
