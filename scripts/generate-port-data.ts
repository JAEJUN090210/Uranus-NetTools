import { writeFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';

// 사용법: tsx scripts/generate-port-data.ts
// nmap-services와 IANA 포트 등록부를 내려받아 src/core/scan/port-data.ts를 다시 만듭니다.

const NMAP_SERVICES_URL = 'https://raw.githubusercontent.com/nmap/nmap/master/nmap-services';
const IANA_REGISTRY_URL =
  'https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv';
const OUTPUT_FILE = 'src/core/scan/port-data.ts';
const TOP_PORT_COUNT = 1000;

/** IANA에 처음 등록된 이름보다 실제로 널리 쓰이는 이름이 따로 있는 포트입니다. */
const NAME_OVERRIDES: Readonly<Record<number, string>> = {
  135: 'msrpc',
  465: 'submissions',
  2049: 'nfs',
  5900: 'vnc',
  8000: 'http-alt',
  8443: 'https-alt',
  8888: 'http-alt',
};

/** 기본 목록에는 없지만 -p로 자주 검사하는 포트입니다. 이름만 데이터에 넣습니다. */
const EXTRA_NAMED_PORTS: readonly number[] = [
  1883, 2375, 2376, 2379, 5671, 5672, 6379, 8883, 11211, 27017,
];

async function download(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * nmap --top-ports와 같은 방식으로 가장 자주 열려 있는 TCP 포트를 고릅니다.
 * nmap은 파일 순서대로 읽은 목록을 빈도로 안정 정렬하므로, 빈도가 같으면 파일에 먼저 나온 포트가 앞섭니다.
 */
function topTcpPorts(services: string, count: number): number[] {
  const seen = new Set<number>();
  const entries: { port: number; ratio: number }[] = [];
  for (const line of services.split('\n')) {
    if (line.trimStart().startsWith('#')) {
      continue;
    }
    const [, portAndProtocol = '', ratio] = line.trim().split(/\s+/);
    const match = /^(\d+)\/tcp$/i.exec(portAndProtocol);
    if (match?.[1] === undefined) {
      continue;
    }
    const port = Number(match[1]);
    // nmap은 같은 포트가 두 번 나오면 처음 것만 씁니다.
    if (!seen.has(port)) {
      seen.add(port);
      entries.push({ port, ratio: parseRatio(ratio) });
    }
  }
  entries.sort((a, b) => b.ratio - a.ratio);
  return entries
    .slice(0, count)
    .map((entry) => entry.port)
    .sort((a, b) => a - b);
}

function parseRatio(text: string | undefined): number {
  if (text?.includes('/')) {
    const [numerator = 0, denominator = 1] = text.split('/').map(Number);
    return numerator / denominator;
  }
  return text?.startsWith('0.') ? Number.parseFloat(text) : 0;
}

/** 따옴표 안의 쉼표와 줄바꿈을 지원하는 최소한의 CSV 파서입니다. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text.charAt(index + 1) === '"') {
        field += '"';
        index++;
      } else {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 포트마다 IANA에 처음 등록된 TCP 서비스 이름을 찾습니다. 범위로 등록된 이름(x11 등)은 단일 포트 이름이 없을 때 씁니다. */
function ianaTcpNames(csv: string): (port: number) => string | undefined {
  const single = new Map<number, string>();
  const ranges: { start: number; end: number; name: string }[] = [];
  for (const [name = '', ports = '', protocol = ''] of parseCsv(csv).slice(1)) {
    if (protocol !== 'tcp' || name === '' || ports === '') {
      continue;
    }
    const [start = 0, end = start] = ports.split('-').map(Number);
    if (start !== end) {
      ranges.push({ start, end, name });
    } else if (!single.has(start)) {
      single.set(start, name);
    }
  }
  return (port) =>
    single.get(port) ?? ranges.find((range) => range.start <= port && port <= range.end)?.name;
}

function render(topPorts: readonly number[], names: ReadonlyMap<number, string>): string {
  const entries = [...names]
    .sort(([a], [b]) => a - b)
    .map(([port, name]) => `  ${port}: ${JSON.stringify(name)},`);
  return [
    '// 이 파일은 scripts/generate-port-data.ts가 만듭니다. 직접 고치지 말고 스크립트를 다시 실행하세요.',
    '',
    '/**',
    ' * nmap이 기본으로 검사하는 TCP 포트 1000개(--top-ports 1000)입니다.',
    ' * nmap-services의 빈도 순위로 계산했으며, 빈도 값은 담지 않고 포트 번호만 오름차순으로 담습니다.',
    ' */',
    `export const TOP_PORTS: readonly number[] = [${topPorts.join(', ')}];`,
    '',
    '/** 포트별 TCP 서비스 이름입니다. IANA Service Name and Transport Protocol Port Number Registry를 따릅니다. */',
    'export const SERVICE_NAMES: Readonly<Record<number, string>> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

const [services, registry] = await Promise.all([
  download(NMAP_SERVICES_URL),
  download(IANA_REGISTRY_URL),
]);
const topPorts = topTcpPorts(services, TOP_PORT_COUNT);
const ianaName = ianaTcpNames(registry);
const names = new Map<number, string>();
for (const port of [...topPorts, ...EXTRA_NAMED_PORTS]) {
  const name = NAME_OVERRIDES[port] ?? ianaName(port);
  if (name !== undefined) {
    names.set(port, name);
  }
}

const source = render(topPorts, names);
const config = await resolveConfig(OUTPUT_FILE);
await writeFile(OUTPUT_FILE, await format(source, { ...config, filepath: OUTPUT_FILE }));
console.log(`${OUTPUT_FILE}: ${topPorts.length} ports, ${names.size} service names`);
