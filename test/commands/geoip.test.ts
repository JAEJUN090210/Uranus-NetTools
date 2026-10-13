import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UserError } from '../../src/cli/errors';
import type { CommandGroup } from '../../src/cli/program';
import { runCommand } from '../../src/cli/run';
import { createGeoipCommand } from '../../src/commands/geoip';
import { freeIpApi } from '../../src/core/geo/providers';
import { freeIpApiGoogle, freeIpApiSeoul } from '../fixtures/geo';
import { serveJson } from '../helpers/lookup';
import { createTestRuntime } from '../helpers/runtime';

let groups: readonly CommandGroup[] = [];
let close: () => Promise<void> = () => Promise.resolve();

beforeAll(async () => {
  const server = await serveJson(() => ({
    '/free/8.8.8.8': { body: freeIpApiGoogle },
    '/free/211.234.10.1': { body: freeIpApiSeoul },
    '/free/9.9.9.9': { status: 503, body: {} },
  }));
  close = server.close;
  groups = [
    {
      heading: 'Lookup:',
      commands: [
        (runtime) =>
          createGeoipCommand(runtime, {
            providers: [freeIpApi(`${server.base}/free/`)],
            resolveAll: (host) =>
              host === 'example.test'
                ? Promise.resolve([
                    { address: '8.8.8.8', family: 4 },
                    { address: '211.234.10.1', family: 4 },
                    { address: '10.0.0.1', family: 4 },
                  ])
                : Promise.reject(new UserError(`cannot resolve ${host}`)),
          }),
      ],
    },
  ];
});

afterAll(async () => {
  await close();
});

async function geoip(args: string[]) {
  const { runtime, stdout, stderr } = createTestRuntime();
  const code = await runCommand(['geoip', ...args], runtime, groups);
  return { code, stdout: stdout(), stderr: stderr() };
}

describe('unt geoip', () => {
  it('shows where one address is', async () => {
    const { code, stdout } = await geoip(['8.8.8.8']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Country\s+United States \(US\)$/m);
    expect(stdout).toMatch(/^City\s+Mountain View$/m);
    expect(stdout).toMatch(/^Coordinates\s+37\.422, -122\.085$/m);
    expect(stdout).toContain(
      'https://www.openstreetmap.org/?mlat=37.422&mlon=-122.085#map=10/37.422/-122.085',
    );
    expect(stdout).toMatch(/^ASN\s+AS15169 Google LLC$/m);
    expect(stdout).toContain('source: freeipapi.com (locations are approximate)');
  });

  it('marks known proxies', async () => {
    expect((await geoip(['211.234.10.1'])).stdout).toMatch(/^Proxy\s+yes/m);
  });

  it('lists every address of a domain and skips private ones', async () => {
    const { code, stdout } = await geoip(['example.test']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^ADDRESS\s+COUNTRY\s+REGION\s+CITY\s+ORGANIZATION$/m);
    expect(stdout).toMatch(/^8\.8\.8\.8\s+US\s+California\s+Mountain View\s+Google LLC$/m);
    expect(stdout).toMatch(/^211\.234\.10\.1\s+KR\s+Seoul\s+Seoul\s+SK Telecom$/m);
    expect(stdout).toMatch(/^10\.0\.0\.1\s+private\s+private\s+private\s+private$/m);
  });

  it('prints JSON', async () => {
    const { stdout } = await geoip(['8.8.8.8', '--json']);

    expect(JSON.parse(stdout) as unknown).toMatchObject({
      query: '8.8.8.8',
      address: '8.8.8.8',
      reserved: false,
      source: 'freeipapi.com',
      countryCode: 'US',
      city: 'Mountain View',
      latitude: 37.422,
    });
  });

  it('does not send private addresses anywhere', async () => {
    const { code, stdout } = await geoip(['192.168.0.1']);

    expect(code).toBe(0);
    expect(stdout).toMatch(/^Scope\s+private or reserved, no location$/m);
  });

  it('reports failures and AS numbers', async () => {
    const failed = await geoip(['9.9.9.9']);
    const asn = await geoip(['AS15169']);

    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('cannot locate 9.9.9.9 (freeipapi.com: HTTP 503)');
    expect(asn.stderr).toContain("AS numbers have no location, try 'unt whois AS15169'");
  });
});
