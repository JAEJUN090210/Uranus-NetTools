import { describe, expect, it } from 'vitest';

import { resolveAllAddresses } from '../../src/core/resolve';

describe('resolveAllAddresses', () => {
  it('returns every address of a host name', async () => {
    expect(await resolveAllAddresses('localhost', 4)).toEqual([
      { address: '127.0.0.1', family: 4 },
    ]);
  });

  it('reports names that do not resolve', async () => {
    await expect(resolveAllAddresses('no-such-host.invalid')).rejects.toThrow(
      'cannot resolve no-such-host.invalid',
    );
  });
});
