import { json2satrec, propagate } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { fixtures, geostationary, iss } from './__fixtures__/satellites';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM } from './constants';
import { Propagator, STATE_STRIDE, sampleOrbit, toOmm } from './propagator';

const epochOf = (record: SatelliteRecord) => Date.parse(record.elements.epoch);

function radius(state: Float32Array, index: number): number {
  const o = index * STATE_STRIDE;
  return Math.hypot(state[o], state[o + 1], state[o + 2]);
}

function speedOf(state: Float32Array, index: number): number {
  const o = index * STATE_STRIDE;
  return Math.hypot(state[o + 3], state[o + 4], state[o + 5]);
}

const unusable: SatelliteRecord = {
  ...iss,
  noradId: 99999,
  name: 'UNUSABLE',
  elements: { ...iss.elements, eccentricity: 1.5 },
};

describe('Propagator', () => {
  it('propagates every fixture to a physically sensible state', () => {
    const propagator = new Propagator(fixtures);
    const state = new Float32Array(fixtures.length * STATE_STRIDE);

    const propagated = propagator.propagate(epochOf(iss), state);

    expect(propagated).toBe(fixtures.length);
    expect(propagator.invalid).toEqual([]);
    for (let i = 0; i < fixtures.length; i++) {
      expect(radius(state, i)).toBeGreaterThan(EARTH_RADIUS_KM + 150);
      expect(speedOf(state, i)).toBeGreaterThan(1);
      expect(speedOf(state, i)).toBeLessThan(11);
    }
  });

  it('puts the ISS at ~420 km moving at ~7.66 km/s', () => {
    const state = new Float32Array(STATE_STRIDE);
    new Propagator([iss]).propagate(epochOf(iss), state);

    expect(radius(state, 0) - EARTH_RADIUS_KM).toBeGreaterThan(400);
    expect(radius(state, 0) - EARTH_RADIUS_KM).toBeLessThan(440);
    expect(speedOf(state, 0)).toBeCloseTo(7.66, 1);
  });

  it("agrees with satellite.js's date-based propagation", () => {
    // Guards the epoch arithmetic this class does itself to skip per-call Date work.
    const timeMs = epochOf(geostationary) + 3 * 3_600_000 + 123;
    const state = new Float32Array(STATE_STRIDE);
    new Propagator([geostationary]).propagate(timeMs, state);

    const reference = propagate(json2satrec(toOmm(geostationary)), new Date(timeMs));

    // Tolerance: float32 storage at a 42,000 km radius, plus sub-millisecond
    // differences in how the two paths round the epoch.
    expect(reference).not.toBeNull();
    expect(state[0]).toBeCloseTo(reference?.position.x ?? Number.NaN, 1);
    expect(state[1]).toBeCloseTo(reference?.position.y ?? Number.NaN, 1);
    expect(state[2]).toBeCloseTo(reference?.position.z ?? Number.NaN, 1);
    expect(state[3]).toBeCloseTo(reference?.velocity.x ?? Number.NaN, 4);
  });

  it('writes zeros for a satellite it cannot propagate, without disturbing its neighbours', () => {
    const propagator = new Propagator([iss, unusable, geostationary]);
    const state = new Float32Array(3 * STATE_STRIDE).fill(123);

    const propagated = propagator.propagate(epochOf(iss), state);

    expect(propagated).toBe(2);
    expect([...state.subarray(STATE_STRIDE, 2 * STATE_STRIDE)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(radius(state, 0)).toBeGreaterThan(EARTH_RADIUS_KM);
    expect(radius(state, 2)).toBeGreaterThan(EARTH_RADIUS_KM);
  });

  it('rejects a state buffer that is too small', () => {
    const propagator = new Propagator(fixtures);
    expect(() => propagator.propagate(epochOf(iss), new Float32Array(STATE_STRIDE))).toThrow(
      RangeError,
    );
  });
});

describe('sampleOrbit', () => {
  it('returns a closed loop: one full revolution ends where it began', () => {
    const segments = 64;
    const points = sampleOrbit(iss, epochOf(iss), segments);

    expect(points).toHaveLength((segments + 1) * 3);
    if (!points) return;
    const gap = Math.hypot(
      points[0] - points[segments * 3],
      points[1] - points[segments * 3 + 1],
      points[2] - points[segments * 3 + 2],
    );
    // Not exactly closed: the orbit precesses and decays slightly each revolution.
    expect(gap).toBeLessThan(50);
  });

  it('keeps every sample on the orbit', () => {
    const points = sampleOrbit(geostationary, epochOf(geostationary), 32);
    if (!points) throw new Error('expected an orbit');
    for (let i = 0; i < points.length; i += 3) {
      const altitude = Math.hypot(points[i], points[i + 1], points[i + 2]) - EARTH_RADIUS_KM;
      expect(altitude).toBeGreaterThan(35_700);
      expect(altitude).toBeLessThan(35_900);
    }
  });

  it('returns null for elements that cannot be propagated', () => {
    expect(sampleOrbit(unusable, epochOf(iss), 16)).toBeNull();
  });
});
