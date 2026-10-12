import { domainToUnicode } from 'node:url';

import { Command, Option } from 'commander';

import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import type { AsnRecord, DomainRecord, IpRecord, Registration } from '../core/lookup/records';
import {
  createRegistrationService,
  type LookupContext,
  type RegistrationService,
} from '../core/lookup/registration';
import { parseLookupTarget } from '../core/lookup/target';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';

interface WhoisOptions {
  readonly timeout: number;
  readonly raw?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function createWhoisCommand(
  runtime: Runtime,
  service: RegistrationService = createRegistrationService(),
): Command {
  return new Command('whois')
    .description('look up the registration of a domain, IP address or AS number')
    .argument('<target>', 'domain name, IP address or AS number (e.g. AS15169)')
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for each server')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .option('--raw', "print the server's original response")
    .action(async (input: string, options: WhoisOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const target = parseLookupTarget(input);
      const context: LookupContext = {
        signal: runtime.signal,
        timeoutMs: options.timeout,
        onRequest: (description) => {
          output.debug(`querying ${description}`);
        },
      };

      const print = <T extends object>(registration: Registration<T>, fields: Field[]) => {
        if (options.raw === true) {
          printRaw(runtime, registration.raw);
          return;
        }
        const { source, server, record } = registration;
        output.result({ query: input, type: target.kind, source, server, ...record }, () => {
          output.fields(fields);
          output.hint(`source: ${source.toUpperCase()} ${server}`);
        });
      };

      switch (target.kind) {
        case 'domain': {
          const registration = await service.domain(target.name, context);
          print(registration, domainFields(registration.record, target.name, output));
          break;
        }
        case 'ip': {
          const registration = await service.ip(target.address, target.family, context);
          print(registration, ipFields(registration.record));
          break;
        }
        case 'asn': {
          const registration = await service.asn(target.number, context);
          print(registration, asnFields(registration.record));
          break;
        }
      }
    });
}

function printRaw(runtime: Runtime, raw: unknown): void {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  runtime.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function formatDate(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/** 만료일 옆에 남은 기간을 붙이고, 30일 안에 만료되면 노란색, 이미 만료됐으면 빨간색으로 표시합니다. */
function formatExpiry(value: string | undefined, output: Output): string | undefined {
  const time = value === undefined ? Number.NaN : Date.parse(value);
  if (value === undefined || Number.isNaN(time)) {
    return value;
  }
  const days = Math.floor((time - Date.now()) / DAY_MS);
  const date = formatDate(value) ?? value;
  if (days < 0) {
    return output.colors.red(`${date} (expired ${-days} days ago)`);
  }
  const text = `${date} (in ${days} days)`;
  return days < 30 ? output.colors.yellow(text) : text;
}

function domainFields(record: DomainRecord, query: string, output: Output): Field[] {
  const domain = record.domain === '' ? query : record.domain;
  const unicode = domainToUnicode(domain);
  return [
    ['Domain', unicode === domain ? domain : `${unicode} (${domain})`],
    ['Registrar', record.registrar],
    ['Registrant', record.registrant],
    ['Created', formatDate(record.created)],
    ['Updated', formatDate(record.updated)],
    ['Expires', formatExpiry(record.expires, output)],
    ['Status', record.status],
    ['Name servers', record.nameservers],
    ['DNSSEC', record.dnssec === undefined ? undefined : record.dnssec ? 'signed' : 'unsigned'],
  ];
}

function ipFields(record: IpRecord): Field[] {
  return [
    ['Range', record.start && record.end ? `${record.start} - ${record.end}` : undefined],
    ['CIDR', record.cidrs],
    ['Name', record.name],
    ['Handle', record.handle],
    ['Organization', record.organization],
    ['Country', record.country],
    ['Type', record.type],
    ['Abuse', record.abuse],
    ['Created', formatDate(record.created)],
    ['Updated', formatDate(record.updated)],
  ];
}

function asnFields(record: AsnRecord): Field[] {
  return [
    ['ASN', `AS${record.asn}`],
    ['Name', record.name],
    ['Organization', record.organization],
    ['Country', record.country],
    ['Created', formatDate(record.created)],
    ['Updated', formatDate(record.updated)],
  ];
}
