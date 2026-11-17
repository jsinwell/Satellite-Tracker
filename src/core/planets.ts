import { Body, GeoVector, Illumination, RotateVector, Rotation_EQJ_EQD } from 'astronomy-engine';
import { AU_KM } from './astro';
import type { Vec3 } from './kinematics';
import { directionAngles, type Observer, observerFrame } from './observer';

/**
 * The planets, from astronomy-engine: positions good to about an arcminute,
 * well under a pixel unless the view is zoomed far in, and brightness from the
 * phase and distances of the moment.
 */

export const PLANETS = [
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
] as const;
export type Planet = (typeof PLANETS)[number];

export const PLANET_NAMES: Record<Planet, string> = {
  mercury: 'Mercury',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
  uranus: 'Uranus',
  neptune: 'Neptune',
};

const BODIES: Record<Planet, Body> = {
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
};

export interface PlanetPosition {
  planet: Planet;
  /**
   * Unit vector from the Earth's center toward where the planet appears,
   * light travel time included, in the equator-and-equinox-of-date frame the
   * satellites are drawn in. TEME differs from it only by the equation of the
   * equinoxes, at most about a hundredth of a degree.
   */
  direction: Vec3;
  /** How far away it is, km, as its light left it. */
  distanceKm: number;
  /** Apparent visual magnitude: smaller is brighter, and the eye stops at about 6. */
  magnitude: number;
}

/**
 * Where the planets appear from the Earth's center at `timeMs`. They are far
 * enough away that seen from the surface instead they move by no more than
 * a fraction of an arcminute.
 */
export function planetPositions(timeMs: number): PlanetPosition[] {
  const date = new Date(timeMs);
  const toDate = Rotation_EQJ_EQD(date);
  return PLANETS.map((planet) => {
    const body = BODIES[planet];
    const v = RotateVector(toDate, GeoVector(body, date, true));
    const length = Math.hypot(v.x, v.y, v.z);
    return {
      planet,
      direction: { x: v.x / length, y: v.y / length, z: v.z / length },
      distanceKm: length * AU_KM,
      magnitude: Illumination(body, date).mag,
    };
  });
}

/**
 * The rotation from the J2000 equator and equinox to those of `timeMs`: the
 * Earth's axis wobbling slowly (precession) and nodding (nutation). As
 * row-major 3×3, for turning things drawn in J2000, like the star map, into
 * the frame of the date.
 */
export function j2000ToDate(timeMs: number): number[] {
  // astronomy-engine stores its matrices the other way round:
  // `RotateVector` gives out[j] = sum over i of rot[i][j] * in[i].
  const { rot } = Rotation_EQJ_EQD(new Date(timeMs));
  return [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => rot[column][row]));
}

/** Plain words for how bright a magnitude looks to the eye. */
export function brightnessWords(magnitude: number): string {
  if (magnitude < -3) return 'brilliant';
  if (magnitude < -1) return 'very bright';
  if (magnitude < 1.5) return 'bright';
  if (magnitude < 4) return 'faint';
  if (magnitude < 6.5) return 'barely visible';
  return 'telescope only';
}

/** Fainter than this, a planet cannot be seen without a telescope (Neptune). */
export const NAKED_EYE_MAGNITUDE = 6.5;

export interface PlanetInSky {
  planet: Planet;
  magnitude: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
}

/**
 * The planets above the observer's horizon at `timeMs` that can be seen by
 * eye, brightest first. Refraction, which lifts things near the horizon by
 * about half a degree, is left out.
 */
export function planetsUp(observer: Observer, timeMs: number): PlanetInSky[] {
  const frame = observerFrame(observer, timeMs);
  return planetPositions(timeMs)
    .map(({ planet, direction, magnitude }) => {
      const { azimuth, elevation } = directionAngles(frame, direction);
      return { planet, magnitude, azimuth, elevation };
    })
    .filter(({ elevation, magnitude }) => elevation > 0 && magnitude <= NAKED_EYE_MAGNITUDE)
    .sort((a, b) => a.magnitude - b.magnitude);
}
