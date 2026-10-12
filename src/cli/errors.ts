/** 사용자가 고칠 수 있는 문제(잘못된 입력, 응답하지 않는 호스트 등)입니다. 스택 없이 메시지만 보여줍니다. */
export class UserError extends Error {
  override name = 'UserError';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
