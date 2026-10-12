import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import {
  type AddressInfo,
  createRegistrationLookup,
  lookupAddress,
} from '../core/lookup/address-info';
import type { AsnInfo } from '../core/lookup/cymru';
import { createDnsTools, type DnsTools } from '../core/lookup/dns';
import {
  createRegistrationService,
  type LookupContext,
  type RegistrationService,
} from '../core/lookup/registration';
import { parseLookupTarget } from '../core/lookup/target';
import { type IpFamily, resolveAllAddresses } from '../core/resolve';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';

interface IpOptions {
  readonly timeout: number;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
}

/** 테스트에서 실제 네트워크 대신 가짜를 넣을 수 있도록 조회 수단을 한데 모았습니다. */
export interface IpServices {
  readonly registration: RegistrationService;
  readonly dns: (
    timeoutMs: number,
    signal: AbortSignal,
    onFallback?: (message: string) => void,
  ) => DnsTools;
  readonly resolveAll: (
    host: string,
    family: 0 | IpFamily,
  ) => Promise<{ address: string; family: IpFamily }[]>;
}

export function createIpCommand(
  runtime: Runtime,
  services: IpServices = {
    registration: createRegistrationService(),
    dns: createDnsTools,
    resolveAll: resolveAllAddresses,
  },
): Command {
  return new Command('ip')
    .description(
      'show the AS number, network and owner of an IP address or of every address of a domain',
    )
    .argument('<target>', 'IP address or domain name')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each lookup')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .addOption(
      new Option('-4, --ipv4', 'use only the IPv4 addresses of a domain').conflicts('ipv6'),
    )
    .addOption(new Option('-6, --ipv6', 'use only the IPv6 addresses of a domain'))
    .action(async (input: string, options: IpOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = parseLookupTarget(input);
      if (target.kind === 'asn') {
        throw new UserError(`use 'unt whois ${input}' to look up an AS number`);
      }

      const context: LookupContext = {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onRequest: (description) => {
          output.debug(`querying ${description}`);
        },
      };
      const dns = services.dns(options.timeout, runtime.signal, (message) => {
        output.debug(message);
      });
      const sources = {
        registration: createRegistrationLookup(services.registration),
        resolveTxt: dns.resolveTxt,
        reverse: dns.reverse,
      };
      const report = (infos: readonly AddressInfo[]) => {
        for (const info of infos) {
          for (const error of info.errors) {
            output.warn(`${info.address}: ${error}`);
          }
        }
        runtime.exitCode = infos.some((info) => info.errors.length > 0) ? 1 : 0;
      };

      if (target.kind === 'ip') {
        const info = await lookupAddress(target.address, target.family, sources, context);
        output.result({ query: input, ...info }, () => {
          output.fields(addressFields(info));
        });
        report([info]);
        return;
      }

      const addresses = await services.resolveAll(
        target.name,
        options.ipv4 ? 4 : options.ipv6 ? 6 : 0,
      );
      const infos = await Promise.all(
        addresses.map(({ address, family }) => lookupAddress(address, family, sources, context)),
      );
      output.result({ query: input, domain: target.name, addresses: infos }, () => {
        output.table(infos, addressColumns(output));
      });
      report(infos);
    });
}

function describeAsn(asn: AsnInfo): string {
  return asn.name === undefined ? `AS${asn.asn}` : `AS${asn.asn} ${asn.name}`;
}

function addressFields(info: AddressInfo): Field[] {
  const { asn, registration } = info;
  return [
    ['Address', info.address],
    ['Hostname', info.hostname],
    ['Scope', info.reserved ? 'private or reserved, no public registration' : undefined],
    ['ASN', asn === undefined ? undefined : describeAsn(asn)],
    ['Other ASNs', asn?.otherAsns.map((other) => `AS${other}`)],
    ['BGP prefix', asn?.prefix],
    ['Network', registration?.name],
    ['CIDR', registration?.cidrs],
    ['Organization', registration?.organization],
    ['Country', registration?.country ?? asn?.country],
    ['Registry', asn?.registry?.toUpperCase()],
    ['Abuse', registration?.abuse],
  ];
}

function addressColumns(output: Output): Column<AddressInfo>[] {
  return [
    { header: 'ADDRESS', value: (info) => info.address },
    { header: 'HOSTNAME', value: (info) => info.hostname ?? '-' },
    { header: 'ASN', value: (info) => (info.asn === undefined ? '-' : `AS${info.asn.asn}`) },
    {
      header: 'ORGANIZATION',
      value: (info) =>
        info.reserved
          ? output.colors.dim('private or reserved')
          : (info.registration?.organization ?? info.asn?.name ?? '-'),
    },
    {
      header: 'NETWORK',
      value: (info) => info.asn?.prefix ?? info.registration?.cidrs[0] ?? '-',
    },
  ];
}
