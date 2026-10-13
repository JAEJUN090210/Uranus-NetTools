import pkg from '../../../package.json' with { type: 'json' };
import { UserError } from '../../cli/errors';

export const USER_AGENT = `uranus-nettools/${pkg.version} (+https://github.com/JAEJUN090210/Uranus-NetTools)`;

export interface HttpOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  /** 기본값은 RDAP과 일반 JSON을 받는 헤더입니다. */
  readonly accept?: string;
}

export interface JsonResponse {
  readonly status: number;
  /** 리다이렉트를 따라간 뒤의 최종 주소입니다. */
  readonly url: string;
  /** JSON이 아니면 undefined입니다. */
  readonly body: unknown;
}

/** JSON을 받아옵니다. 시간 초과와 연결 실패는 사용자가 이해할 수 있는 에러로 바꿉니다. */
export async function getJson(url: string, options: HttpOptions): Promise<JsonResponse> {
  const request = options.fetch ?? fetch;
  try {
    const response = await request(url, {
      headers: {
        accept: options.accept ?? 'application/rdap+json, application/json',
        'user-agent': USER_AGENT,
      },
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]),
    });
    const text = await response.text();
    return { status: response.status, url: response.url || url, body: parseJson(text) };
  } catch (error) {
    throw toNetworkError(error, new URL(url).host, options);
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toNetworkError(error: unknown, host: string, options: HttpOptions): Error {
  // 사용자가 Ctrl+C로 취소한 것은 그대로 넘겨서 취소로 처리되게 합니다.
  if (options.signal.aborted) {
    return error instanceof Error ? error : new Error(String(error));
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new UserError(`${host} did not answer within ${options.timeoutMs} ms`);
  }
  const cause =
    error instanceof Error ? (error.cause as NodeJS.ErrnoException | undefined) : undefined;
  return new UserError(
    `cannot reach ${host}${cause?.code === undefined ? '' : ` (${cause.code})`}`,
  );
}
