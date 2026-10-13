import { describe, expect, it } from 'vitest';

import { parsePortList, serviceName, TOP_PORTS } from '../../../src/core/scan/ports';

describe('parsePortList', () => {
  it.each([
    ['22', [22]],
    ['443,22,80', [22, 80, 443]],
    ['20-23', [20, 21, 22, 23]],
    ['22, 20-22 ,80', [20, 21, 22, 80]],
    ['65533-', [65533, 65534, 65535]],
    ['-3', [1, 2, 3]],
  ])('%j', (spec, ports) => {
    expect(parsePortList(spec)).toEqual(ports);
  });

  it('reads - as every port', () => {
    const ports = parsePortList('-');

    expect(ports).toHaveLength(65535);
    expect(ports[0]).toBe(1);
    expect(ports.at(-1)).toBe(65535);
  });

  it.each([
    ['0', '0 is not a port number between 1 and 65535.'],
    ['65536', '65536 is not a port number between 1 and 65535.'],
    ['http', 'http is not a port number between 1 and 65535.'],
    ['22,,80', 'an empty entry is not a port number between 1 and 65535.'],
    ['1.5', '1.5 is not a port number between 1 and 65535.'],
    ['10-5', '10-5 is not a valid port range.'],
    ['1-2-3', '1-2-3 is not a port number between 1 and 65535.'],
  ])('rejects %j', (spec, message) => {
    expect(() => parsePortList(spec)).toThrow(message);
  });
});

describe('TOP_PORTS', () => {
  it('holds the 1000 ports nmap scans by default in ascending order', () => {
    expect(TOP_PORTS).toHaveLength(1000);
    expect(new Set(TOP_PORTS).size).toBe(1000);
    expect([...TOP_PORTS].sort((a, b) => a - b)).toEqual(TOP_PORTS);
    expect(TOP_PORTS).toEqual(expect.arrayContaining([21, 22, 23, 25, 53, 80, 443, 3389, 8080]));
  });
});

describe('serviceName', () => {
  it.each([
    [22, 'ssh'],
    [443, 'https'],
    [3389, 'ms-wbt-server'],
    [8443, 'https-alt'],
    [6379, 'redis'],
  ])('%i → %s', (port, name) => {
    expect(serviceName(port)).toBe(name);
  });

  it('has no name for unregistered ports', () => {
    expect(serviceName(49152)).toBeUndefined();
  });
});
