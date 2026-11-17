import { describe, expect, it } from 'vitest';
import { geostationary, iss } from './__fixtures__/satellites';
import {
  gmst,
  isSunlit,
  moonPosition,
  shadowDepth,
  subSatellitePoint,
  sunDirection,
} from './astro';
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

describe('moonPosition', () => {
  const angleToSun = (timeMs: number) => {
    const moon = moonPosition(timeMs, vec());
    const sun = sunDirection(timeMs, vec());
    const cosine =
      (moon.x * sun.x + moon.y * sun.y + moon.z * sun.z) / Math.hypot(moon.x, moon.y, moon.z);
    return (Math.acos(cosine) * 180) / Math.PI;
  };

  it('stays between perigee and apogee distance all year', () => {
    for (let day = 0; day < 365; day += 3) {
      const moon = moonPosition(Date.UTC(2026, 0, 1) + day * 86_400_000, vec());
      const distance = Math.hypot(moon.x, moon.y, moon.z);
      expect(distance).toBeGreaterThan(356_000);
      expect(distance).toBeLessThan(407_000);
    }
  });

  // Eclipses pin the Moon's direction independently of this code: during a
  // solar eclipse it is in front of the Sun, during a lunar one directly opposite.
  it.each([
    ['2024-04-08T18:18:00Z', 'total solar eclipse over North America'],
    ['2026-08-12T17:46:00Z', 'total solar eclipse over Spain'],
  ])('is in line with the Sun at %s (%s)', (instant) => {
    expect(angleToSun(Date.parse(instant))).toBeLessThan(1.5);
  });

  it.each([
    ['2025-03-14T06:59:00Z', 'total lunar eclipse'],
    ['2025-09-07T18:12:00Z', 'total lunar eclipse'],
  ])('is opposite the Sun at %s (%s)', (instant) => {
    expect(angleToSun(Date.parse(instant))).toBeGreaterThan(178.5);
  });

  it('circles the sky once a sidereal month', () => {
    const start = Date.UTC(2026, 4, 1);
    const a = moonPosition(start, vec());
    const b = moonPosition(start + 27.321661 * 86_400_000, { x: 0, y: 0, z: 0 });
    const cosine =
      (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    expect((Math.acos(Math.min(1, cosine)) * 180) / Math.PI).toBeLessThan(8);
  });
});

describe('shadowDepth', () => {
  const sun = { x: 1, y: 0, z: 0 };
  const orbit = 6378.137 + 400;

  it('is 0 on the day side and 1 directly behind the Earth', () => {
    expect(shadowDepth({ x: orbit, y: 0, z: 0 }, sun)).toBe(0);
    expect(shadowDepth({ x: -orbit, y: 0, z: 0 }, sun)).toBe(1);
  });

  it('is 0 over the terminator and beside the shadow', () => {
    expect(shadowDepth({ x: 0, y: orbit, z: 0 }, sun)).toBe(0);
    expect(shadowDepth({ x: -orbit, y: 0, z: 6378.137 + 500 }, sun)).toBe(0);
  });

  it('fades across the edge of the shadow rather than switching', () => {
    const atEdge = shadowDepth({ x: -orbit, y: 6378.137, z: 0 }, sun);
    expect(atEdge).toBeCloseTo(0.5, 5);
    expect(shadowDepth({ x: -orbit, y: 6378.137 - 20, z: 0 }, sun)).toBeGreaterThan(atEdge);
    expect(shadowDepth({ x: -orbit, y: 6378.137 + 20, z: 0 }, sun)).toBeLessThan(atEdge);
  });

  it('reaches geostationary altitude, where satellites are eclipsed near the equinoxes', () => {
    expect(shadowDepth({ x: -42_164, y: 0, z: 0 }, sun)).toBe(1);
    expect(shadowDepth({ x: -42_164, y: 0, z: 8000 }, sun)).toBe(0);
  });

  it('agrees with the full umbra-and-penumbra model around an orbit', () => {
    // Follow the ISS for one revolution. The two models may only differ in the
    // seconds it spends crossing the shadow's edge.
    const timeMs = Date.parse(iss.elements.epoch);
    const propagator = new Propagator([iss]);
    const state = new Float32Array(STATE_STRIDE);
    let disagreements = 0;
    const samples = 560; // every 10 s for one 93-minute orbit
    for (let i = 0; i < samples; i++) {
      const t = timeMs + i * 10_000;
      propagator.propagate(t, state);
      const position = { x: state[0], y: state[1], z: state[2] };
      const inShadow = shadowDepth(position, sunDirection(t, vec())) > 0.5;
      if (inShadow === isSunlit(position, t)) disagreements++;
    }
    expect(disagreements).toBeLessThanOrEqual(4);
  });
});
