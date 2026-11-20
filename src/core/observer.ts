import { geodeticToEcf } from 'satellite.js';
import { gmst, shadowDepth, sunDirection } from './astro';
import { FAINTEST, faintestSeen, magnitudeFrom, standardMagnitude } from './brightness';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY } from './constants';
import { extrapolatePosition, hasState, type Vec3 } from './kinematics';
import { positionFunction } from './propagator';

const DEG = Math.PI / 180;

/** Somewhere on the ground, at sea level. */
export interface Observer {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive. */
  longitude: number;
}

/** True for a latitude and longitude, in degrees, that are somewhere on Earth. */
export function isObserver(value: unknown): value is Observer {
  if (typeof value !== 'object' || value === null) return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

const COORDINATE = /^([+-]?\d+(?:\.\d*)?)\s*°?\s*([NSEW])?$/i;

/**
 * Reads a place typed as two coordinates, latitude first, in the forms people
 * paste from maps: `41.88, -87.63`, `41.88 -87.63` or `41.88° N, 87.63° W`.
 * Null if it is not one.
 */
export function parseCoordinates(text: string): Observer | null {
  const parts = text.trim().split(/\s*[,;]\s*|\s+(?=[+-]?\d)/);
  if (parts.length !== 2) return null;
  const values = parts.map((part, i) => {
    const match = COORDINATE.exec(part);
    if (!match) return Number.NaN;
    const hemisphere = match[2]?.toUpperCase();
    // A hemisphere letter has to suit its place: N or S first, E or W second.
    if (hemisphere && !(i === 0 ? 'NS' : 'EW').includes(hemisphere)) return Number.NaN;
    const magnitude = Number(match[1]);
    return hemisphere === 'S' || hemisphere === 'W' ? -magnitude : magnitude;
  });
  const observer = { latitude: values[0], longitude: values[1] };
  return isObserver(observer) ? observer : null;
}

/**
 * An observer at one instant, in the inertial frame satellites are computed
 * in: where they are (km), and which way is up, east and north for them. The
 * Earth's rotation is in these, so they hold for that instant only.
 */
export interface ObserverFrame {
  position: Vec3;
  up: Vec3;
  east: Vec3;
  north: Vec3;
}

const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });

export function createObserverFrame(): ObserverFrame {
  return { position: vec(), up: vec(), east: vec(), north: vec() };
}

/** Rotates an Earth-fixed vector into the inertial frame, `angle` radians on. */
function toInertial(x: number, y: number, z: number, cos: number, sin: number, out: Vec3): void {
  out.x = x * cos - y * sin;
  out.y = x * sin + y * cos;
  out.z = z;
}

/** Fills `out` with `observer`'s frame at `timeMs`. */
export function observerFrame(
  observer: Observer,
  timeMs: number,
  out: ObserverFrame = createObserverFrame(),
): ObserverFrame {
  const latitude = observer.latitude * DEG;
  const longitude = observer.longitude * DEG;
  const angle = gmst(timeMs);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // On the WGS-84 ellipsoid, with "up" square to it rather than pointing
  // through the Earth's center, as a plumb line and an astronomer's would.
  const ecf = geodeticToEcf({ latitude, longitude, height: 0 });
  const cosLat = Math.cos(latitude);
  const sinLat = Math.sin(latitude);
  const cosLon = Math.cos(longitude);
  const sinLon = Math.sin(longitude);
  toInertial(ecf.x, ecf.y, ecf.z, cos, sin, out.position);
  toInertial(cosLat * cosLon, cosLat * sinLon, sinLat, cos, sin, out.up);
  toInertial(-sinLon, cosLon, 0, cos, sin, out.east);
  toInertial(-sinLat * cosLon, -sinLat * sinLon, cosLat, cos, sin, out.north);
  return out;
}

export interface LookAngles {
  /** Degrees clockwise from north, in [0, 360). */
  azimuth: number;
  /** Degrees above the horizon; negative below it. */
  elevation: number;
  rangeKm: number;
}

