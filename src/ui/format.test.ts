import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatInteger,
  formatLatitude,
  formatLongitude,
  formatPeriod,
  formatUtc,
} from './format';

describe('format', () => {
  it('formats instants in UTC regardless of the local time zone', () => {
    expect(formatUtc(Date.UTC(2026, 10, 16, 6, 31, 7))).toBe('16 Nov 2026, 06:31:07');
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
