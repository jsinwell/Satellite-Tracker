import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatCompass,
  formatDuration,
  formatInteger,
  formatLatitude,
  formatLongitude,
  formatPeriod,
  formatUtc,
  fromUtcInput,
  toUtcInput,
} from './format';

describe('format', () => {
  it('formats instants in UTC regardless of the local time zone', () => {
    expect(formatUtc(Date.UTC(2026, 10, 16, 6, 31, 7))).toBe('Nov 16, 2026, 06:31:07');
  });

  it('groups thousands', () => {
    expect(formatInteger(19575)).toBe('19,575');
  });

  it('labels hemispheres instead of signing coordinates', () => {
    expect(formatLatitude(51.634)).toBe('51.63° N');
    expect(formatLatitude(-33.9)).toBe('33.90° S');
    expect(formatLongitude(-104.7)).toBe('104.70° W');
    expect(formatLongitude(13.4)).toBe('13.40° E');
  });

  it.each([
    [45_000, '45 s'],
    [12 * 60_000, '12 min'],
    [5.3 * 3_600_000, '5.3 h'],
    [3.2 * 86_400_000, '3.2 d'],
    [-12 * 60_000, '12 min'],
  ])('formats a duration of %d ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('switches period units between low and high orbits', () => {
    expect(formatPeriod(92.94)).toBe('92.9 min');
    expect(formatPeriod(1436.07)).toBe('23.93 h');
  });
});

describe('formatAgo', () => {
  const minutes = (count: number) => count * 60_000;

  it.each([
    [minutes(0.2), 'just now'],
    [minutes(1), '1 minute ago'],
    [minutes(12), '12 minutes ago'],
    [minutes(59), '59 minutes ago'],
    [minutes(68), '1 hour ago'],
    [minutes(100), '2 hours ago'],
    [minutes(60 * 23), '23 hours ago'],
    [minutes(60 * 30), '1 day ago'],
    [minutes(60 * 24 * 3.2), '3 days ago'],
  ])('describes %d ms as "%s"', (ms, expected) => {
    expect(formatAgo(ms)).toBe(expected);
  });

  it('names the nearest compass point', () => {
    expect([0, 22, 23, 90, 181, 292, 337.4, 337.6, 359, -45].map(formatCompass)).toEqual([
      'N',
      'N',
      'NE',
      'E',
      'S',
      'W',
      'NW',
      'N',
      'N',
      'NW',
    ]);
  });
});

describe('toUtcInput and fromUtcInput', () => {
  const eclipse = Date.UTC(2027, 7, 2, 10, 7, 30);

  it('write and read an instant in UTC, whatever the local time zone', () => {
    expect(toUtcInput(eclipse)).toBe('2027-08-02T10:07:30');
    expect(fromUtcInput('2027-08-02T10:07:30')).toBe(eclipse);
  });

  it('take a time without seconds', () => {
    expect(fromUtcInput('2027-08-02T10:07')).toBe(Date.UTC(2027, 7, 2, 10, 7));
  });

  it.each([
    '',
    'tomorrow',
    '2027-08-02',
    '2027-13-02T10:07',
    '2027-02-30T10:07',
    '1956-12-31T23:59',
    '2101-01-01T00:00',
  ])('reject %j', (value) => {
    expect(fromUtcInput(value)).toBeNull();
  });
});
