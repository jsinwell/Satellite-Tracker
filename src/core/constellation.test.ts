import { describe, expect, it } from 'vitest';
import { geostationary, gps, iss, starlink } from './__fixtures__/satellites';
import type { SatelliteRecord } from './catalog';
import {
  CONSTELLATION_IDS,
  constellationOf,
  soleEnabled,
  typicalAltitudeKm,
} from './constellation';
import { summarizeOrbit } from './orbit';

const named = (name: string, overrides: Partial<SatelliteRecord> = {}): SatelliteRecord => ({
  ...iss,
  name,
  ...overrides,
});

describe('constellationOf', () => {
  it.each([
    ['STARLINK-1008', 'starlink'],
    ['ONEWEB-0012', 'oneweb'],
    ['KUIPER-00008', 'kuiper'],
    ['QIANFAN-1', 'qianfan'],
    ['HULIANWANG DIGUI 01', 'guowang'],
    ['NAVSTAR 43 (USA 132)', 'navigation'],
    ['COSMOS 2433 [GLONASS-M]', 'navigation'],
    ['GSAT0101 (GALILEO-PFM)', 'navigation'],
    ['BEIDOU-2 G1', 'navigation'],
    ['FLOCK 4Q-1', 'planet'],
    ['SKYSAT-A', 'planet'],
    ['IRIDIUM 106', 'iridium'],
  ])('puts %s in %s', (name, expected) => {
    expect(constellationOf(named(name))).toBe(expected);
  });

  it('puts satellites that belong to no constellation in "other"', () => {
    expect(constellationOf(iss)).toBe('other');
    expect(constellationOf(geostationary)).toBe('other');
  });

  it('does not count debris named after a constellation', () => {
    expect(constellationOf(named('IRIDIUM 33 DEB', { objectType: 'debris' }))).toBe('other');
  });

  it('recognizes the real catalog fixtures', () => {
    expect(constellationOf(starlink)).toBe('starlink');
    expect(constellationOf(gps)).toBe('navigation');
  });

  it('lists "other" last', () => {
    expect(CONSTELLATION_IDS.at(-1)).toBe('other');
  });
});

describe('typicalAltitudeKm', () => {
  const orbitAt = (altitudeKm: number) => ({
    ...summarizeOrbit(iss.elements),
    apogeeKm: altitudeKm + 5,
    perigeeKm: altitudeKm - 5,
  });

  it('is the median, so stragglers do not drag it', () => {
    const shell = [550, 551, 549, 550, 350, 1200].map(orbitAt);
    expect(typicalAltitudeKm(shell)).toBeCloseTo(550, 0);
  });

  it('is null for an empty group', () => {
    expect(typicalAltitudeKm([])).toBeNull();
  });

  it('puts the GPS fixture near 20,200 km', () => {
    const altitude = typicalAltitudeKm([summarizeOrbit(gps.elements)]);
    expect(altitude).toBeGreaterThan(19_900);
    expect(altitude).toBeLessThan(20_500);
  });
});

describe('soleEnabled', () => {
  const all = Object.fromEntries(CONSTELLATION_IDS.map((id) => [id, true])) as Record<
    (typeof CONSTELLATION_IDS)[number],
    boolean
  >;
  const none = Object.fromEntries(CONSTELLATION_IDS.map((id) => [id, false])) as typeof all;

  it('names the group that is on by itself', () => {
    expect(soleEnabled({ ...none, navigation: true })).toBe('navigation');
  });

  it('is null when several, all, or no groups are on', () => {
    expect(soleEnabled({ ...none, navigation: true, iridium: true })).toBeNull();
    expect(soleEnabled(all)).toBeNull();
    expect(soleEnabled(none)).toBeNull();
  });
});
