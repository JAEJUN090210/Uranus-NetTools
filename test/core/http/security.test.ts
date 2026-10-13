import { describe, expect, it } from 'vitest';

import { checkSecurityHeaders } from '../../../src/core/http/security';

function presence(headers: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(
    checkSecurityHeaders(headers).map((header) => [header.name, header.value]),
  );
}

describe('checkSecurityHeaders', () => {
  it('checks the six recommended headers in a fixed order', () => {
    expect(checkSecurityHeaders({}).map((header) => header.name)).toEqual([
      'strict-transport-security',
      'content-security-policy',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'permissions-policy',
    ]);
  });

  it('explains why a missing header matters', () => {
    const [hsts] = checkSecurityHeaders({});

    expect(hsts?.value).toBeUndefined();
    expect(hsts?.purpose).toContain('HTTPS');
  });

  it('keeps the value of the headers that are there', () => {
    const found = presence({
      'strict-transport-security': 'max-age=31536000',
      'referrer-policy': 'no-referrer',
    });

    expect(found['strict-transport-security']).toBe('max-age=31536000');
    expect(found['referrer-policy']).toBe('no-referrer');
    expect(found['content-security-policy']).toBeUndefined();
  });

  it('accepts CSP frame-ancestors in place of x-frame-options', () => {
    const found = presence({ 'content-security-policy': "frame-ancestors 'none'" });

    expect(found['x-frame-options']).toBe('via content-security-policy');
  });

  it('prefers a real x-frame-options header over the CSP note', () => {
    const found = presence({
      'content-security-policy': "frame-ancestors 'none'",
      'x-frame-options': 'DENY',
    });

    expect(found['x-frame-options']).toBe('DENY');
  });

  it('does not treat an unrelated CSP as x-frame-options', () => {
    const found = presence({ 'content-security-policy': "default-src 'self'" });

    expect(found['x-frame-options']).toBeUndefined();
  });
});
