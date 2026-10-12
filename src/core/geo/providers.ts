export interface GeoLocation {
  readonly country?: string;
  readonly countryCode?: string;
  readonly region?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly timeZone?: string;
  readonly asn?: number;
  readonly organization?: string;
  /** 프록시·VPN 주소로 알려져 있는지 여부입니다. */
  readonly proxy?: boolean;
}

/** IP 위치 조회 서비스입니다. 키 없이 HTTPS로 쓸 수 있는 곳만 씁니다. */
export interface GeoProvider {
  readonly name: string;
  readonly url: (address: string) => string;
  /** 위치를 알 수 없는 응답이면 undefined입니다. */
  readonly parse: (body: unknown) => GeoLocation | undefined;
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  // FreeIPAPI는 우편번호를 모르면 "-"를 줍니다.
  return typeof value === 'string' && value.trim() !== '' && value.trim() !== '-'
    ? value.trim()
    : undefined;
}

function number(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * FreeIPAPI(https://freeipapi.com): 키 없이 HTTPS, 분당 60회, 상업적 이용 가능, 도시 단위 위치.
 * 시간대는 그 나라의 시간대 전체 목록을 주므로 하나뿐일 때만 씁니다.
 */
export function freeIpApi(base = 'https://free.freeipapi.com/api/v1/json/'): GeoProvider {
  return {
    name: 'freeipapi.com',
    url: (address) => `${base}${address}`,
    parse: (body) => {
      if (!isObject(body) || text(body.countryCode) === undefined) {
        return undefined;
      }
      const timeZones = Array.isArray(body.timeZones) ? body.timeZones : [];
      return {
        country: text(body.countryName),
        countryCode: text(body.countryCode),
        region: text(body.regionName),
        city: text(body.cityName),
        postalCode: text(body.zipCode),
        latitude: number(body.latitude),
        longitude: number(body.longitude),
        timeZone: timeZones.length === 1 ? text(timeZones[0]) : undefined,
        asn: number(body.asn),
        organization: text(body.asnOrganization),
        proxy: typeof body.isProxy === 'boolean' ? body.isProxy : undefined,
      };
    },
  };
}

/** GeoJS(https://www.geojs.io): 키 없이 HTTPS, MaxMind GeoLite 데이터. 대개 국가 단위까지만 정확합니다. */
export function geoJs(base = 'https://get.geojs.io/v1/ip/geo/'): GeoProvider {
  return {
    name: 'geojs.io',
    url: (address) => `${base}${address}.json`,
    parse: (body) => {
      if (!isObject(body) || text(body.country_code) === undefined) {
        return undefined;
      }
      return {
        country: text(body.country),
        countryCode: text(body.country_code),
        region: text(body.region),
        city: text(body.city),
        latitude: number(body.latitude),
        longitude: number(body.longitude),
        timeZone: text(body.timezone),
        asn: number(body.asn),
        organization: text(body.organization_name),
      };
    },
  };
}

/** 기본 서비스가 막히거나 응답하지 않을 때 다음 서비스로 넘어가는 순서입니다. */
export function defaultGeoProviders(): GeoProvider[] {
  return [freeIpApi(), geoJs()];
}
