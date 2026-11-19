import { shadowDepth } from './astro';
import type { SatelliteRecord } from './catalog';
import { constellationOf } from './constellation';
import type { Vec3 } from './kinematics';

/**
 * How bright satellites look. A satellite shines by the sunlight it sends
 * back, so how bright it is from the ground comes down to three things: how
 * big and shiny it is, how far off, and how much of its sunlit side faces
 * the viewer. The last two are worked out. The first the catalog does not
 * say, so it is a figure for the kind of thing it is: right for the famous
 * ones, and a fair guess for the rest. Whatever is said or drawn from this
 * is an estimate, and good to a magnitude or two at best.
 *
 * Brightness is in magnitudes, as for stars: smaller is brighter, five
 * magnitudes are a hundred times, and the eye stops at about 6.
 */

/** A satellite's standard magnitude is how bright it is from this far off, km, half lit. */
const STANDARD_RANGE_KM = 1000;

/** The few that are known by name, and far from typical. */
const KNOWN: readonly { pattern: RegExp; magnitude: number }[] = [
  { pattern: /^ISS \(ZARYA\)$/, magnitude: -1.8 },
  { pattern: /^CSS \(TIANHE\)$/, magnitude: -0.3 },
  { pattern: /^HST$/, magnitude: 2.2 },
];

/**
 * The standard magnitude of a satellite, by what it is: the big
 * constellations by their published or widely measured brightness, and
 * everything else by its type. Spent rocket stages are large and bright;
 * debris is mostly fragments, far too small to see.
 */
export function standardMagnitude(record: SatelliteRecord): number {
  const known = KNOWN.find(({ pattern }) => pattern.test(record.name));
  if (known) return known.magnitude;
  switch (record.objectType) {
    case 'rocket-body':
      return 4.5;
    case 'debris':
      return 9.5;
    case 'unknown':
      return 8.5;
    default:
  }
  switch (constellationOf(record)) {
    case 'starlink':
    case 'kuiper':
      return 6.5;
    case 'oneweb':
      return 7.5;
    case 'qianfan':
    case 'guowang':
    case 'navigation':
      return 5.5;
    case 'iridium':
      return 6;
    // Shoebox-sized, most of them.
    case 'planet':
      return 9;
    default:
      return 6.5;
  }
}

/**
 * How much of the light of a ball lit from one side comes back toward a
 * viewer, 0 to 1, by the cosine of the angle at the ball between the Sun and
 * the viewer: all of it with the Sun behind the viewer, a third of it side
 * on, none with the Sun behind the ball. The same law as the Moon's phases.
 */
export function phaseShare(cosPhase: number): number {
  const cosine = Math.min(1, Math.max(-1, cosPhase));
  const phase = Math.acos(cosine);
  return (Math.sin(phase) + (Math.PI - phase) * cosine) / Math.PI;
}

/** A sunlit satellite's magnitude from `rangeKm` away, lit at the angle whose cosine is `cosPhase`. */
export function apparentMagnitude(standard: number, rangeKm: number, cosPhase: number): number {
  // Half lit, the share is one part in pi.
  const lit = Math.max(Math.PI * phaseShare(cosPhase), 1e-6);
  return standard + 5 * Math.log10(rangeKm / STANDARD_RANGE_KM) - 2.5 * Math.log10(lit);
}

/**
 * The magnitude of a satellite at `position` seen from `eye` (both km, in
 * the same frame as `sun`, a unit vector), if the Sun is on it.
 */
export function magnitudeFrom(standard: number, eye: Vec3, position: Vec3, sun: Vec3): number {
  const x = eye.x - position.x;
  const y = eye.y - position.y;
  const z = eye.z - position.z;
  const range = Math.hypot(x, y, z);
  return apparentMagnitude(standard, range, (x * sun.x + y * sun.y + z * sun.z) / range);
}

/** What the view of the sky from the ground shows of the satellites over it. */
export const SKY_SHOWS = ['eye', 'binoculars', 'all'] as const;
/**
 * `eye`: the ones a person standing there could see, as the points of light
 * they are. `binoculars`: the same, four magnitudes fainter. `all`: every
 * one above the horizon, marked whether or not it could be seen.
 */
export type SkyShows = (typeof SKY_SHOWS)[number];

/** The faintest magnitude seen under a dark sky. */
export const FAINTEST = { eye: 6, binoculars: 10 } as const;

/**
 * How many magnitudes the sky's own light costs, by how high the Sun is,
 * degrees: nothing once it is 12° down, and all but the very brightest by
 * sunset. First the Sun's height, then the magnitudes lost.
 */
const TWILIGHT: readonly (readonly [number, number])[] = [
  [-12, 0],
  [-6, 3.5],
  [0, 9],
  [6, 14],
];

export function twilightLoss(sunElevationDeg: number): number {
  const [first] = TWILIGHT;
  const last = TWILIGHT[TWILIGHT.length - 1];
  if (sunElevationDeg <= first[0]) return first[1];
  if (sunElevationDeg >= last[0]) return last[1];
  for (let i = 1; i < TWILIGHT.length; i++) {
    const [height, loss] = TWILIGHT[i];
    if (sunElevationDeg <= height) {
      const [below, lossBelow] = TWILIGHT[i - 1];
      return lossBelow + ((loss - lossBelow) * (sunElevationDeg - below)) / (height - below);
    }
  }
  return last[1];
}

/** The faintest magnitude that shows, by eye or through binoculars, with the Sun this high. */
export function faintestSeen(shows: keyof typeof FAINTEST, sunElevationDeg: number): number {
  return FAINTEST[shows] - twilightLoss(sunElevationDeg);
}

/**
 * Whether a satellite at `position` shows from `eye` when nothing fainter
 * than `faintest` does: sunlit, and bright enough. What is drawn fades in
 * over a magnitude, so this is where it is half there.
 */
export function isSeen(
  standard: number,
  eye: Vec3,
  position: Vec3,
  sun: Vec3,
  faintest: number,
): boolean {
  return (
    shadowDepth(position, sun) < 0.5 && magnitudeFrom(standard, eye, position, sun) <= faintest
  );
}
