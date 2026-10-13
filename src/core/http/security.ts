export interface SecurityHeader {
  readonly name: string;
  /** 헤더가 없을 때 왜 있으면 좋은지 한 줄로 설명합니다. */
  readonly purpose: string;
  readonly value?: string;
}

/** 흔히 권장되는 응답 헤더입니다. 없으면 바로 위험하다는 뜻은 아니고, 점검 목록으로 씁니다. */
const CHECKED: readonly { readonly name: string; readonly purpose: string }[] = [
  { name: 'strict-transport-security', purpose: 'tells browsers to always use HTTPS' },
  { name: 'content-security-policy', purpose: 'limits where scripts and styles may come from' },
  { name: 'x-content-type-options', purpose: 'stops browsers guessing the content type' },
  { name: 'x-frame-options', purpose: 'stops other sites putting this page in a frame' },
  { name: 'referrer-policy', purpose: 'controls how much of the URL is sent when leaving' },
  { name: 'permissions-policy', purpose: 'turns off browser features the page does not need' },
];

/**
 * 권장 보안 헤더가 있는지 봅니다.
 * x-frame-options는 CSP의 frame-ancestors가 대신할 수 있어 그 경우 있는 것으로 봅니다.
 */
export function checkSecurityHeaders(headers: Readonly<Record<string, string>>): SecurityHeader[] {
  const csp = headers['content-security-policy'];
  return CHECKED.map((header) => {
    const value =
      header.name === 'x-frame-options' && headers[header.name] === undefined
        ? csp?.includes('frame-ancestors')
          ? 'via content-security-policy'
          : undefined
        : headers[header.name];
    return { ...header, ...(value === undefined ? {} : { value }) };
  });
}
