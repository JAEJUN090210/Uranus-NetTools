import { UserError } from '../../cli/errors';
import { type HttpResponse, parseUrl, type RequestOptions, sendRequest } from './request';

export interface FollowOptions extends Omit<RequestOptions, 'url'> {
  readonly url: string;
  /** 따라갈 리다이렉션의 최대 횟수입니다. 0이면 따라가지 않습니다. */
  readonly maxRedirects: number;
  readonly onResponse?: (response: HttpResponse) => void;
}

export interface FollowResult {
  /** 거친 모든 응답입니다. 마지막이 최종 응답입니다. */
  readonly responses: readonly HttpResponse[];
  /** 리다이렉션이 끝나지 않아 멈췄는지 여부입니다. */
  readonly stopped: boolean;
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * 리다이렉션을 따라가며 거친 응답을 모두 모읍니다.
 * 303은 규격대로 GET으로 바꾸고, 301·302도 POST였다면 GET으로 바꿉니다(브라우저와 같은 동작).
 */
export async function followRedirects(options: FollowOptions): Promise<FollowResult> {
  const responses: HttpResponse[] = [];
  let url = options.url;
  let method = options.method;
  let body = options.body;

  for (let hop = 0; ; hop++) {
    const response = await sendRequest({
      ...options,
      url,
      method,
      ...(body === undefined ? {} : { body }),
    });
    responses.push(response);
    options.onResponse?.(response);

    const location = response.headers.location;
    if (!REDIRECT_CODES.has(response.status) || location === undefined) {
      return { responses, stopped: false };
    }
    if (hop >= options.maxRedirects) {
      return { responses, stopped: options.maxRedirects > 0 };
    }

    const next = resolveLocation(response.url, location);
    // 본문이 있는 요청이 GET으로 바뀌면 본문은 보내지 않습니다.
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== 'GET' &&
        method !== 'HEAD')
    ) {
      method = 'GET';
      body = undefined;
    }
    url = next;
  }
}

function resolveLocation(from: string, location: string): string {
  try {
    return new URL(location, from).toString();
  } catch {
    throw new UserError(`the server redirected to something I cannot read: ${location}`);
  }
}

export { parseUrl };
