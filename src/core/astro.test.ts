import { describe, expect, it } from 'vitest';
import { geostationary, iss } from './__fixtures__/satellites';
import { gmst, isSunlit, subSatellitePoint, sunDirection } from './astro';
import type { Vec3 } from './kinematics';
import { Propagator, STATE_STRIDE } from './propagator';

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });
const SIDEREAL_DAY_MS = 86_164_090.5;
const OBLIQUITY_DEG = 23.44;

function positionAtEpoch(record: typeof iss): { position: Vec3; timeMs: number } {
  const timeMs = Date.parse(record.elements.epoch);
  const state = new Float32Array(STATE_STRIDE);
  new Propagator([record]).propagate(timeMs, state);
  return { position: { x: state[0], y: state[1], z: state[2] }, timeMs };
}

describe('gmst', () => {
  it('returns to the same angle after one sidereal day', () => {
    const t = Date.UTC(2026, 10, 15, 12);
    const turn = 2 * Math.PI;
    const drift = (((gmst(t + SIDEREAL_DAY_MS) - gmst(t)) % turn) + turn) % turn;
    expect(Math.min(drift, turn - drift)).toBeLessThan(1e-5);
  });
});

describe('sunDirection', () => {
  const declination = (timeMs: number) =>
    (Math.asin(sunDirection(timeMs, vec()).z) * 180) / Math.PI;

  it('is a unit vector', () => {
    const { x, y, z } = sunDirection(Date.UTC(2026, 0, 1), vec());
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10);
  });

  it('stands over the tropics at the solstices and the equator at the equinoxes', () => {
    expect(declination(Date.UTC(2026, 5, 21, 8))).toBeCloseTo(OBLIQUITY_DEG, 1);
    expect(declination(Date.UTC(2026, 11, 21, 20))).toBeCloseTo(-OBLIQUITY_DEG, 1);
    expect(Math.abs(declination(Date.UTC(2026, 2, 20, 15)))).toBeLessThan(0.2);
  });

  it('points along the inertial x-axis at the March equinox', () => {
    expect(sunDirection(Date.UTC(2026, 2, 20, 15), vec()).x).toBeGreaterThan(0.999);
  });
});

describe('subSatellitePoint', () => {
  it('finds a geostationary satellite hovering over one spot on the equator', () => {
    // The satellite moves 90° through inertial space in six hours; only a
    // correct Earth-rotation angle keeps its ground longitude fixed.
    const timeMs = Date.parse(geostationary.elements.epoch);
    const propagator = new Propagator([geostationary]);
    const state = new Float32Array(STATE_STRIDE);
    const pointAt = (t: number) => {
      propagator.propagate(t, state);
      return subSatellitePoint({ x: state[0], y: state[1], z: state[2] }, t);
    };

    const now = pointAt(timeMs);
    const later = pointAt(timeMs + 6 * 3_600_000);

    expect(Math.abs(later.longitude - now.longitude)).toBeLessThan(0.5);
    expect(Math.abs(now.latitude)).toBeLessThan(1);
    expect(now.altitudeKm).toBeGreaterThan(35_700);
    expect(now.altitudeKm).toBeLessThan(35_900);
    // GOES 16 has only ever been stationed over the Americas.
    expect(now.longitude).toBeGreaterThan(-140);
    expect(now.longitude).toBeLessThan(-70);
  });

  it('never reports an ISS latitude beyond its inclination', () => {
    const { position, timeMs } = positionAtEpoch(iss);
    const point = subSatellitePoint(position, timeMs);
    expect(Math.abs(point.latitude)).toBeLessThanOrEqual(iss.elements.inclination + 0.2);
    expect(point.altitudeKm).toBeGreaterThan(400);
    expect(point.altitudeKm).toBeLessThan(440);
  });
});

describe('isSunlit', () => {
  const timeMs = Date.UTC(2026, 2, 20, 15); // the Sun is along +x
  const lowOrbit = 6378.137 + 400;

  it('is true on the day side', () => {
    expect(isSunlit({ x: lowOrbit, y: 0, z: 0 }, timeMs)).toBe(true);
  });

  it("is false in the Earth's shadow", () => {
    expect(isSunlit({ x: -lowOrbit, y: 0, z: 0 }, timeMs)).toBe(false);
  });

  it('is true above the pole, clear of the shadow', () => {
    expect(isSunlit({ x: 0, y: 0, z: lowOrbit }, timeMs)).toBe(true);
  });
});
