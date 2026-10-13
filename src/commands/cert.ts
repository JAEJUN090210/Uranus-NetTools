import { Command, Option } from 'commander';

import { UserError } from '../cli/errors';
import { parsePort, parsePositiveInteger } from '../cli/parsers';
import type { Runtime } from '../cli/runtime';
import { certificateChain, type CertificateInfo, matchesHost } from '../core/cert/describe';
import { type CertificateResult, fetchCertificate } from '../core/cert/fetch';
import {
  isStartTlsProtocol,
  STARTTLS_PORTS,
  STARTTLS_PROTOCOLS,
  type StartTlsProtocol,
} from '../core/cert/starttls';
import type { Field } from '../ui/fields';
import { Output } from '../ui/output';
import type { Column } from '../ui/table';

const DEFAULT_PORT = 443;
/** 이 일수 이하로 남으면 갱신을 알려 줍니다. */
const DEFAULT_EXPIRY_DAYS = 30;

interface CertOptions {
  readonly port?: number;
  readonly starttls?: string;
  readonly chain?: boolean;
  readonly pem?: boolean;
  readonly expiryDays: number;
  readonly timeout: number;
}

/** 테스트에서 실제 연결 대신 가짜를 넣을 수 있도록 모아 둡니다. */
export interface CertServices {
  readonly fetch: typeof fetchCertificate;
}

const defaultServices: CertServices = { fetch: fetchCertificate };

export function createCertCommand(
  runtime: Runtime,
  services: CertServices = defaultServices,
): Command {
  return new Command('cert')
    .description('show the TLS certificate of a server and when it expires')
    .argument('<host>', 'host name or IP address, optionally with :port')
    .addOption(new Option('-p, --port <port>', 'port to connect to').argParser(parsePort))
    .option(
      '--starttls <protocol>',
      `upgrade a plain connection first (${STARTTLS_PROTOCOLS.join(', ')})`,
    )
    .option('--chain', 'show the intermediate and root certificates too')
    .option('--pem', 'print the certificate in PEM form')
    .addOption(
      new Option('--expiry-days <days>', 'warn when fewer days than this are left')
        .argParser(parsePositiveInteger)
        .default(DEFAULT_EXPIRY_DAYS),
    )
    .addOption(
      new Option('-W, --timeout <ms>', 'time to wait for the server')
        .argParser(parsePositiveInteger)
        .default(10_000),
    )
    .action(async (input: string, options: CertOptions, command: Command) => {
      const output = new Output(runtime, command.optsWithGlobals());
      const starttls = parseStartTls(options.starttls);
      const { host, port } = parseTarget(input, options, starttls);

      output.hint(`Asking ${host}:${port} for its certificate...`);
      const result = await services.fetch({
        host,
        port,
        timeoutMs: options.timeout,
        signal: runtime.signal,
        ...(starttls === undefined ? {} : { starttls }),
      });

      const chain = certificateChain(result.certificate);
      const [leaf] = chain;
      if (leaf === undefined) {
        throw new UserError(`${host} did not send a certificate`);
      }
      const matches = matchesHost(leaf.names, host);
      const expired = leaf.daysLeft !== undefined && leaf.daysLeft < 0;

      if (options.pem === true) {
        output.line(toPem(result.certificate.raw));
      }

      output.result(toJson(host, port, result, chain, matches), () => {
        output.fields(leafFields(leaf, result, matches, output));
        if (options.chain === true && chain.length > 1) {
          output.line('');
          output.line(output.colors.bold('CHAIN'));
          output.table(
            chain.map((info, index) => ({ index, info })),
            chainColumns(output),
          );
        }
        printWarnings(output, leaf, result, matches, options.expiryDays);
        output.summary(describeExpiry(leaf));
      });
      runtime.exitCode = expired ? 1 : 0;
    });
}

function parseStartTls(value: string | undefined): StartTlsProtocol | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = value.toLowerCase();
  if (!isStartTlsProtocol(name)) {
    throw new UserError(
      `${value} is not a protocol I know; use one of ${STARTTLS_PROTOCOLS.join(', ')}`,
    );
  }
  return name;
}

/** "example.com", "example.com:8443", "https://example.com" 형식을 받습니다. */
function parseTarget(
  input: string,
  options: CertOptions,
  starttls: StartTlsProtocol | undefined,
): { host: string; port: number } {
  let text = input.replace(/^[a-z][a-z\d+\-.]*:\/\//i, '').replace(/[/?#].*$/, '');
  let port = options.port;
  // [2001:db8::1]:443 처럼 대괄호로 감싼 IPv6도 받습니다.
  const bracketed = /^\[(.+)](?::(\d+))?$/.exec(text);
  if (bracketed) {
    text = bracketed[1] ?? text;
    port ??= bracketed[2] === undefined ? undefined : Number(bracketed[2]);
  } else {
    const colon = text.lastIndexOf(':');
    // 콜론이 하나뿐이면 포트로 보고, 여러 개면 IPv6 주소로 봅니다.
    if (colon !== -1 && text.indexOf(':') === colon) {
      port ??= Number(text.slice(colon + 1));
      text = text.slice(0, colon);
    }
  }
  if (text === '') {
    throw new UserError(`${input} is not a host I can use`);
  }
  const chosen = port ?? (starttls === undefined ? DEFAULT_PORT : STARTTLS_PORTS[starttls]);
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 65535) {
    throw new UserError(`${input} does not have a usable port`);
  }
  return { host: text, port: chosen };
}

