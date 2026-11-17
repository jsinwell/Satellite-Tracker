import { moonPosition, sunPosition } from './astro';
import { EARTH_RADIUS_KM } from './constants';
import type { Vec3 } from './kinematics';
import { lookAngles, type Observer, observerFrame } from './observer';

/**
 * Eclipses, worked out from where things are rather than looked up: how much
 * of the Sun's disc something hides, seen from a given point. The same
 * geometry runs on the GPU, per point of the Earth's and the Moon's surfaces,
 * in `scene/eclipseGlsl.ts`; the two must stay in step.
 */

/** The Sun's radius, as the IAU gives it. */
export const SUN_RADIUS_KM = 695_700;
/** The Moon's mean radius. */
export const MOON_RADIUS_KM = 1737.4;
/**
 * The radius the Moon casts its shadow with, as NASA's eclipse predictions
 * take it: 0.272281 Earth radii, a little under the mean, since sunlight
 * shines through the valleys along its edge. It decides where and for how
 * long an eclipse is total.
 */
export const MOON_SHADOW_RADIUS_KM = 0.272281 * EARTH_RADIUS_KM;
/**
 * The Earth's shadow on the Moon is about 2% wider than the Earth alone would
 * cast: the atmosphere blocks the grazing sunlight too. This is the usual
 * allowance in eclipse predictions.
 */
export const EARTH_SHADOW_RADIUS_KM = EARTH_RADIUS_KM * 1.02;

/**
 * What fraction of a disc of angular radius `body` is covered by one of
 * angular radius `cover` whose center is `separation` away, all in radians.
 * Treats the sky as flat, which for discs half a degree across is exact to
 * well under a part in a million. Brightness is taken as even across the
 * Sun's face; in fact its edge is darker, so a partly covered Sun is a little
 * brighter than this suggests.
 */
export function discCoverage(body: number, cover: number, separation: number): number {
  if (separation >= body + cover) return 0;
  if (separation <= Math.abs(cover - body)) {
    // One inside the other: totality, or a ring around a smaller Moon.
    return cover >= body ? 1 : (cover * cover) / (body * body);
  }
  // The lens where two circles overlap.
  const d = separation;
  const a = Math.acos(
    Math.min(1, Math.max(-1, (d * d + body * body - cover * cover) / (2 * d * body))),
  );
  const b = Math.acos(
    Math.min(1, Math.max(-1, (d * d + cover * cover - body * body) / (2 * d * cover))),
  );
  const kite = Math.sqrt(
    Math.max(0, (-d + body + cover) * (d + body - cover) * (d - body + cover) * (d + body + cover)),
  );
  const lens = body * body * a + cover * cover * b - kite / 2;
  return Math.min(1, lens / (Math.PI * body * body));
}

/** The angle between the directions from `from` to `a` and to `b`, radians. Precise when small. */
function angleBetween(from: Vec3, a: Vec3, b: Vec3): number {
  const ax = a.x - from.x;
  const ay = a.y - from.y;
  const az = a.z - from.z;
  const bx = b.x - from.x;
  const by = b.y - from.y;
  const bz = b.z - from.z;
  const cross = Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
  return Math.atan2(cross, ax * bx + ay * by + az * bz);
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * How much of the Sun the Moon hides, seen from `point`: 0 outside the
 * Moon's shadow, 1 in totality. Everything in km, same inertial frame, the
 * Earth's center at the origin.
 */
export function sunHiddenByMoon(point: Vec3, sun: Vec3, moon: Vec3): number {
  return discCoverage(
    Math.asin(SUN_RADIUS_KM / distance(point, sun)),
    Math.asin(MOON_SHADOW_RADIUS_KM / distance(point, moon)),
    angleBetween(point, sun, moon),
  );
}

/**
 * How much of the Sun the Earth hides, seen from `point`: a point on the Moon,
 * say, for a lunar eclipse. Everything in km, the Earth's center at the
 * origin.
 */
export function sunHiddenByEarth(point: Vec3, sun: Vec3): number {
  return discCoverage(
    Math.asin(SUN_RADIUS_KM / distance(point, sun)),
    Math.asin(Math.min(1, EARTH_SHADOW_RADIUS_KM / distance(point, ORIGIN))),
    angleBetween(point, sun, ORIGIN),
  );
}

export type EclipseView =
  /** The Moon in front of the Sun, `covered` being how much of it, 1 in totality. */
  | { kind: 'solar'; covered: number }
  /** The Moon in the Earth's shadow: wholly, or still in its faint outer edge. */
  | { kind: 'lunar'; inUmbra: boolean };

/**
 * The eclipse an observer could see at `timeMs`, if any: a solar one with the
 * Sun above their horizon, or a lunar one with the Moon above it.
 */
export function eclipseFrom(observer: Observer, timeMs: number): EclipseView | null {
  const frame = observerFrame(observer, timeMs);
  const sun = sunPosition(timeMs, { x: 0, y: 0, z: 0 });
  const moon = moonPosition(timeMs, { x: 0, y: 0, z: 0 });
  if (lookAngles(frame, sun).elevation > 0) {
    const covered = sunHiddenByMoon(frame.position, sun, moon);
    if (covered > 0) return { kind: 'solar', covered };
  }
  if (lookAngles(frame, moon).elevation > 0) {
    const shadow = sunHiddenByEarth(moon, sun);
    if (shadow > 0) return { kind: 'lunar', inUmbra: shadow >= 1 };
  }
  return null;
}
