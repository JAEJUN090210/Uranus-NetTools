import type { AsnRecord, DomainRecord, IpRecord } from './records';

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function texts(value: unknown): string[] {
  return list(value).flatMap((item) => {
    const string = text(item);
    return string === undefined ? [] : [string];
  });
}

function eventDate(object: JsonObject, action: string): string | undefined {
  return text(
    list(object.events)
      .filter(isObject)
      .find((event) => event.eventAction === action)?.eventDate,
  );
}

/** 연락처(entity)는 다른 entity 안에 중첩되기도 하므로 모두 펼쳐서 찾습니다. */
function entities(object: JsonObject): JsonObject[] {
  return list(object.entities)
    .filter(isObject)
    .flatMap((entity) => [entity, ...entities(entity)]);
}

function withRole(object: JsonObject, role: string): JsonObject | undefined {
  return entities(object).find((entity) => list(entity.roles).includes(role));
}

/** vCard 배열에서 항목 값을 꺼냅니다. 예: ["fn", {}, "text", "Google LLC"] */
function vcard(entity: JsonObject | undefined, field: string): string | undefined {
  const [, properties] = list(entity?.vcardArray);
  for (const property of list(properties)) {
    const [name, , , value] = list(property);
    if (name === field) {
      return text(value);
    }
  }
  return undefined;
}

/** 일부 RIR은 소유 기관 이름을 연락처 대신 description 메모에 적습니다. */
function description(object: JsonObject): string | undefined {
  const remark = list(object.remarks)
    .filter(isObject)
    .find((item) => typeof item.title !== 'string' || item.title.toLowerCase() === 'description');
  return remark === undefined ? undefined : texts(remark.description)[0];
}

export function toDomainRecord(raw: unknown): DomainRecord {
  const object = isObject(raw) ? raw : {};
  const registrant = withRole(object, 'registrant');
  const secureDns = isObject(object.secureDNS) ? object.secureDNS : {};
  return {
    domain: (text(object.ldhName) ?? '').toLowerCase(),
    registrar: vcard(withRole(object, 'registrar'), 'fn'),
    registrant: vcard(registrant, 'org') ?? vcard(registrant, 'fn'),
    created: eventDate(object, 'registration'),
    updated: eventDate(object, 'last changed'),
    expires: eventDate(object, 'expiration'),
    status: texts(object.status),
    nameservers: list(object.nameservers)
      .filter(isObject)
      .flatMap((server) => {
        const name = text(server.ldhName);
        return name === undefined ? [] : [name.toLowerCase()];
      }),
    dnssec:
      typeof secureDns.delegationSigned === 'boolean' ? secureDns.delegationSigned : undefined,
  };
}

export function toIpRecord(raw: unknown): IpRecord {
  const object = isObject(raw) ? raw : {};
  const owner = withRole(object, 'registrant');
  return {
    start: text(object.startAddress),
    end: text(object.endAddress),
    cidrs: list(object.cidr0_cidrs)
      .filter(isObject)
      .flatMap((cidr) => {
        const prefix = text(cidr.v4prefix) ?? text(cidr.v6prefix);
        return prefix === undefined || typeof cidr.length !== 'number'
          ? []
          : [`${prefix}/${cidr.length}`];
      }),
    name: text(object.name),
    handle: text(object.handle),
    type: text(object.type),
    organization: vcard(owner, 'org') ?? vcard(owner, 'fn') ?? description(object),
    country: text(object.country),
    abuse: vcard(withRole(object, 'abuse'), 'email'),
    created: eventDate(object, 'registration'),
    updated: eventDate(object, 'last changed'),
  };
}

export function toAsnRecord(raw: unknown, asn: number): AsnRecord {
  const object = isObject(raw) ? raw : {};
  const owner = withRole(object, 'registrant');
  return {
    asn,
    name: text(object.name),
    handle: text(object.handle),
    organization: vcard(owner, 'org') ?? vcard(owner, 'fn') ?? description(object),
    country: text(object.country),
    created: eventDate(object, 'registration'),
    updated: eventDate(object, 'last changed'),
  };
}