function leafFields(
  leaf: CertificateInfo,
  result: CertificateResult,
  matches: boolean,
  output: Output,
): Field[] {
  const trust = result.trusted
    ? output.colors.green('trusted')
    : output.colors.yellow(`not trusted (${result.trustError ?? 'unknown reason'})`);
  const name = matches
    ? output.colors.green('matches')
    : output.colors.red('does not match this host');
  return [
    ['Subject', leaf.subject],
    ['Issuer', [leaf.issuer, leaf.organization].filter((part) => part !== undefined).join(' — ')],
    ['Valid from', formatDate(leaf.validFrom)],
    ['Valid to', formatDate(leaf.validTo)],
    ['Expires', describeExpiry(leaf)],
    ['Hostname', name],
    ['Trust', trust],
    ['Names', leaf.names.join(', ')],
    ['Key', leaf.key],
    ['Serial', leaf.serial],
    ['SHA-256', leaf.fingerprint],
    ['TLS', [result.protocol, result.cipher].filter((part) => part !== undefined).join(', ')],
    ['Address', result.address],
  ];
}

function printWarnings(
  output: Output,
  leaf: CertificateInfo,
  result: CertificateResult,
  matches: boolean,
  expiryDays: number,
): void {
  const { daysLeft } = leaf;
  if (daysLeft !== undefined && daysLeft < 0) {
    output.warn(`this certificate expired ${plural(-daysLeft, 'day')} ago`);
  } else if (daysLeft !== undefined && daysLeft <= expiryDays) {
    output.warn(`this certificate expires in ${plural(daysLeft, 'day')}; time to renew it`);
  }
  if (!matches) {
    output.warn('this certificate is not valid for the host you asked about');
  }
  if (!result.trusted) {
    output.warn(`this certificate is not trusted (${result.trustError ?? 'unknown reason'})`);
  }
}

function describeExpiry(leaf: CertificateInfo): string {
  const { daysLeft } = leaf;
  if (daysLeft === undefined) {
    return 'unknown';
  }
  if (daysLeft < 0) {
    return `expired ${plural(-daysLeft, 'day')} ago`;
  }
  return daysLeft === 0 ? 'expires today' : `in ${plural(daysLeft, 'day')}`;
}

function toJson(
  host: string,
  port: number,
  result: CertificateResult,
  chain: readonly CertificateInfo[],
  matches: boolean,
) {
  const certificate = (info: CertificateInfo) => ({
    subject: info.subject ?? null,
    issuer: info.issuer ?? null,
    organization: info.organization ?? null,
    validFrom: info.validFrom?.toISOString() ?? null,
    validTo: info.validTo?.toISOString() ?? null,
    daysLeft: info.daysLeft ?? null,
    names: info.names,
    serial: info.serial ?? null,
    fingerprint: info.fingerprint ?? null,
    key: info.key ?? null,
  });
  const [leaf] = chain;
  return {
    host,
    port,
    address: result.address ?? null,
    protocol: result.protocol ?? null,
    cipher: result.cipher ?? null,
    trusted: result.trusted,
    trustError: result.trustError ?? null,
    hostnameMatches: matches,
    expired: leaf?.daysLeft !== undefined && leaf.daysLeft < 0,
    elapsed: Math.round(result.elapsed),
    certificate: leaf === undefined ? null : certificate(leaf),
    chain: chain.slice(1).map(certificate),
  };
}

function formatDate(date: Date | undefined): string | undefined {
  return date?.toISOString().slice(0, 10);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** DER 바이트를 64자씩 끊어 PEM 형식으로 적습니다. */
function toPem(raw: Buffer | undefined): string {
  if (raw === undefined) {
    throw new UserError('the server did not send a certificate I can print');
  }
  const body = raw
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
    .trimEnd();
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
}

interface ChainRow {
  readonly index: number;
  readonly info: CertificateInfo;
}

function chainColumns(output: Output): Column<ChainRow>[] {
  return [
    { header: '#', value: (row) => String(row.index), align: 'right' },
    { header: 'SUBJECT', value: (row) => row.info.subject ?? '-' },
    { header: 'ISSUER', value: (row) => row.info.issuer ?? '-' },
    {
      header: 'EXPIRES',
      value: (row) => {
        const text = describeExpiry(row.info);
        return row.info.daysLeft !== undefined && row.info.daysLeft < 0
          ? output.colors.red(text)
          : text;
      },
      align: 'right',
    },
  ];
}
