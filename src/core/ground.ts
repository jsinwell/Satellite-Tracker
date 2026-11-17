import { gmst } from './astro';
import type { OrbitalElements, SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY } from './constants';
import type { Vec3 } from './kinematics';
import { samplePositions } from './propagator';

const TWO_PI = 2 * Math.PI;

/**
 * Solves Kepler's equation, M = E − e·sin E, for the eccentric anomaly E.
 * Both angles in radians; any number of whole revolutions is carried through.
 */
export function eccentricAnomaly(meanAnomaly: number, eccentricity: number): number {
  const revolutions = Math.floor(meanAnomaly / TWO_PI);
  const m = meanAnomaly - revolutions * TWO_PI;
  // Newton's method. Starting from π converges for every eccentricity below 1.
  let e = Math.PI;
  for (let i = 0; i < 20; i++) {
    const step = (e - eccentricity * Math.sin(e) - m) / (1 - eccentricity * Math.cos(e));
    e -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return e + revolutions * TWO_PI;
}

/**
 * `segments + 1` instants spread over a stretch of an orbit, from
 * `revolutionsBehind` before `timeMs` to `revolutionsAhead` after it.
 *
 * They are evenly spaced around the ellipse (in eccentric anomaly), not in
 * time. A satellite on an eccentric orbit sweeps most of the way around the
 * Earth in the few minutes around perigee, and even steps in time would draw
 * that stretch as a handful of long straight lines.
 */
export function sweepTimes(
  elements: OrbitalElements,
  timeMs: number,
  revolutionsBehind: number,
  revolutionsAhead: number,
  segments: number,
  out: Float64Array = new Float64Array(segments + 1),
): Float64Array {
  const { eccentricity } = elements;
  const radiansPerMs = (elements.meanMotion * TWO_PI) / MS_PER_DAY;
  const meanNow =
    (elements.meanAnomaly * Math.PI) / 180 + radiansPerMs * (timeMs - Date.parse(elements.epoch));
  // Only the fraction of a revolution matters, and it keeps the numbers small.
  const mean = meanNow - Math.floor(meanNow / TWO_PI) * TWO_PI;
  const eccentric = eccentricAnomaly(mean, eccentricity);

  const sweep = (revolutionsBehind + revolutionsAhead) * TWO_PI;
  for (let i = 0; i <= segments; i++) {
    const e = eccentric - revolutionsBehind * TWO_PI + (sweep * i) / segments;
    out[i] = timeMs + (e - eccentricity * Math.sin(e) - mean) / radiansPerMs;
  }
  return out;
}

/**
 * The ground track of a satellite: the point on the Earth directly beneath it
 * at each of `timesMs`, three floats per instant. Null if it cannot be
 * propagated to all of them.
 *
 * The points are in Earth-fixed axes (z through the north pole, x through 0°
 * longitude), `radiusKm` from the center, so the track stays put on the ground
 * as the Earth turns. "Beneath" is toward the Earth's center, which is where a
 * line dropped from the satellite meets the globe as it is drawn.
 */
export function groundTrack(
  record: SatelliteRecord,
  timesMs: ArrayLike<number>,
  radiusKm: number,
  out: Float32Array = new Float32Array(timesMs.length * 3),
): Float32Array | null {
  if (!samplePositions(record, timesMs, out)) return null;
  for (let i = 0; i < timesMs.length; i++) {
    const o = i * 3;
    const x = out[o];
    const y = out[o + 1];
    const z = out[o + 2];
    // Inertial to Earth-fixed: undo the Earth's rotation since the equinox.
    const angle = gmst(timesMs[i]);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = radiusKm / Math.hypot(x, y, z);
    out[o] = (x * cos + y * sin) * scale;
    out[o + 1] = (y * cos - x * sin) * scale;
    out[o + 2] = z * scale;
  }
  return out;
}

/**
 * How far around the Earth a satellite can see: the angle at the Earth's
 * center, radians, between the point beneath it and its horizon. `radiusKm` is
 * the satellite's distance from the center.
 */
export function horizonAngle(radiusKm: number): number {
  return Math.acos(Math.min(1, EARTH_RADIUS_KM / radiusKm));
}

/**
 * The width of a satellite's footprint, km, measured over the ground. The
 * footprint is the region from which the satellite is above the horizon.
 */
export function footprintWidthKm(radiusKm: number): number {
  return 2 * EARTH_RADIUS_KM * horizonAngle(radiusKm);
}

/**
 * The edge of the footprint of a satellite at `position` (km): `segments`
 * points around a circle, `radiusKm` from the Earth's center, in the same axes
 * as `position`.
 */
export function footprintCircle(
  position: Vec3,
  segments: number,
  radiusKm: number,
  out: Float32Array = new Float32Array(segments * 3),
): Float32Array {
  const distance = Math.hypot(position.x, position.y, position.z);
  const ux = position.x / distance;
  const uy = position.y / distance;
  const uz = position.z / distance;
  // Two axes at right angles to the satellite's direction and to each other.
  // Crossing with z fails over the poles, so cross with x there instead.
  const overPole = Math.abs(uz) > 0.9;
  let ax = overPole ? 0 : -uy;
  let ay = overPole ? uz : ux;
  let az = overPole ? -uy : 0;
  const length = Math.hypot(ax, ay, az);
  ax /= length;
  ay /= length;
  az /= length;
  const bx = uy * az - uz * ay;
  const by = uz * ax - ux * az;
  const bz = ux * ay - uy * ax;

  const angle = horizonAngle(distance);
  const along = radiusKm * Math.cos(angle);
  const across = radiusKm * Math.sin(angle);
  for (let i = 0; i < segments; i++) {
    const turn = (i / segments) * TWO_PI;
    const a = across * Math.cos(turn);
    const b = across * Math.sin(turn);
    out[i * 3] = along * ux + a * ax + b * bx;
    out[i * 3 + 1] = along * uy + a * ay + b * by;
    out[i * 3 + 2] = along * uz + a * az + b * bz;
  }
  return out;
}
