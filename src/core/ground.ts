import { gmst } from './astro';
import type { OrbitalElements, SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY } from './constants';
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

/** Round clock intervals, minutes, to mark along a ground track. All divide a day. */
const MARK_STEPS_MINUTES = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720];
/** More marks than this on one revolution crowd each other. */
export const MAX_MARKS_PER_REVOLUTION = 12;
const MS_PER_MINUTE = 60_000;

/**
 * How often to mark the time along the ground track of an orbit with period
 * `periodMs`: the shortest round interval that leaves no more than
 * `MAX_MARKS_PER_REVOLUTION` marks on a revolution. Every ten minutes in low
 * orbit, every hour or two further out.
 */
export function markStepMs(periodMs: number): number {
  const minutes =
    MARK_STEPS_MINUTES.find(
      (step) => periodMs / (step * MS_PER_MINUTE) <= MAX_MARKS_PER_REVOLUTION,
    ) ?? MARK_STEPS_MINUTES[MARK_STEPS_MINUTES.length - 1];
  return minutes * MS_PER_MINUTE;
}

/**
 * The instants after `fromMs`, up to and including `toMs`, that are whole
 * multiples of `stepMs` since midnight UTC: 11:10, 11:20, 11:30 rather than
 * 11:07, 11:17, 11:27. No more than `limit` of them.
 */
export function markTimes(fromMs: number, toMs: number, stepMs: number, limit: number): number[] {
  const times: number[] = [];
  for (let t = (Math.floor(fromMs / stepMs) + 1) * stepMs; t <= toMs; t += stepMs) {
    if (times.length === limit) break;
    times.push(t);
  }
  return times;
}
