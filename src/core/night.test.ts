import { describe, expect, it } from 'vitest';
import { MS_PER_DAY } from './constants';
import { daylight, NIGHT_STEP_MS, nightOf, nightStart } from './night';
import {
  LOW_ORBIT_DARK_SUN_ELEVATION,
  nextViewingWindow,
  type Observer,
  sunElevationAt,
} from './observer';

const HOUR = 3_600_000;
const chicago: Observer = { latitude: 41.88, longitude: -87.63 };
/** Longyearbyen, Svalbard: no night in summer, no day in winter. */
const svalbard: Observer = { latitude: 78.22, longitude: 15.65 };

describe('nightStart', () => {
  it('is the noon before, at Greenwich', () => {
    expect(nightStart(0, Date.parse('2026-11-20T15:00:00Z'))).toBe(
      Date.parse('2026-11-20T12:00:00Z'),
    );
    expect(nightStart(0, Date.parse('2026-11-20T03:00:00Z'))).toBe(
      Date.parse('2026-11-19T12:00:00Z'),
    );
  });

  it('is noon by the Sun, which comes six hours later a quarter of the way west', () => {
    expect(nightStart(-90, Date.parse('2026-11-20T17:00:00Z'))).toBe(
      Date.parse('2026-11-19T18:00:00Z'),
    );
    expect(nightStart(-90, Date.parse('2026-11-20T18:00:00Z'))).toBe(
      Date.parse('2026-11-20T18:00:00Z'),
    );
  });

  it('always holds the time it was asked about', () => {
    for (const longitude of [-180, -118.44, -87.63, -0.1, 0, 32.64, 151.21, 180]) {
      for (let hour = 0; hour < 48; hour += 5) {
        const timeMs = Date.parse('2027-08-02T00:00:00Z') + hour * HOUR;
        const start = nightStart(longitude, timeMs);
        expect(start).toBeLessThanOrEqual(timeMs);
        expect(start + MS_PER_DAY).toBeGreaterThan(timeMs);
        // And the start of a night is in that night, not the one before.
        expect(nightStart(longitude, start)).toBe(start);
      }
    }
  });
});

describe('nightOf', () => {
  const night = nightOf(chicago, Date.parse('2026-11-17T06:30:00Z')); // half past midnight there

  it('runs from noon to noon, with the night in the middle', () => {
    expect(night.endMs - night.startMs).toBe(MS_PER_DAY);
    expect(night.sunElevations).toHaveLength(MS_PER_DAY / NIGHT_STEP_MS + 1);
    const last = night.sunElevations.length - 1;
    expect(night.sunElevations[0]).toBeGreaterThan(20);
    expect(night.sunElevations[last]).toBeGreaterThan(20);
    expect(night.sunElevations[last / 2]).toBeLessThan(-40);
  });

  it('samples the Sun where it says it does', () => {
    const at = night.startMs + 30 * NIGHT_STEP_MS;
    expect(night.sunElevations[30]).toBeCloseTo(sunElevationAt(chicago, at), 3);
  });

  it('finds the good stretches after dusk and before dawn', () => {
    expect(night.windows).toHaveLength(2);
    const [dusk, dawn] = night.windows;
    const midnight = night.startMs + MS_PER_DAY / 2;
    expect(dusk.endMs).toBeLessThan(midnight);
    expect(dawn.startMs).toBeGreaterThan(midnight);
    for (const window of night.windows) {
      const length = window.endMs - window.startMs;
      expect(length).toBeGreaterThan(HOUR / 2);
      expect(length).toBeLessThan(3 * HOUR);
    }
    // Dusk's begins as the sky gets dark, and ends as the shadow reaches low orbit.
    expect(sunElevationAt(chicago, dusk.startMs)).toBeCloseTo(-6, 0);
    expect(sunElevationAt(chicago, dusk.endMs)).toBeCloseTo(LOW_ORBIT_DARK_SUN_ELEVATION, 0);
  });

  it('agrees with the search for the next one', () => {
    const next = nextViewingWindow(chicago, night.startMs);
    if (!next) throw new Error('expected a window');
    expect(Math.abs(night.windows[0].startMs - next.startMs)).toBeLessThan(60_000);
    expect(Math.abs(night.windows[0].endMs - next.endMs)).toBeLessThan(60_000);
  });

  it('finds none where the Sun does not set', () => {
    const summer = nightOf(svalbard, Date.parse('2026-06-21T00:00:00Z'));
    expect(summer.windows).toEqual([]);
    expect(Math.min(...summer.sunElevations)).toBeGreaterThan(0);
  });

  it('keeps one that runs through noon inside the night', () => {
    // In the polar night the Sun is 11° down at noon: dark, with low orbit lit.
    const winter = nightOf(svalbard, Date.parse('2026-12-21T00:00:00Z'));
    expect(winter.windows.length).toBeGreaterThanOrEqual(2);
    expect(winter.windows[0].startMs).toBe(winter.startMs);
    expect(winter.windows[winter.windows.length - 1].endMs).toBe(winter.endMs);
  });
});

describe('daylight', () => {
  it('is nothing in full night and everything in full day', () => {
    expect(daylight(-40)).toBe(0);
    expect(daylight(-18)).toBe(0);
    expect(daylight(8)).toBe(1);
    expect(daylight(60)).toBe(1);
  });

  it('only ever grows as the Sun climbs', () => {
    let last = -1;
    for (let elevation = -30; elevation <= 30; elevation += 0.5) {
      const light = daylight(elevation);
      expect(light).toBeGreaterThanOrEqual(last);
      last = light;
    }
  });

  it('puts most of the change in twilight', () => {
    expect(daylight(0) - daylight(-18)).toBeGreaterThan(0.7);
  });
});
