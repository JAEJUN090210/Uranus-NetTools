import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { createLocator, type LocateOptions } from '../core/geo/locate';
import { defaultGeoProviders, type GeoLocation, type GeoProvider } from '../core/geo/providers';
import { isReservedAddress } from '../core/lookup/reserved';
import { parseLookupTarget } from '../core/lookup/target';
import { type IpFamily, resolveAllAddresses } from '../core/resolve';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';
import { locationFields } from './lookup-format';

interface GeoipOptions {
  readonly timeout: number;
  readonly ipv4?: boolean;
  readonly ipv6?: boolean;
}

/** 테스트에서 로컬 서버를 가리키는 서비스를 넣을 수 있도록 조회 수단을 모았습니다. */
export interface GeoipServices {
  readonly providers: readonly GeoProvider[];
  readonly resolveAll: (
    host: string,
    family: 0 | IpFamily,
  ) => Promise<{ address: string; family: IpFamily }[]>;
}

interface GeoEntry {
  readonly address: string;
  readonly family: IpFamily;
  readonly reserved: boolean;
  readonly source?: string;
  readonly location?: GeoLocation;
  readonly error?: string;
}

export function createGeoipCommand(
  runtime: Runtime,
  services: GeoipServices = {
    providers: defaultGeoProviders(),
    resolveAll: resolveAllAddresses,
  },
): Command {
  return new Command('geoip')
    .description('show the approximate location of an IP address or of every address of a domain')
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
    .action(async (input: string, options: GeoipOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = parseLookupTarget(input);
      if (target.kind === 'asn') {
        throw new UserError(`AS numbers have no location, try 'unt whois ${input}'`);
      }

      const locate = createLocator(services.providers);
      const locateOptions: LocateOptions = {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onRequest: (url) => {
          output.debug(`querying ${url}`);
        },
      };
      const lookup = async (address: string, family: IpFamily): Promise<GeoEntry> => {
        // 사설·예약 주소는 위치가 없으므로 외부 서비스로 보내지 않습니다.
        if (isReservedAddress(address, family)) {
          return { address, family, reserved: true };
        }
        try {
          const { source, location } = await locate(address, locateOptions);
          return { address, family, reserved: false, source, location };
        } catch (error) {
          if (!(error instanceof UserError)) {
            throw error;
          }
          return { address, family, reserved: false, error: error.message };
        }
      };

      if (target.kind === 'ip') {
        const entry = await lookup(target.address, target.family);
        if (entry.error !== undefined) {
          throw new UserError(entry.error);
        }
        output.result({ query: input, ...toJson(entry) }, () => {
          output.fields(entryFields(entry));
          printSources(output, [entry]);
        });
        return;
      }

      const addresses = await services.resolveAll(
        target.name,
        options.ipv4 ? 4 : options.ipv6 ? 6 : 0,
      );
      const entries = await Promise.all(
        addresses.map(({ address, family }) => lookup(address, family)),
      );
      output.result({ query: input, domain: target.name, addresses: entries.map(toJson) }, () => {
        output.table(entries, entryColumns(output));
        printSources(output, entries);
      });
      for (const entry of entries) {
        if (entry.error !== undefined) {
          output.warn(entry.error);
        }
      }
      runtime.exitCode = entries.some((entry) => entry.error !== undefined) ? 1 : 0;
    });
}

function toJson(entry: GeoEntry) {
  const { location, ...rest } = entry;
  return { ...rest, ...location };
}

function printSources(output: Output, entries: readonly GeoEntry[]): void {
  const sources = [...new Set(entries.flatMap((entry) => entry.source ?? []))];
  if (sources.length > 0) {
    output.hint(`source: ${sources.join(', ')} (locations are approximate)`);
  }
}

function entryFields(entry: GeoEntry): Field[] {
  const { location } = entry;
  if (entry.reserved || location === undefined) {
    return [
      ['Address', entry.address],
      ['Scope', 'private or reserved, no location'],
    ];
  }
  return [['Address', entry.address], ...locationFields(location)];
}

function entryColumns(output: Output): Column<GeoEntry>[] {
  const value = (pick: (location: GeoLocation) => string | undefined) => (entry: GeoEntry) => {
    if (entry.reserved) {
      return output.colors.dim('private');
    }
    return entry.location === undefined ? '-' : (pick(entry.location) ?? '-');
  };
  return [
    { header: 'ADDRESS', value: (entry) => entry.address },
    { header: 'COUNTRY', value: value((location) => location.countryCode) },
    { header: 'REGION', value: value((location) => location.region) },
    { header: 'CITY', value: value((location) => location.city) },
    { header: 'ORGANIZATION', value: value((location) => location.organization) },
  ];
}
