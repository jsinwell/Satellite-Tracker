import { EARTH_MU, EARTH_RADIUS_KM } from './constants';
import { STATE_STRIDE } from './propagator';

/**
 * Between SGP4 updates, satellites are advanced with a second-order Taylor
 * step under point-mass gravity:
 *
 *   p(dt) = p + v·dt + ½·a·dt²,  a = −μ·p / |p|³
 *
 * The truncation error is the jerk term, roughly |a|·ω·dt³/6. In low orbit
 * that is ~2 m after 10 s and ~1.5 km after 100 s, so the worker only has to
 * keep the propagated state within a few seconds (of simulated time) of the
 * clock for the result to be visually exact.
 *
 * The vertex shader in `scene/Satellites.tsx` implements the same step on the
 * GPU. The two must stay in agreement, or picking drifts from what is drawn.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** True if the state buffer holds a real state for satellite `index`. */
export function hasState(state: Float32Array, index: number): boolean {
  const o = index * STATE_STRIDE;
  return state[o] !== 0 || state[o + 1] !== 0 || state[o + 2] !== 0;
}

/**
 * Position (km, TEME) of satellite `index`, `dtSeconds` after the instant the
 * state buffer was propagated to. Writes into and returns `out`.
 */
export function extrapolatePosition(
  state: Float32Array,
  index: number,
  dtSeconds: number,
  out: Vec3,
): Vec3 {
  const o = index * STATE_STRIDE;
  const px = state[o];
  const py = state[o + 1];
  const pz = state[o + 2];
  const r2 = px * px + py * py + pz * pz;
  // ½·a·dt² = k·p, with k = −½·μ·dt² / |p|³
  const k = r2 > 0 ? (-0.5 * EARTH_MU * dtSeconds * dtSeconds) / (r2 * Math.sqrt(r2)) : 0;
  out.x = px + state[o + 3] * dtSeconds + k * px;
  out.y = py + state[o + 4] * dtSeconds + k * py;
  out.z = pz + state[o + 5] * dtSeconds + k * pz;
  return out;
}

/**
 * Velocity (km/s, TEME) of satellite `index`, `dtSeconds` after the instant
 * the state buffer was propagated to: v + a·dt, to go with the position above.
 * Writes into and returns `out`.
 */
export function extrapolateVelocity(
  state: Float32Array,
  index: number,
  dtSeconds: number,
  out: Vec3,
): Vec3 {
  const o = index * STATE_STRIDE;
  const px = state[o];
  const py = state[o + 1];
  const pz = state[o + 2];
  const r2 = px * px + py * py + pz * pz;
  // a·dt = k·p, with k = −μ·dt / |p|³
  const k = r2 > 0 ? (-EARTH_MU * dtSeconds) / (r2 * Math.sqrt(r2)) : 0;
  out.x = state[o + 3] + k * px;
  out.y = state[o + 4] + k * py;
  out.z = state[o + 5] + k * pz;
  return out;
}

/** Speed (km/s) of satellite `index` in the inertial frame. */
export function speed(state: Float32Array, index: number): number {
  const o = index * STATE_STRIDE;
  return Math.hypot(state[o + 3], state[o + 4], state[o + 5]);
}

/**
 * True if the straight line from `eye` to `target` passes through the Earth
 * (modeled as a sphere of equatorial radius). Both points in km, same frame.
 */
export function isOccludedByEarth(eye: Vec3, target: Vec3): boolean {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const dz = target.z - eye.z;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared === 0) return false;
  // Parameter of the point on the segment closest to the Earth's center.
  const t = Math.min(1, Math.max(0, -(eye.x * dx + eye.y * dy + eye.z * dz) / lengthSquared));
  const cx = eye.x + t * dx;
  const cy = eye.y + t * dy;
  const cz = eye.z + t * dz;
  return cx * cx + cy * cy + cz * cz < EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

/** A trail shows where a satellite was this long ago, in real seconds. */
const TRAIL_REAL_SECONDS = 0.12;
/** Below this many simulated seconds a trail is shorter than the dot it follows. */
const MIN_TRAIL_SECONDS = 1;
/**
 * Long enough to read as motion, short enough that twenty thousand of them do
 * not bury the globe: about 570 km in low orbit. It also keeps the far end
 * well within reach of the extrapolation the trails are drawn with.
 */
const MAX_TRAIL_SECONDS = 75;

/**
 * How far back in simulated time a satellite's trail reaches at a given time
 * rate. Zero at ordinary speeds, where a trail would be invisible; negative
 * when time runs backwards, so the trail still follows the motion on screen.
 */
export function trailSeconds(rate: number): number {
  const seconds = Math.min(MAX_TRAIL_SECONDS, Math.abs(rate) * TRAIL_REAL_SECONDS);
  return seconds < MIN_TRAIL_SECONDS ? 0 : Math.sign(rate) * seconds;
}
