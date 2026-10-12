/** 실제 위치 조회 서비스 응답을 줄인 예시입니다. */

export const freeIpApiGoogle = {
  ipVersion: 4,
  ipAddress: '8.8.8.8',
  latitude: 37.422,
  longitude: -122.085,
  countryName: 'United States',
  countryCode: 'US',
  capital: 'Washington D.C.',
  timeZones: ['America/Chicago', 'America/Los_Angeles'],
  zipCode: '94035',
  cityName: 'Mountain View',
  regionName: 'California',
  regionCode: 'CA',
  asn: '15169',
  asnOrganization: 'Google LLC',
  isProxy: false,
};

export const freeIpApiSeoul = {
  ipVersion: 4,
  ipAddress: '211.234.10.1',
  latitude: 37.5665,
  longitude: 126.978,
  countryName: 'Korea, Republic of',
  countryCode: 'KR',
  timeZones: ['Asia/Seoul'],
  zipCode: '-',
  cityName: 'Seoul',
  regionName: 'Seoul',
  asn: '9644',
  asnOrganization: 'SK Telecom',
  isProxy: true,
};

/** 사설 주소처럼 위치를 모르면 모든 값이 null입니다. */
export const freeIpApiUnknown = {
  ipVersion: null,
  ipAddress: null,
  latitude: null,
  longitude: null,
  countryName: null,
  countryCode: null,
  timeZones: [],
  zipCode: '-',
  cityName: null,
  regionName: null,
  asn: null,
  asnOrganization: null,
  isProxy: false,
};

export const geoJsGoogle = {
  accuracy: 1000,
  area_code: '0',
  asn: 15169,
  continent_code: 'NA',
  country: 'United States',
  country_code: 'US',
  country_code3: 'USA',
  ip: '8.8.8.8',
  latitude: '37.751',
  longitude: '-97.822',
  organization: 'AS15169 Google LLC',
  organization_name: 'Google LLC',
  timezone: 'America/Chicago',
};