/** Where the observer would look to see something at `target` (inertial, km). */
export function lookAngles(
  frame: ObserverFrame,
  target: Vec3,
  out: LookAngles = { azimuth: 0, elevation: 0, rangeKm: 0 },
): LookAngles {
  const dx = target.x - frame.position.x;
  const dy = target.y - frame.position.y;
  const dz = target.z - frame.position.z;
  const range = Math.hypot(dx, dy, dz);
  const up = dx * frame.up.x + dy * frame.up.y + dz * frame.up.z;
  const east = dx * frame.east.x + dy * frame.east.y + dz * frame.east.z;
  const north = dx * frame.north.x + dy * frame.north.y + dz * frame.north.z;
  const azimuth = Math.atan2(east, north) / DEG;
  out.azimuth = azimuth < 0 ? azimuth + 360 : azimuth;
  out.elevation = Math.asin(Math.max(-1, Math.min(1, up / range))) / DEG;
  out.rangeKm = range;
  return out;
}

/**
 * Where the observer would look for something so far away that only its
 * direction matters, like a planet: `direction` is a unit vector, inertial.
 * The range is left as infinite.
 */
export function directionAngles(
  frame: ObserverFrame,
  direction: Vec3,
  out: LookAngles = { azimuth: 0, elevation: 0, rangeKm: 0 },
): LookAngles {
  const { up, east, north } = frame;
  const along = (axis: Vec3) => direction.x * axis.x + direction.y * axis.y + direction.z * axis.z;
  const azimuth = Math.atan2(along(east), along(north)) / DEG;
  out.azimuth = azimuth < 0 ? azimuth + 360 : azimuth;
  out.elevation = Math.asin(Math.max(-1, Math.min(1, along(up)))) / DEG;
  out.rangeKm = Number.POSITIVE_INFINITY;
  return out;
}

/** How high the Sun is for the observer, degrees: negative once it has set. */
export function sunElevation(frame: ObserverFrame, sun: Vec3): number {
  const up = sun.x * frame.up.x + sun.y * frame.up.y + sun.z * frame.up.z;
  return Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
}

/**
 * Satellites shine by reflected sunlight, so they can only be seen once the
 * sky has darkened: from the end of civil twilight, with the Sun 6° below the
 * horizon. That is also when they are most often lit against a dark sky,
 * before the Earth's shadow climbs up to them.
 */
export const DARK_SKY_SUN_ELEVATION = -6;
/** Lower than this, haze and the landscape get in the way. */
export const MIN_VIEWING_ELEVATION = 10;

/** The Sun's elevation, degrees, at which sunrise and sunset happen, refraction included. */
const SUNSET_ELEVATION = -0.833;

export type SkyState = 'day' | 'twilight' | 'dark';

export function skyState(sunElevationDeg: number): SkyState {
  if (sunElevationDeg > SUNSET_ELEVATION) return 'day';
  return sunElevationDeg > DARK_SKY_SUN_ELEVATION ? 'twilight' : 'dark';
}

/**
 * True if a satellite could be seen with the naked eye: in sunlight, well
 * up, and brighter than the faintest thing the sky lets through, which by
 * twilight is not much. `magnitude` is how bright it is from here, lit or
 * not: see `brightness.ts`, which also says how much of a guess that is.
 * So this is "worth looking for" rather than a promise.
 */
export function canBeSeen(
  look: Pick<LookAngles, 'elevation'>,
  sunlit: boolean,
  sunElevationDeg: number,
  magnitude: number,
): boolean {
  return (
    sunlit &&
    look.elevation >= MIN_VIEWING_ELEVATION &&
    magnitude <= faintestSeen('eye', sunElevationDeg)
  );
}

export interface SkyEntry {
  index: number;
  azimuth: number;
  elevation: number;
  /** Whether it shows right now, by eye or in binoculars as asked: see `skyNow`. */
  seeable: boolean;
}

