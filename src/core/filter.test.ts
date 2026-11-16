import { describe, expect, it } from 'vitest';
import { debris, fixtures, geostationary, iss, starlink } from './__fixtures__/satellites';
import { CONSTELLATION_IDS, constellationOf } from './constellation';
import { countVisible, type Filters, launchYear, SHOW_EVERYTHING, visibilityMask } from './filter';
import { summarizeOrbit } from './orbit';

const orbits = fixtures.map((record) => summarizeOrbit(record.elements));
const launchYears = fixtures.map((record) => launchYear(record) ?? 0);
const constellations = fixtures.map((record) => CONSTELLATION_IDS.indexOf(constellationOf(record)));
const maskFor = (filters: Filters, years: number[] = launchYears) =>
  visibilityMask({ satellites: fixtures, orbits, launchYears: years, constellations }, filters);

describe('constellation filter', () => {
  it('hides a disabled constellation and nothing else', () => {
    const filters = {
      ...SHOW_EVERYTHING,
      constellations: { ...SHOW_EVERYTHING.constellations, starlink: false },
    };
    const mask = maskFor(filters);
    expect(mask[fixtures.indexOf(starlink)]).toBe(0);
    expect(countVisible(mask)).toBe(fixtures.length - 1);
  });
});
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
      ...SHOW_EVERYTHING,
      types: { ...SHOW_EVERYTHING.types, payload: false },
      regimes: { ...SHOW_EVERYTHING.regimes, LEO: false },
    };
    // Debris passes the type filter but is in LEO; GOES is not in LEO but is a payload.
    expect(countVisible(maskFor(filters))).toBe(0);
  });

  it('shows only what had been launched by a given year', () => {
    // The ISS went up in 1998, GOES 16 in 2016.
    expect(isShown({ ...SHOW_EVERYTHING, launchedBy: 1997 }, iss)).toBe(false);
    expect(isShown({ ...SHOW_EVERYTHING, launchedBy: 1998 }, iss)).toBe(true);
    expect(isShown({ ...SHOW_EVERYTHING, launchedBy: 2015 }, geostationary)).toBe(false);
    expect(isShown({ ...SHOW_EVERYTHING, launchedBy: 2016 }, geostationary)).toBe(true);
  });

  it('shows objects of unknown age only when no year limit is set', () => {
    const unknown = launchYears.map(() => 0);
    expect(countVisible(maskFor(SHOW_EVERYTHING, unknown))).toBe(fixtures.length);
    expect(countVisible(maskFor({ ...SHOW_EVERYTHING, launchedBy: 2026 }, unknown))).toBe(0);
  });
});

describe('launchYear', () => {
  it('reads the year from the launch date', () => {
    expect(launchYear(iss)).toBe(1998);
  });

  it('falls back to the international designator', () => {
    expect(launchYear({ ...iss, launchDate: null, intlDesignator: '2019-029K' })).toBe(2019);
  });

  it('is null when the catalog gives neither', () => {
    expect(launchYear({ ...iss, launchDate: null, intlDesignator: '' })).toBeNull();
  });
});
