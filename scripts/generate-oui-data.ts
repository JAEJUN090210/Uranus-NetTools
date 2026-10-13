import { gzipSync } from 'node:zlib';

import { writeFile } from 'node:fs/promises';

import { format, resolveConfig } from 'prettier';

// 사용법: tsx scripts/generate-oui-data.ts
// IEEE의 MAC 주소 등록부(OUI)를 내려받아 제조사 조회 데이터(src/core/sweep/oui-data.ts)를 다시 만듭니다.
// 세 등록부를 합쳐 접두사 길이(24/28/36비트)별로 가장 긴 것부터 맞춥니다.

const REGISTRIES = [
  'https://standards-oui.ieee.org/oui/oui.csv', // MA-L (24비트)
  'https://standards-oui.ieee.org/oui28/mam.csv', // MA-M (28비트)
  'https://standards-oui.ieee.org/oui36/oui36.csv', // MA-S (36비트)
];
const OUTPUT_FILE = 'src/core/sweep/oui-data.ts';
const MAX_NAME_LENGTH = 48;

// 거의 모든 이름 끝에 붙는 법인 형태 표기입니다. 이름을 짧게 만들어 데이터 크기를 줄입니다.
const LEGAL_SUFFIX =
  /[,\s]+(?:inc|llc|ltd|co\.?,?\s*ltd|corp|corporation|company|gmbh|ag|s\.?a\.?|b\.?v\.?|pty\.?\s*ltd|limited|co)\.?$/i;

async function download(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return response.text();
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

function shortenName(name: string): string {
  let result = name.replace(/\s+/g, ' ').trim();
  // "Co., Ltd." 처럼 형태 표기가 겹쳐 붙은 경우가 있어 두 번까지 떼어 냅니다.
  result = result.replace(LEGAL_SUFFIX, '').replace(LEGAL_SUFFIX, '').trim();
  if (result.length > MAX_NAME_LENGTH) {
    result = `${result.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
  }
  return result === '' ? name.trim().slice(0, MAX_NAME_LENGTH) : result;
}

const prefixes = new Map<string, string>();
for (const url of REGISTRIES) {
  for (const [registry, assignment = '', organization = ''] of parseCsv(await download(url)).slice(
    1,
  )) {
    if (registry === '' || !/^[0-9A-Fa-f]+$/.test(assignment) || organization.trim() === '') {
      continue;
    }
    prefixes.set(assignment.toUpperCase(), shortenName(organization));
  }
}

const lines = [...prefixes]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([prefix, name]) => `${prefix}\t${name}`)
  .join('\n');
const packed = gzipSync(Buffer.from(lines, 'utf8'), { level: 9 }).toString('base64');

const source = [
  '// 이 파일은 scripts/generate-oui-data.ts가 만듭니다. 직접 고치지 말고 스크립트를 다시 실행하세요.',
  '',
  '/**',
  ` * IEEE MAC 주소 등록부(OUI)에서 뽑은 제조사 이름 ${prefixes.size.toLocaleString('en')}개입니다.`,
  ' * "접두사(16진수)\\t제조사" 줄을 gzip으로 압축해 base64로 담았고, src/core/sweep/oui.ts가 처음 쓸 때 풉니다.',
  ' */',
  `export const OUI_DATA_GZIP_BASE64 =\n  '${packed}';`,
  '',
].join('\n');

const config = await resolveConfig(OUTPUT_FILE);
await writeFile(OUTPUT_FILE, await format(source, { ...config, filepath: OUTPUT_FILE }));
console.log(
  `${OUTPUT_FILE}: ${prefixes.size.toLocaleString('en')} prefixes, ` +
    `${(packed.length / 1024).toFixed(0)} KB base64 (from ${(lines.length / 1024).toFixed(0)} KB text)`,
);
