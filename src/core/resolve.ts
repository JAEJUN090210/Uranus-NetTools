import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { UserError } from '../cli/errors';

export type IpFamily = 4 | 6;

export interface ResolvedHost {
  readonly host: string;
  readonly address: string;
  readonly family: IpFamily;
}

/** 호스트 이름을 IP 주소 하나로 바꿉니다. family가 0이면 OS가 고른 주소를 씁니다. */
export async function resolveHost(host: string, family: 0 | IpFamily = 0): Promise<ResolvedHost> {
  const literal = isIP(host);
  if (literal === 4 || literal === 6) {
    if (family !== 0 && literal !== family) {
      throw new UserError(`${host} is not an IPv${family} address`);
    }
    return { host, address: host, family: literal };
  }
  try {
    const result = await lookup(host, { family });
    return { host, address: result.address, family: result.family === 6 ? 6 : 4 };
  } catch {
    throw new UserError(
      `cannot resolve ${host}${family === 0 ? '' : ` to an IPv${family} address`}`,
    );
  }
}
