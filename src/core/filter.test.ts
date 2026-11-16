import { describe, expect, it } from 'vitest';
import { debris, fixtures, geostationary, iss } from './__fixtures__/satellites';
import { countVisible, type Filters, SHOW_EVERYTHING, visibilityMask } from './filter';
import { summarizeOrbit } from './orbit';

const orbits = fixtures.map((record) => summarizeOrbit(record.elements));
const maskFor = (filters: Filters) => visibilityMask(fixtures, orbits, filters);
const isShown = (filters: Filters, record: (typeof fixtures)[number]) =>
  maskFor(filters)[fixtures.indexOf(record)] === 1;

describe('visibilityMask', () => {
  it('shows everything by default', () => {
    expect(countVisible(maskFor(SHOW_EVERYTHING))).toBe(fixtures.length);
  });

  it('hides a disabled object type', () => {
    const filters = { ...SHOW_EVERYTHING, types: { ...SHOW_EVERYTHING.types, debris: false } };
    expect(isShown(filters, debris)).toBe(false);
    expect(isShown(filters, iss)).toBe(true);
  });

  it('hides a disabled orbit regime', () => {
    const filters = { ...SHOW_EVERYTHING, regimes: { ...SHOW_EVERYTHING.regimes, LEO: false } };
    expect(isShown(filters, iss)).toBe(false);
    expect(isShown(filters, geostationary)).toBe(true);
  });

  it('requires a satellite to pass both filters', () => {
    const filters: Filters = {
      types: { ...SHOW_EVERYTHING.types, payload: false },
      regimes: { ...SHOW_EVERYTHING.regimes, LEO: false },
    };
    // Debris passes the type filter but is in LEO; GOES is not in LEO but is a payload.
    expect(countVisible(maskFor(filters))).toBe(0);
  });
});
