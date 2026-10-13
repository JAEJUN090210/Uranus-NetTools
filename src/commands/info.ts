import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { createLocator, type Located, type LocateOptions } from '../core/geo/locate';
import { defaultGeoProviders, type GeoLocation, type GeoProvider } from '../core/geo/providers';
import {
  type AddressInfo,
  createRegistrationLookup,
  lookupAddress,
} from '../core/lookup/address-info';
import { createDnsTools } from '../core/lookup/dns';
import type { DomainRecord, Registration } from '../core/lookup/records';
import { createRegistrationService, type LookupContext } from '../core/lookup/registration';
import { isReservedAddress } from '../core/lookup/reserved';
import { parseLookupTarget } from '../core/lookup/target';
import { type IpFamily, resolveAllAddresses } from '../core/resolve';
import type { Column } from '../ui/table';
import { Output } from '../ui/output';
import type { IpServices } from './ip';
import { addressFields, describePlace, domainFields, locationFields } from './lookup-format';

interface InfoOptions {
  readonly timeout: number;
  /** --no-geo이면 false입니다. */
  readonly geo: boolean;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
}

export interface InfoServices extends IpServices {
  readonly providers: readonly GeoProvider[];
}

interface InfoEntry extends AddressInfo {
  readonly location?: GeoLocation;
  readonly locationSource?: string;
}

/** 도메인 요약에 보여줄 등록 정보 항목입니다. 나머지는 whois에서 볼 수 있습니다. */
const SUMMARY_LABELS = new Set(['Domain', 'Registrar', 'Created', 'Expires', 'Name servers']);

export function createInfoCommand(
  runtime: Runtime,
  services: InfoServices = {
    registration: createRegistrationService(),
    dns: createDnsTools,
    resolveAll: resolveAllAddresses,
    providers: defaultGeoProviders(),
  },
): Command {
  return new Command('info')
    .description('show the registration, network and location of a domain or IP address at once')
    .argument('<target>', 'domain name or IP address')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each lookup')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .option('--no-geo', 'skip locations, so addresses are not sent to location services')
    .addOption(
      new Option('-4, --ipv4', 'use only the IPv4 addresses of a domain').conflicts('ipv6'),
    )
    .addOption(new Option('-6, --ipv6', 'use only the IPv6 addresses of a domain'))
    .action(async (input: string, options: InfoOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = parseLookupTarget(input);
      if (target.kind === 'asn') {
        throw new UserError(`use 'unt whois ${input}' to look up an AS number`);
      }

      const debug = (message: string) => {
        output.debug(message);
      };
      const context: LookupContext = {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onRequest: (description) => {
          debug(`querying ${description}`);
        },
      };
      const dns = services.dns(options.timeout, runtime.signal, debug);
      const sources = {
        registration: createRegistrationLookup(services.registration),
        resolveTxt: dns.resolveTxt,
        reverse: dns.reverse,
      };
      const locate = options.geo ? createLocator(services.providers) : undefined;
      const locateOptions: LocateOptions = {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onRequest: (url) => {
          debug(`querying ${url}`);
        },
      };
      const warnings: string[] = [];
      // 한 가지 조회가 실패해도 나머지는 보여주도록 사용자에게 알릴 실패는 경고로 모읍니다.
      const tolerate = async <T>(task: Promise<T>): Promise<T | undefined> => {
        try {
          return await task;
        } catch (error) {
          if (runtime.signal.aborted || !(error instanceof UserError)) {
            throw error;
          }
          warnings.push(error.message);
          return undefined;
        }
      };

      const describe = async (address: string, family: IpFamily): Promise<InfoEntry> => {
        const skipLocation = locate === undefined || isReservedAddress(address, family);
        const [info, located] = await Promise.all([
          lookupAddress(address, family, sources, context),
          skipLocation ? undefined : tolerate<Located>(locate(address, locateOptions)),
        ]);
        return located === undefined
          ? info
          : { ...info, location: located.location, locationSource: located.source };
      };

      if (target.kind === 'ip') {
        const entry = await describe(target.address, target.family);
        output.result({ query: input, ...entry, errors: [...entry.errors, ...warnings] }, () => {
          const { location } = entry;
          // 위치 서비스의 국가가 등록 정보의 국가보다 자세하므로 위치가 있으면 그쪽을 씁니다.
          const network = addressFields(entry).filter(
            ([label]) => location === undefined || label !== 'Country',
          );
          output.fields(
            location === undefined
              ? network
              : [...network, ...locationFields(location, { network: false })],
          );
          printSources(output, [entry]);
        });
        report(runtime, output, [entry], warnings);
        return;
      }

      const family = options.ipv4 ? 4 : options.ipv6 ? 6 : 0;
      const [registration, addresses] = await Promise.all([
        tolerate<Registration<DomainRecord>>(services.registration.domain(target.name, context)),
        tolerate(services.resolveAll(target.name, family)),
      ]);
      const entries = await Promise.all(
        (addresses ?? []).map(({ address, family: addressFamily }) =>
          describe(address, addressFamily),
        ),
      );

      const json = {
        query: input,
        domain: target.name,
        registration:
          registration === undefined
            ? null
            : { source: registration.source, server: registration.server, ...registration.record },
        addresses: entries,
        errors: warnings,
      };
      output.result(json, () => {
        if (registration !== undefined) {
          output.fields(
            domainFields(registration.record, target.name, output).filter(([label]) =>
              SUMMARY_LABELS.has(label),
            ),
          );
        }
        if (entries.length > 0) {
          if (registration !== undefined) {
            output.line();
          }
          output.table(entries, entryColumns(output, options.geo));
        }
        if (registration !== undefined) {
          output.hint(`registration: ${registration.source.toUpperCase()} ${registration.server}`);
        }
        printSources(output, entries);
      });
      report(runtime, output, entries, warnings);
    });
}

function printSources(output: Output, entries: readonly InfoEntry[]): void {
  const sources = [...new Set(entries.flatMap((entry) => entry.locationSource ?? []))];
  if (sources.length > 0) {
    output.hint(`locations: ${sources.join(', ')} (approximate)`);
  }
}

function report(
  runtime: Runtime,
  output: Output,
  entries: readonly InfoEntry[],
  warnings: readonly string[],
): void {
  for (const warning of warnings) {
    output.warn(warning);
  }
  for (const entry of entries) {
    for (const error of entry.errors) {
      output.warn(`${entry.address}: ${error}`);
    }
  }
  const failed = warnings.length > 0 || entries.some((entry) => entry.errors.length > 0);
  runtime.exitCode = failed ? 1 : 0;
}

function entryColumns(output: Output, withLocation: boolean): Column<InfoEntry>[] {
  const columns: Column<InfoEntry>[] = [
    { header: 'ADDRESS', value: (entry) => entry.address },
    { header: 'HOSTNAME', value: (entry) => entry.hostname ?? '-' },
    { header: 'ASN', value: (entry) => (entry.asn === undefined ? '-' : `AS${entry.asn.asn}`) },
    {
      header: 'ORGANIZATION',
      value: (entry) =>
        entry.reserved
          ? output.colors.dim('private or reserved')
          : (entry.registration?.organization ?? entry.asn?.name ?? '-'),
    },
  ];
  if (withLocation) {
    columns.push({
      header: 'LOCATION',
      value: (entry) =>
        entry.location === undefined ? '-' : (describePlace(entry.location) ?? '-'),
    });
  }
  return columns;
}
