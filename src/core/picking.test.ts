import { Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM } from './constants';
import { type PickQuery, pickSatellite } from './picking';
import { STATE_STRIDE } from './propagator';

const viewport = { width: 800, height: 600 };
const center = { x: 400, y: 300 };
const eye = { x: 30_000, y: 0, z: 0 };
const NEAR_SIDE = EARTH_RADIUS_KM + 500;

/** A camera on the +x axis looking at the Earth's center, working directly in kilometers. */
function clipMatrix(): number[] {
  const camera = new PerspectiveCamera(40, viewport.width / viewport.height, 100, 200_000);
  camera.position.set(eye.x, eye.y, eye.z);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return new Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .toArray();
}

/** Builds a state buffer from [x, y, z, vx, vy, vz] rows. */
function states(...rows: number[][]): Float32Array {
  const state = new Float32Array(rows.length * STATE_STRIDE);
  rows.forEach((row, i) => {
    state.set(row, i * STATE_STRIDE);
  });
  return state;
}

function query(state: Float32Array, overrides: Partial<PickQuery> = {}): PickQuery {
  const count = state.length / STATE_STRIDE;
  return {
    state,
    count,
    dtSeconds: 0,
    visible: new Uint8Array(count).fill(1),
    clipFromTeme: clipMatrix(),
    eye,
    pointer: center,
    viewport,
    radiusPx: 10,
    ...overrides,
  };
}

describe('pickSatellite', () => {
  it('picks the satellite under the pointer', () => {
    const state = states([NEAR_SIDE, 0, 0, 0, 0, 0], [NEAR_SIDE, 3000, 0, 0, 0, 0]);
    expect(pickSatellite(query(state))).toBe(0);
  });

  it('returns -1 when nothing is within the pick radius', () => {
    const state = states([NEAR_SIDE, 3000, 0, 0, 0, 0]);
    expect(pickSatellite(query(state))).toBe(-1);
  });

  it('prefers the satellite closest to the pointer on screen', () => {
    const state = states([NEAR_SIDE, 60, 0, 0, 0, 0], [NEAR_SIDE, 0, 20, 0, 0, 0]);
    expect(pickSatellite(query(state))).toBe(1);
  });

  it('maps screen directions the right way round', () => {
    // With +z up and the camera on +x looking toward −x, +y is to the right
    // (forward × up). Screen y grows downward, so +z is toward smaller y.
    const right = states([NEAR_SIDE, 2000, 0, 0, 0, 0]);
    const up = states([NEAR_SIDE, 0, 2000, 0, 0, 0]);
    const columns = [...Array(viewport.width).keys()];
    const rows = [...Array(viewport.height).keys()];

    const hitColumn = columns.find(
      (x) => pickSatellite(query(right, { pointer: { x, y: center.y }, radiusPx: 2 })) === 0,
    );
    const hitRow = rows.find(
      (y) => pickSatellite(query(up, { pointer: { x: center.x, y }, radiusPx: 2 })) === 0,
    );

    expect(hitColumn).toBeGreaterThan(center.x + 20);
    expect(hitRow).toBeLessThan(center.y - 20);
  });

  it('ignores satellites hidden behind the Earth', () => {
    const state = states([-NEAR_SIDE, 0, 0, 0, 0, 0]);
    expect(pickSatellite(query(state))).toBe(-1);
  });

  it('ignores satellites that are filtered out', () => {
    const state = states([NEAR_SIDE, 0, 0, 0, 0, 0]);
    expect(pickSatellite(query(state, { visible: Uint8Array.of(0) }))).toBe(-1);
  });

  it('ignores satellites with no propagated state', () => {
    const state = states([0, 0, 0, 0, 0, 0]);
    expect(pickSatellite(query(state, { eye: { x: 0, y: 0, z: 30_000 } }))).toBe(-1);
  });

  it('ignores satellites behind the camera', () => {
    const state = states([60_000, 0, 0, 0, 0, 0]);
    expect(pickSatellite(query(state))).toBe(-1);
  });

  it('picks where the satellite is drawn now, not where its state was computed', () => {
    // Moving in +y (screen-right) at 7.5 km/s: after 100 s it is ~750 km from
    // its stored position and no longer under the pointer.
    const state = states([NEAR_SIDE, 0, 0, 0, 7.5, 0]);
    expect(pickSatellite(query(state, { dtSeconds: 0 }))).toBe(0);
    expect(pickSatellite(query(state, { dtSeconds: 100 }))).toBe(-1);
  });
});
