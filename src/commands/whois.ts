import { Command, Option } from 'commander';

import { parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import type { AsnRecord, IpRecord, Registration } from '../core/lookup/records';
import {
  createRegistrationService,
  type LookupContext,
  type RegistrationService,
} from '../core/lookup/registration';
import { parseLookupTarget } from '../core/lookup/target';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';
import { domainFields, formatDate } from './lookup-format';

interface WhoisOptions {
  readonly timeout: number;
  readonly raw?: boolean;
}

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