export interface SkyNow {
  sunElevation: number;
  /** Everything above the horizon, the ones that can be seen first, then highest first. */
  above: SkyEntry[];
  /** How many of `above` can be seen. */
  seeable: number;
  /**
   * How many of `above` are bright enough to see under a dark sky, sunlit or
   * not. The difference from `seeable` is the ones that would be seen but
   * for the Earth's shadow, or the sky being too bright.
   */
  withinReach: number;
}

const position = vec();
const sun = vec();
const angles: LookAngles = { azimuth: 0, elevation: 0, rangeKm: 0 };

/**
 * Everything above the observer's horizon at `timeMs`, from the simulation's
 * state buffer (see `kinematics.ts`), leaving out satellites `shown` marks 0.
 * `standardMagnitudes` has each satellite's: see `standardMagnitude`.
 *
 * What counts as seen is what the view from the ground draws, so that the
 * two agree: sunlit, and bright enough for the eye, or for binoculars if
 * that is what `seenWith` says. Not, as for a pass worth going out for, only
 * what is well clear of the horizon: see `canBeSeen`.
 */
export function skyNow(
  frame: ObserverFrame,
  timeMs: number,
  state: Float32Array,
  count: number,
  dtSeconds: number,
  shown: Uint8Array,
  standardMagnitudes: Float32Array,
  seenWith: keyof typeof FAINTEST = 'eye',
): SkyNow {
  sunDirection(timeMs, sun);
  const sunHeight = sunElevation(frame, sun);
  const faintest = faintestSeen(seenWith, sunHeight);
  const above: SkyEntry[] = [];
  let seen = 0;
  let withinReach = 0;
  for (let index = 0; index < count; index++) {
    if (!shown[index] || !hasState(state, index)) continue;
    extrapolatePosition(state, index, dtSeconds, position);
    lookAngles(frame, position, angles);
    if (angles.elevation <= 0) continue;
    const lit = shadowDepth(position, sun) < 0.5;
    const magnitude = magnitudeFrom(standardMagnitudes[index], frame.position, position, sun);
    const entry = {
      index,
      azimuth: angles.azimuth,
      elevation: angles.elevation,
      seeable: lit && magnitude <= faintest,
    };
    if (entry.seeable) seen++;
    if (magnitude <= FAINTEST[seenWith]) withinReach++;
    above.push(entry);
  }
  above.sort((a, b) => Number(b.seeable) - Number(a.seeable) || b.elevation - a.elevation);
  return { sunElevation: sunHeight, above, seeable: seen, withinReach };
}

/**
 * Satellites in low orbit are only lit while the Sun is less than this far
 * below the horizon: any lower and the Earth's shadow reaches past them, even
 * straight overhead. This is the figure for 500 km up, about where most of
 * them are; higher ones stay lit a little longer.
 */
export const LOW_ORBIT_DARK_SUN_ELEVATION =
  -Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + 500)) / DEG;

export interface ViewingWindow {
  startMs: number;
  endMs: number;
}

/**
 * True while the sky is good for spotting satellites, going by how high the
 * Sun is: dark, but with low orbit still in sunlight.
 */
export function goodForSpotting(sunElevationDeg: number): boolean {
  return (
    sunElevationDeg <= DARK_SKY_SUN_ELEVATION && sunElevationDeg >= LOW_ORBIT_DARK_SUN_ELEVATION
  );
}

/** How high the Sun is for `observer` at `timeMs`, degrees. */
export function sunElevationAt(observer: Observer, timeMs: number): number {
  return sunElevation(observerFrame(observer, timeMs, sunFrame), sunDirection(timeMs, sunScratch));
}

const sunFrame = createObserverFrame();
const sunScratch = vec();
const WINDOW_STEP_MS = 120_000;
const WINDOW_TOLERANCE_MS = 30_000;
/** Far enough ahead to always reach the next dusk or dawn, wherever there is one. */
const WINDOW_SEARCH_MS = 36 * 3_600_000;

