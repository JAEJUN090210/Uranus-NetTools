import { isIP } from 'node:net';

import { UserError } from '../../cli/errors';
import { getJson, type HttpOptions } from '../lookup/http';

/** geoip이 쓰는 GeoJS의 키 없는 엔드포인트입니다. 상업적 사용도 허용합니다. */
export const PUBLIC_IP_URL = 'https://get.geojs.io/v1/ip.json';

export interface PublicIpOptions extends HttpOptions {
  readonly url?: string;
}

/**
 * 인터넷에서 보이는 내 주소를 알아봅니다. 밖의 서버에 물어봐야 알 수 있으므로 --public을 줄 때만 호출합니다.
 */
export async function findPublicIp(options: PublicIpOptions): Promise<string> {
  const response = await getJson(options.url ?? PUBLIC_IP_URL, {
    ...options,
    accept: 'application/json',
  });
  const body = (typeof response.body === 'object' ? response.body : null) as {
    ip?: unknown;
  } | null;
  const address = typeof body?.ip === 'string' ? body.ip.trim() : '';
  if (isIP(address) === 0) {
    throw new UserError('the public IP service did not answer with an address');
  }
  return address;
}
