import { domainToUnicode } from 'node:url';

import type { GeoLocation } from '../core/geo/providers';
import type { AddressInfo } from '../core/lookup/address-info';
import type { AsnInfo } from '../core/lookup/cymru';
import type { DomainRecord } from '../core/lookup/records';
import type { Field } from '../ui/fields';
import type { Output } from '../ui/output';

// whois, ip, geoip, info가 함께 쓰는 출력 형식입니다.

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO 날짜는 YYYY-MM-DD 부분만 보여줍니다. */
export function formatDate(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/** 만료일 옆에 남은 기간을 붙이고, 30일 안에 만료되면 노란색, 이미 만료됐으면 빨간색으로 표시합니다. */
export function formatExpiry(value: string | undefined, output: Output): string | undefined {
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

export function domainFields(record: DomainRecord, query: string, output: Output): Field[] {
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

export function describeAsn(asn: AsnInfo): string {
  return asn.name === undefined ? `AS${asn.asn}` : `AS${asn.asn} ${asn.name}`;
}

export function addressFields(info: AddressInfo): Field[] {
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

function formatCoordinate(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

/** 위치 항목입니다. network가 false면 ip 정보와 겹치는 ASN 항목을 뺍니다. */
export function locationFields(location: GeoLocation, { network = true } = {}): Field[] {
  const { latitude, longitude } = location;
  const point =
    latitude === undefined || longitude === undefined
      ? undefined
      : { lat: formatCoordinate(latitude), lon: formatCoordinate(longitude) };
  const asn =
    location.asn === undefined
      ? location.organization
      : `AS${location.asn}${location.organization === undefined ? '' : ` ${location.organization}`}`;
  return [
    [
      'Country',
      location.country !== undefined && location.countryCode !== undefined
        ? `${location.country} (${location.countryCode})`
        : (location.country ?? location.countryCode),
    ],
    ['Region', location.region],
    ['City', location.city],
    ['Postal code', location.postalCode],
    ['Coordinates', point === undefined ? undefined : `${point.lat}, ${point.lon}`],
    [
      'Map',
      point === undefined
        ? undefined
        : `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=10/${point.lat}/${point.lon}`,
    ],
    ['Time zone', location.timeZone],
    ['ASN', network ? asn : undefined],
    ['Proxy', location.proxy === true ? 'yes, the address is a known proxy or VPN' : undefined],
  ];
}

/** "Mountain View, California, US"처럼 위치를 한 줄로 줄입니다. 도시와 지역 이름이 같으면 한 번만 씁니다. */
export function describePlace(location: GeoLocation): string | undefined {
  const parts = [location.city, location.region, location.countryCode ?? location.country].filter(
    (part) => part !== undefined,
  );
  return parts.length === 0 ? undefined : [...new Set(parts)].join(', ');
}
