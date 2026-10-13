import type { LookupOptions } from 'node:dns';
import type * as Dns from 'node:dns/promises';

/**
 * 테스트용 dns/promises 모듈을 만듭니다. 존재할 수 없도록 예약된 .invalid 이름은 실제 DNS에 묻지 않고
 * 바로 ENOTFOUND로 실패합니다. OS DNS가 "없음" 응답을 늦게 주는 환경에서도 테스트가 흔들리지 않습니다.
 *
 * 사용법:
 *   vi.mock('node:dns/promises', async (importOriginal) =>
 *     (await import('../helpers/dns')).instantNxdomainModule(importOriginal));
 */
export async function instantNxdomainModule(
  importOriginal: <T = unknown>() => Promise<T>,
): Promise<typeof Dns> {
  const actual = await importOriginal<typeof Dns>();
  async function lookup(hostname: string, options: LookupOptions = {}) {
    if (hostname.endsWith('.invalid')) {
      throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: 'ENOTFOUND',
        hostname,
      });
    }
    return actual.lookup(hostname, options);
  }
  return { ...actual, lookup: lookup as unknown as typeof actual.lookup };
}
