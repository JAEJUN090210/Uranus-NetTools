import { describe, expect, it } from 'vitest';

import { resolveHost } from '../../src/core/resolve';

describe('resolveHost', () => {
  it('returns IP addresses as they are', async () => {
    expect(await resolveHost('1.1.1.1')).toEqual({
      host: '1.1.1.1',
      address: '1.1.1.1',
      family: 4,
    });
    expect(await resolveHost('::1')).toEqual({ host: '::1', address: '::1', family: 6 });
  });

  it('rejects an address of the wrong family', async () => {
    await expect(resolveHost('1.1.1.1', 6)).rejects.toThrow('1.1.1.1 is not an IPv6 address');
  });

  it('resolves host names', async () => {
    expect(await resolveHost('localhost', 4)).toEqual({
      host: 'localhost',
      address: '127.0.0.1',
      family: 4,
    });
  });

  it('reports names that do not resolve', async () => {
    await expect(resolveHost('no-such-host.invalid')).rejects.toThrow(
      'cannot resolve no-such-host.invalid',
    );
  });
});
