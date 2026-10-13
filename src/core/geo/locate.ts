import { UserError } from '../../cli/errors';
import { getJson, type HttpOptions } from '../lookup/http';
import type { GeoLocation, GeoProvider } from './providers';

export interface Located {
  /** 위치를 알려준 서비스 이름입니다. */
  readonly source: string;
  readonly location: GeoLocation;
}

export interface LocateOptions extends HttpOptions {
  /** --verbose에서 어느 서비스에 묻는지 보여줄 때 씁니다. */
  readonly onRequest?: (url: string) => void;
}

export type Locator = (address: string, options: LocateOptions) => Promise<Located>;

function describeStatus(status: number): string {
  return status === 429 ? 'too many requests' : `HTTP ${status}`;
}

/** 서비스를 순서대로 물어서 처음으로 위치를 알려준 결과를 돌려줍니다. 모두 실패하면 이유를 모아 알립니다. */
async function locateOnce(
  address: string,
  providers: readonly GeoProvider[],
  options: LocateOptions,
): Promise<Located> {
  const failures: string[] = [];
  for (const provider of providers) {
    const url = provider.url(address);
    options.onRequest?.(url);
    try {
      const response = await getJson(url, options);
      const location = response.status === 200 ? provider.parse(response.body) : undefined;
      if (location !== undefined) {
        return { source: provider.name, location };
      }
      failures.push(
        `${provider.name}: ${response.status === 200 ? 'no location' : describeStatus(response.status)}`,
      );
    } catch (error) {
      if (options.signal.aborted) {
        throw error;
      }
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new UserError(`cannot locate ${address} (${failures.join('; ')})`);
}

/**
 * 위치 조회 함수를 만듭니다. 무료 서비스의 사용량 제한(분당 60회)을 넘지 않도록
 * 동시에 보내는 요청 수를 제한합니다.
 */
export function createLocator(providers: readonly GeoProvider[], concurrency = 4): Locator {
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = async () => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    // 끝난 요청이 자리를 바로 넘겨주므로 active는 그대로입니다.
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };

  return async (address, options) => {
    await acquire();
    try {
      return await locateOnce(address, providers, options);
    } finally {
      release();
    }
  };
}
