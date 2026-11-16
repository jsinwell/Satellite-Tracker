import { describe, expect, it } from 'vitest';
import { highlyElliptical, iss } from './__fixtures__/satellites';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM } from './constants';
import { extrapolatePosition, hasState, isOccludedByEarth, speed, type Vec3 } from './kinematics';
import { Propagator, STATE_STRIDE } from './propagator';

const origin = (): Vec3 => ({ x: 0, y: 0, z: 0 });

/** Distance (km) between extrapolating `dtSeconds` ahead and asking SGP4 directly. */
function extrapolationError(record: SatelliteRecord, dtSeconds: number): number {
  const propagator = new Propagator([record]);
  const t0 = Date.parse(record.elements.epoch);
  const start = new Float32Array(STATE_STRIDE);
  const truth = new Float32Array(STATE_STRIDE);
  propagator.propagate(t0, start);
  propagator.propagate(t0 + dtSeconds * 1000, truth);

  const estimate = extrapolatePosition(start, 0, dtSeconds, origin());
  return Math.hypot(estimate.x - truth[0], estimate.y - truth[1], estimate.z - truth[2]);
}

describe('extrapolatePosition', () => {
  it('returns the stored position when dt is zero', () => {
    const state = Float32Array.of(7000, 100, -200, 1, 7, 2);
    expect(extrapolatePosition(state, 0, 0, origin())).toEqual({ x: 7000, y: 100, z: -200 });
  });

  // These bounds are the contract the renderer's refresh policy relies on:
  // the simulation keeps |dt| within a second or two at 1× speed, and within
  // roughly a minute at the highest time rate.
  it.each([
    [1, 0.005],
    [-1, 0.005],
    [10, 0.01],
    [60, 0.5],
    [-60, 0.5],
  ])('tracks SGP4 in low orbit: dt = %d s is within %d km', (dtSeconds, toleranceKm) => {
    expect(extrapolationError(iss, dtSeconds)).toBeLessThan(toleranceKm);
  });

  it('tracks SGP4 on a highly elliptical orbit', () => {
    expect(extrapolationError(highlyElliptical, 10)).toBeLessThan(0.02);
  });

  it('is far better than a straight line', () => {
    const state = new Float32Array(STATE_STRIDE);
    const truth = new Float32Array(STATE_STRIDE);
    const propagator = new Propagator([iss]);
    const t0 = Date.parse(iss.elements.epoch);
    propagator.propagate(t0, state);
    propagator.propagate(t0 + 60_000, truth);

    const linearError = Math.hypot(
      state[0] + state[3] * 60 - truth[0],
      state[1] + state[4] * 60 - truth[1],
      state[2] + state[5] * 60 - truth[2],
    );
    expect(linearError).toBeGreaterThan(10);
    expect(extrapolationError(iss, 60)).toBeLessThan(linearError / 20);
  });
});

describe('hasState', () => {
  it('treats an all-zero position as absent', () => {
    const state = Float32Array.of(0, 0, 0, 0, 0, 0, 7000, 0, 0, 0, 7.5, 0);
    expect(hasState(state, 0)).toBe(false);
    expect(hasState(state, 1)).toBe(true);
  });
});

describe('speed', () => {
  it('is the magnitude of the velocity', () => {
    expect(speed(Float32Array.of(7000, 0, 0, 3, 4, 0), 0)).toBeCloseTo(5);
  });
});

describe('isOccludedByEarth', () => {
  const eye = { x: 4 * EARTH_RADIUS_KM, y: 0, z: 0 };

  it('sees a satellite on the near side', () => {
    expect(isOccludedByEarth(eye, { x: EARTH_RADIUS_KM + 400, y: 0, z: 0 })).toBe(false);
  });

  it('does not see a satellite directly behind the Earth', () => {
    expect(isOccludedByEarth(eye, { x: -(EARTH_RADIUS_KM + 400), y: 0, z: 0 })).toBe(true);
  });

  it('sees a far-side satellite that clears the limb', () => {
    expect(isOccludedByEarth(eye, { x: -EARTH_RADIUS_KM, y: 3 * EARTH_RADIUS_KM, z: 0 })).toBe(
      false,
    );
  });

  it('sees a satellite off to the side, beyond the closest approach to the Earth', () => {
    expect(isOccludedByEarth(eye, { x: 0, y: EARTH_RADIUS_KM + 400, z: 0 })).toBe(false);
  });
});