/**
 * The next stretch of time, from `fromMs` on, that is good for spotting
 * satellites from `observer`: the sky dark, but low orbit still in sunlight.
 * That is the hour or two after dusk and before dawn. If `fromMs` is already
 * in one, it starts at `fromMs`. Null if there is none within a day and a
 * half, as near the poles in summer.
 */
export function nextViewingWindow(observer: Observer, fromMs: number): ViewingWindow | null {
  const good = (timeMs: number) => goodForSpotting(sunElevationAt(observer, timeMs));
  /** The instant between `before` and `after`, where `good` changes, to within the tolerance. */
  const edge = (before: number, after: number): number => {
    const wanted = good(after);
    let low = before;
    let high = after;
    while (high - low > WINDOW_TOLERANCE_MS) {
      const middle = (low + high) / 2;
      if (good(middle) === wanted) high = middle;
      else low = middle;
    }
    return high;
  };

  const until = fromMs + WINDOW_SEARCH_MS;
  let startMs = good(fromMs) ? fromMs : Number.NaN;
  let previous = fromMs;
  for (let t = fromMs + WINDOW_STEP_MS; t <= until; t += WINDOW_STEP_MS) {
    const now = good(t);
    if (Number.isNaN(startMs)) {
      if (now) startMs = edge(previous, t);
    } else if (!now) {
      return { startMs, endMs: edge(previous, t) };
    }
    previous = t;
  }
  return null;
}

export interface Pass {
  riseMs: number;
  setMs: number;
  peakMs: number;
  /** Degrees. */
  peakElevation: number;
  /** Degrees clockwise from north. */
  riseAzimuth: number;
  setAzimuth: number;
  /** When it can be seen with the naked eye during the pass, if at all; see `canBeSeen`. */
  seeable: { fromMs: number; toMs: number } | null;
}

export type PassPrediction =
  | { kind: 'passes'; passes: Pass[] }
  /** Never sets: geostationary, or near it. `elevation` is where it is at the start. */
  | { kind: 'always-up'; elevation: number; azimuth: number };

/** Passes lower than this at their highest are left out: too low to see. */
export const MIN_PASS_ELEVATION = MIN_VIEWING_ELEVATION;

/** Coarse search step. Shorter than any pass worth listing, which last minutes. */
const SCAN_STEP_MS = 30_000;
/** Rise, set and peak times are found to within this. */
const TIME_TOLERANCE_MS = 1000;
/** Sampling step for when a pass can be seen. */
const VISIBILITY_STEP_MS = 10_000;

/**
 * The satellite's passes over the observer that start or are underway between
 * `fromMs` and `untilMs`, rising at least `MIN_PASS_ELEVATION` at their peak.
 * At most `limit`, earliest first. Null if it cannot be propagated.
 *
 * Elevation is sampled every 30 s to find each crossing of the horizon, which
 * is then narrowed down by bisection, and the peak by golden-section search.
 */
