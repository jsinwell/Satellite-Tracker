import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAngularSize,
  formatBodyDistance,
  formatCompass,
  formatDuration,
  formatInteger,
  formatLatitude,
  formatLightTime,
  formatLongitude,
  formatPeriod,
  formatUtc,
  fromUtcField,
  litWords,
  toUtcField,
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

describe('the sky', () => {
  const arcsecond = Math.PI / 180 / 3600;

  it('measures the Moon in minutes of arc and planets in seconds', () => {
    expect(formatAngularSize(31.4 * 60 * arcsecond)).toBe('31.4′');
    expect(formatAngularSize(44.52 * arcsecond)).toBe('44.5″');
    expect(formatAngularSize(2.3 * arcsecond)).toBe('2.3″');
  });

  it('gives the distance of the Moon in km and of planets in AU', () => {
    expect(formatBodyDistance(384_412)).toBe('384,400 km');
    expect(formatBodyDistance(4.21 * 149_597_870.7)).toBe('4.21 AU');
    expect(formatBodyDistance(0.38 * 149_597_870.7)).toBe('0.38 AU');
  });

  it('says how much of a disc is lit', () => {
    expect(litWords(0.999)).toBe('full');
    expect(litWords(0.004)).toBe('new');
    expect(litWords(0.5)).toBe('50% lit');
    expect(litWords(0.123)).toBe('12% lit');
  });

  it('gives the time light takes in whatever unit suits', () => {
    expect(formatLightTime(384_400)).toBe('1.3 s');
    expect(formatLightTime(4.21 * 149_597_870.7)).toBe('35 min');
    expect(formatLightTime(30 * 149_597_870.7)).toBe('4.2 h');
  });
});

describe('toUtcField and fromUtcField', () => {
  const eclipse = Date.UTC(2027, 7, 2, 10, 7, 30);

  it('write and read an instant in UTC, whatever the local time zone', () => {
    expect(toUtcField(eclipse)).toBe('2027-08-02 10:07:30');
    expect(fromUtcField('2027-08-02 10:07:30')).toBe(eclipse);
  });

  it('read back what they write, to the second', () => {
    for (const timeMs of [Date.UTC(1957, 9, 4, 19, 28, 34), eclipse, Date.UTC(2100, 11, 31)]) {
      expect(fromUtcField(toUtcField(timeMs + 432))).toBe(timeMs);
    }
  });

  it.each([
    ['2027-08-02T10:07:30', eclipse],
    ['2027-08-02T10:07:30Z', eclipse],
    ['2027-08-02 10:07:30 UTC', eclipse],
    ['  2027-08-02   10:07:30.250 ', eclipse],
    ['2027-8-2 10:07:30', eclipse],
    ['2027-08-02 10:07', Date.UTC(2027, 7, 2, 10, 7)],
    ['2027-08-02 9:05', Date.UTC(2027, 7, 2, 9, 5)],
    ['2027-08-02', Date.UTC(2027, 7, 2)],
    ['2028-02-29', Date.UTC(2028, 1, 29)],
  ])('take %j', (text, expected) => {
    expect(fromUtcField(text)).toBe(expected);
  });

  it.each([
    '',
    'tomorrow',
    '08/02/2027',
    '2027-08',
    '2027-13-02 10:07',
    '2027-02-30 10:07',
    '2027-02-29',
    '2027-08-02 24:00',
    '2027-08-02 10:60',
    '2027-08-02 10:07:61',
    '2027-08-02 10',
    '1956-12-31 23:59',
    '2101-01-01 00:00',
  ])('reject %j', (text) => {
    expect(fromUtcField(text)).toBeNull();
  });
});
