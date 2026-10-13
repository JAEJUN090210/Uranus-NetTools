import { gunzipSync } from 'node:zlib';

import { OUI_DATA_GZIP_BASE64 } from './oui-data';

// IEEE 등록부의 접두사 길이입니다. 긴 것부터 맞춰야 더 구체적인 제조사를 찾습니다. (MA-S 36비트, MA-M 28비트, MA-L 24비트)
const PREFIX_LENGTHS = [9, 7, 6] as const;

let table: Map<string, string> | undefined;

/** 압축된 제조사 데이터를 처음 쓸 때 한 번만 풀어 Map으로 만듭니다. */
function load(): Map<string, string> {
  if (table === undefined) {
    table = new Map();
    const text = gunzipSync(Buffer.from(OUI_DATA_GZIP_BASE64, 'base64')).toString('utf8');
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) {
        table.set(line.slice(0, tab), line.slice(tab + 1));
      }
    }
  }
  return table;
}

/** MAC 주소에서 구분 기호를 떼고 대문자 16진수만 남깁니다. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
}

/** MAC 주소의 제조사를 찾습니다. 등록되지 않은 주소나 가상·무작위 주소는 undefined입니다. */
export function vendorOf(mac: string): string | undefined {
  const hex = normalizeMac(mac);
  if (hex.length < 6) {
    return undefined;
  }
  const prefixes = load();
  for (const length of PREFIX_LENGTHS) {
    const name = prefixes.get(hex.slice(0, length));
    if (name !== undefined) {
      return name;
    }
  }
  return undefined;
}

/**
 * 두 번째 16진수 숫자의 둘째 비트가 1이면 기기가 그때그때 만들어 쓰는 무작위 주소입니다.
 * (요즘 휴대폰·노트북이 사생활 보호를 위해 씁니다.) 이런 주소는 제조사를 알 수 없습니다.
 */
export function isLocallyAdministered(mac: string): boolean {
  const hex = normalizeMac(mac);
  if (hex.length < 2) {
    return false;
  }
  return (Number.parseInt(hex.slice(0, 2), 16) & 0b10) !== 0;
}