export function predictPasses(
  record: SatelliteRecord,
  observer: Observer,
  fromMs: number,
  untilMs: number,
  limit: number,
): PassPrediction | null {
  const positionAt = positionFunction(record);
  if (!positionAt) return null;
  const frame = createObserverFrame();
  const where = vec();
  const look: LookAngles = { azimuth: 0, elevation: 0, rangeKm: 0 };
  let failed = false;

  const lookAt = (timeMs: number): LookAngles => {
    observerFrame(observer, timeMs, frame);
    if (!positionAt(timeMs, where)) {
      failed = true;
      look.elevation = Number.NaN;
      return look;
    }
    return lookAngles(frame, where, look);
  };
  const elevationAt = (timeMs: number) => lookAt(timeMs).elevation;

  /** The instant between `below` and `above` where it crosses the horizon. */
  const crossing = (below: number, above: number): number => {
    let low = below;
    let high = above;
    while (Math.abs(high - low) > TIME_TOLERANCE_MS) {
      const middle = (low + high) / 2;
      if (elevationAt(middle) > 0) high = middle;
      else low = middle;
    }
    return (low + high) / 2;
  };

  /** The instant between `start` and `end` where it is highest. */
  const peak = (start: number, end: number): number => {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let a = start;
    let b = end;
    while (b - a > TIME_TOLERANCE_MS) {
      const c = b - ratio * (b - a);
      const d = a + ratio * (b - a);
      if (elevationAt(c) > elevationAt(d)) b = d;
      else a = c;
    }
    return (a + b) / 2;
  };

  const standard = standardMagnitude(record);
  const seeableDuring = (riseMs: number, setMs: number): Pass['seeable'] => {
    let fromMs = Number.NaN;
    let toMs = Number.NaN;
    for (let t = riseMs; t <= setMs; t += VISIBILITY_STEP_MS) {
      const angles = lookAt(t);
      sunDirection(t, sun);
      const lit = shadowDepth(where, sun) < 0.5;
      const magnitude = magnitudeFrom(standard, frame.position, where, sun);
      if (canBeSeen(angles, lit, sunElevation(frame, sun), magnitude)) {
        if (Number.isNaN(fromMs)) fromMs = t;
        toMs = t;
      }
    }
    return Number.isNaN(fromMs) ? null : { fromMs, toMs };
  };

  // Up at the start: look back for when it rose, at most a revolution, or a
  // day for something that barely moves across the sky. If it never set in
  // that time, it never does.
  const periodMs = MS_PER_DAY / record.elements.meanMotion;
  let start = fromMs;
  if (elevationAt(fromMs) > 0) {
    const lookBack = Math.min(Math.max(periodMs, MS_PER_DAY / 4), MS_PER_DAY);
    let t = fromMs;
    while (t > fromMs - lookBack && elevationAt(t - SCAN_STEP_MS) > 0) t -= SCAN_STEP_MS;
    if (failed) return null;
    if (t <= fromMs - lookBack) {
      const { elevation, azimuth } = lookAt(fromMs);
      return { kind: 'always-up', elevation, azimuth };
    }
    start = t - SCAN_STEP_MS;
  }

  const passes: Pass[] = [];
  let previous = start;
  let wasUp = elevationAt(start) > 0;
  let riseMs = Number.NaN;
  let highestSample = start;
  let highest = Number.NEGATIVE_INFINITY;
  // Runs on past `untilMs` while a pass is underway, to see it set.
  for (let t = start + SCAN_STEP_MS; passes.length < limit; t += SCAN_STEP_MS) {
    if (!wasUp && t > untilMs) break;
    if (t - untilMs > MS_PER_DAY) break; // a pass that does not end is no pass
    const elevation = elevationAt(t);
    if (failed) return null;
    const up = elevation > 0;
    if (up && !wasUp) {
      riseMs = crossing(previous, t);
      highest = Number.NEGATIVE_INFINITY;
    }
    if (up && elevation > highest) {
      highest = elevation;
      highestSample = t;
    }
    if (!up && wasUp && !Number.isNaN(riseMs)) {
      const setMs = crossing(t, previous);
      const peakMs = peak(
        Math.max(riseMs, highestSample - SCAN_STEP_MS),
        Math.min(setMs, highestSample + SCAN_STEP_MS),
      );
      const peakElevation = elevationAt(peakMs);
      if (peakElevation >= MIN_PASS_ELEVATION) {
        passes.push({
          riseMs,
          setMs,
          peakMs,
          peakElevation,
          riseAzimuth: lookAt(riseMs).azimuth,
          setAzimuth: lookAt(setMs).azimuth,
          seeable: seeableDuring(riseMs, setMs),
        });
      }
      if (failed) return null;
    }
    wasUp = up;
    previous = t;
  }
  return { kind: 'passes', passes };
}
