import { describe, expect, it } from 'vitest';

import {
  describePlace,
  formatDate,
  formatExpiry,
  locationFields,
} from '../../src/commands/lookup-format';
import { Output } from '../../src/ui/output';
import { createTestRuntime } from '../helpers/runtime';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('formatDate', () => {
  it('keeps only the date of an ISO timestamp', () => {
    expect(formatDate('2028-09-14T04:00:00Z')).toBe('2028-09-14');
    expect(formatDate('someday')).toBe('someday');
    expect(formatDate(undefined)).toBeUndefined();
  });
});

describe('formatExpiry', () => {
  const output = new Output(createTestRuntime().runtime);

  it('shows how long is left', () => {
    const inTwoMonths = new Date(Date.now() + 60 * DAY_MS + 60_000).toISOString();

    expect(formatExpiry(inTwoMonths, output)).toMatch(/^\d{4}-\d{2}-\d{2} \(in 60 days\)$/);
  });

  it('says how long ago an expired date passed', () => {
    const lastWeek = new Date(Date.now() - 7 * DAY_MS - 60_000).toISOString();

    expect(formatExpiry(lastWeek, output)).toMatch(/\(expired 8 days ago\)$/);
  });
});

describe('describePlace', () => {
  it('joins city, region and country without repeating names', () => {
    expect(describePlace({ city: 'Mountain View', region: 'California', countryCode: 'US' })).toBe(
      'Mountain View, California, US',
    );
    expect(describePlace({ city: 'Seoul', region: 'Seoul', countryCode: 'KR' })).toBe('Seoul, KR');
    expect(describePlace({})).toBeUndefined();
  });
});

describe('locationFields', () => {
  it('can leave out the network so it does not repeat the ip details', () => {
    const fields = locationFields(
      { countryCode: 'US', asn: 15169, organization: 'Google LLC' },
      { network: false },
    );

    expect(fields.find(([label]) => label === 'ASN')?.[1]).toBeUndefined();
  });
});
