import { hostname, release, type as osType } from 'node:os';

import { Command, Option } from 'commander';

import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { systemServers } from '../core/dns/client';
import { findGateways, type Gateway } from '../core/local/gateway';
import { type LocalInterface, listInterfaces } from '../core/local/interfaces';
import { findPublicIp } from '../core/local/public-ip';
import { isLocallyAdministered, vendorOf } from '../core/sweep/oui';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';

interface LocalOptions {
  readonly all?: boolean;
  readonly public?: boolean;
  readonly timeout: number;
}

/** 테스트에서 실제 시스템 대신 가짜를 넣을 수 있도록 모아 둡니다. */
export interface LocalServices {
  readonly interfaces: typeof listInterfaces;
  readonly gateways: typeof findGateways;
  readonly dnsServers: () => string[];
  readonly publicIp: typeof findPublicIp;
  readonly vendor: (mac: string) => string | undefined;
  readonly host: () => { readonly name: string; readonly os: string };
}

const defaultServices: LocalServices = {
  interfaces: listInterfaces,
  gateways: findGateways,
  dnsServers: systemServers,
  publicIp: findPublicIp,
  vendor: vendorOf,
  host: () => ({ name: hostname(), os: `${osType()} ${release()}` }),
};

export function createLocalCommand(
  runtime: Runtime,
  services: LocalServices = defaultServices,
): Command {
  return new Command('local')
    .description('show this computer’s network interfaces, gateway and DNS servers')
    .option('-a, --all', 'show loopback, link-local and interfaces without an address')
    .option('--public', 'also ask an outside service for the public IP address')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for the public IP lookup')
        .argParser(parsePositiveInteger)
        .default(5000),
    )
    .action(async (options: LocalOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const interfaces = services.interfaces({ ...(options.all === true ? { all: true } : {}) });
      const gateways = await services.gateways({
        platform: runtime.platform,
        env: runtime.env,
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onCommand: (line) => {
          output.debug(`running ${line}`);
        },
      });
      const dns = services.dnsServers();
      const host = services.host();

      let publicIp: string | undefined;
      let publicError: string | undefined;
      if (options.public === true) {
        output.hint('Asking an outside service for the public IP...');
        try {
          publicIp = await services.publicIp({
            signal: runtime.signal,
            timeoutMs: options.timeout,
          });
        } catch (error) {
          if (runtime.signal.aborted) {
            throw error;
          }
          publicError = error instanceof Error ? error.message : String(error);
        }
      }

      const rows = toRows(interfaces, services.vendor);
      output.result(
        {
          host: host.name,
          os: host.os,
          publicIp: publicIp ?? null,
          gateways: gateways.map((gateway) => ({
            address: gateway.address,
            family: gateway.family,
            via: gateway.via ?? null,
            metric: gateway.metric ?? null,
          })),
          dnsServers: dns,
          interfaces: interfaces.map((entry) => ({
            name: entry.name,
            mac: entry.mac ?? null,
            vendor: entry.mac === undefined ? null : (services.vendor(entry.mac) ?? null),
            internal: entry.internal,
            addresses: entry.addresses.map((address) => ({
              address: address.address,
              family: address.family,
              cidr: address.cidr ?? null,
              linkLocal: address.linkLocal,
            })),
          })),
        },
        () => {
          output.fields(summaryFields(host, publicIp, gateways, dns));
          output.line('');
          if (rows.length > 0) {
            output.table(rows, interfaceColumns(output));
          } else {
            output.hint('No interface has an address. Use --all to see every interface.');
          }
          if (publicError !== undefined) {
            output.warn(`could not look up the public IP (${publicError})`);
          }
          output.summary(
            `${plural(interfaces.length, 'interface')}, ${plural(rows.length, 'address', 'addresses')}`,
          );
        },
      );
      runtime.exitCode = publicError === undefined ? 0 : 1;
    });
}

function summaryFields(
  host: { readonly name: string; readonly os: string },
  publicIp: string | undefined,
  gateways: readonly Gateway[],
  dns: readonly string[],
): Field[] {
  return [
    ['Host', host.name],
    ['OS', host.os],
    ['Public IP', publicIp],
    [
      'Gateway',
      gateways.map((gateway) =>
        gateway.via === undefined ? gateway.address : `${gateway.address} (${gateway.via})`,
      ),
    ],
    ['DNS', [...dns]],
  ];
}

interface AddressRow {
  readonly name: string;
  readonly address: string;
  readonly family: 4 | 6;
  readonly cidr?: string;
  readonly linkLocal: boolean;
  /** 어댑터의 첫 줄에만 MAC과 제조사를 적어 표를 읽기 쉽게 합니다. */
  readonly mac?: string;
  readonly vendor?: string;
}

function toRows(
  interfaces: readonly LocalInterface[],
  vendor: (mac: string) => string | undefined,
): AddressRow[] {
  return interfaces.flatMap((entry) =>
    entry.addresses.map((address, index) => ({
      name: index === 0 ? entry.name : '',
      address: address.address,
      family: address.family,
      ...(address.cidr === undefined ? {} : { cidr: address.cidr }),
      linkLocal: address.linkLocal,
      ...(index === 0 && entry.mac !== undefined ? { mac: entry.mac } : {}),
      ...(index === 0 && entry.mac !== undefined && vendor(entry.mac) !== undefined
        ? { vendor: vendor(entry.mac) }
        : {}),
    })),
  );
}

/** 주소 뒤의 프리픽스 길이입니다. (예: /24) */
function prefixOf(row: AddressRow): string {
  const slash = row.cidr?.lastIndexOf('/') ?? -1;
  return slash === -1 ? '' : (row.cidr?.slice(slash) ?? '');
}

function interfaceColumns(output: Output): Column<AddressRow>[] {
  return [
    { header: 'INTERFACE', value: (row) => row.name },
    { header: 'ADDRESS', value: (row) => `${row.address}${output.colors.dim(prefixOf(row))}` },
    {
      header: 'FAMILY',
      value: (row) => {
        const text = row.family === 4 ? 'IPv4' : 'IPv6';
        return row.linkLocal ? output.colors.dim(`${text} link-local`) : text;
      },
    },
    { header: 'MAC', value: (row) => row.mac ?? '' },
    {
      header: 'VENDOR',
      value: (row) => {
        if (row.vendor !== undefined) {
          return row.vendor;
        }
        // 요즘 Wi-Fi는 사생활 보호를 위해 무작위 MAC을 쓰고, 그런 주소에는 제조사가 없습니다.
        return row.mac !== undefined && isLocallyAdministered(row.mac)
          ? output.colors.dim('randomized')
          : '';
      },
    },
  ];
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
