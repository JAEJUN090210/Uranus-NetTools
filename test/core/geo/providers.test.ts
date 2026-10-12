import { describe, expect, it } from 'vitest';

import { freeIpApi, geoJs } from '../../../src/core/geo/providers';
import { freeIpApiGoogle, freeIpApiSeoul, freeIpApiUnknown, geoJsGoogle } from '../../fixtures/geo';

describe('freeIpApi', () => {
  const provider = freeIpApi('https://geo.example/');

  it('builds the request URL', () => {
    expect(provider.url('2001:db8::1')).toBe('https://geo.example/2001:db8::1');
  });

  it('reads the location, leaving out a time zone it cannot pin down', () => {
    expect(provider.parse(freeIpApiGoogle)).toEqual({
      country: 'United States',
      countryCode: 'US',
      region: 'California',
      city: 'Mountain View',
      postalCode: '94035',
      latitude: 37.422,
      longitude: -122.085,
      asn: 15169,
      organization: 'Google LLC',
      proxy: false,
    });
  });

  it('keeps a single time zone and treats "-" as no postal code', () => {
    expect(provider.parse(freeIpApiSeoul)).toMatchObject({
      timeZone: 'Asia/Seoul',
      proxy: true,
    });
    expect(provider.parse(freeIpApiSeoul)).not.toHaveProperty('postalCode', '-');
  });

  it('returns nothing when the location is unknown', () => {
    expect(provider.parse(freeIpApiUnknown)).toBeUndefined();
    expect(provider.parse('not json')).toBeUndefined();
  });
});

describe('geoJs', () => {
  const provider = geoJs('https://geo.example/');

  it('builds the request URL', () => {
    expect(provider.url('8.8.8.8')).toBe('https://geo.example/8.8.8.8.json');
  });

  it('turns coordinates given as text into numbers', () => {
    expect(provider.parse(geoJsGoogle)).toEqual({
      country: 'United States',
      countryCode: 'US',
      latitude: 37.751,
      longitude: -97.822,
      timeZone: 'America/Chicago',
      asn: 15169,
      organization: 'Google LLC',
    });
  });
});
