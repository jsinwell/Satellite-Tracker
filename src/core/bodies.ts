import {
  Body,
  Constellation,
  GeoMoon,
  GeoVector,
  HelioVector,
  Illumination,
  JupiterMoons,
  MakeTime,
  RotateVector,
  Rotation_EQJ_EQD,
  RotationAxis,
  type RotationMatrix,
  Vector,
} from 'astronomy-engine';
import { AU_KM, moonPosition, sunPosition } from './astro';
import { MOON_RADIUS_KM, sunHiddenByEarth } from './eclipse';
import type { Vec3 } from './kinematics';
import { directionAngles, lookAngles, type Observer, observerFrame } from './observer';
import { PLANET_NAMES, PLANETS, type Planet, type PlanetPosition } from './planets';

/**
 * The Moon and planets as worlds rather than points of light: how big each
 * looks, which way it is turned, how much of it is lit, and what goes round
 * it. What a telescope shows, and what the view shows when it is zoomed far
 * enough in.
 */

/** Anything in the sky that can be looked at closely. */
export type SkyBody = Planet | 'moon';

export const SKY_BODIES: readonly SkyBody[] = ['moon', ...PLANETS];

export const BODY_NAMES: Record<SkyBody, string> = { moon: 'Moon', ...PLANET_NAMES };

export function isSkyBody(value: unknown): value is SkyBody {
  return typeof value === 'string' && (SKY_BODIES as readonly string[]).includes(value);
}

/**
 * Each one's radius at its equator, km, and how much shorter it is through
 * its poles, as a share of that: a tenth for Saturn, which is plain to see.
 */
export const BODY_SHAPES: Record<SkyBody, { radiusKm: number; flattening: number }> = {
  moon: { radiusKm: MOON_RADIUS_KM, flattening: 0 },
  mercury: { radiusKm: 2439.7, flattening: 0 },
  venus: { radiusKm: 6051.8, flattening: 0 },
  mars: { radiusKm: 3396.2, flattening: 0.00589 },
  jupiter: { radiusKm: 71_492, flattening: 0.06487 },
  saturn: { radiusKm: 60_268, flattening: 0.09796 },
  uranus: { radiusKm: 25_559, flattening: 0.02293 },
  neptune: { radiusKm: 24_764, flattening: 0.01708 },
};

/**
 * How bright each one's sunlit face is, in the units the sky is worked out in
 * (see `atmosphere.ts`, where sunlight above the air is 1): what it sends
 * back of the light that falls on it, less the square of its distance from
 * the Sun, spread over a hemisphere. Venus is brighter than the daytime sky,
 * and can be seen in it; Jupiter is fainter, and all but lost in it; and all
 * of them are far brighter than the sky at night.
 */
export const SURFACE_BRIGHTNESS: Record<SkyBody, number> = {
  moon: 0.038,
  mercury: 0.25,
  venus: 0.43,
  mars: 0.023,
  jupiter: 0.0059,
  saturn: 0.0016,
  uranus: 4.3e-4,
  neptune: 1.5e-4,
};

/**
 * What to multiply light by to show `body`'s face well, as `skyExposure` is
 * for the sky: what a telescope's eyepiece, or a camera on one, is set to.
 * With it the night sky around a planet is black.
 */
export function bodyExposure(body: SkyBody): number {
  return 1 / SURFACE_BRIGHTNESS[body];
}

/**
 * How bright `body`'s face comes out, 0 to 1, when the picture is exposed by
 * `exposure` rather than for the body itself: all there at night, and a pale
 * ghost of itself by day, when the picture is exposed for the sky.
 */
export function bodyShown(body: SkyBody, exposure: number): number {
  return Math.min(1, exposure * SURFACE_BRIGHTNESS[body]);
}

/** Saturn's rings, from the inner edge of the faint C ring to the outer edge of the A ring, km. */
export const SATURN_RINGS = { innerKm: 74_500, outerKm: 140_220 } as const;

const BODIES: Record<Planet, Body> = {
  mercury: Body.Mercury,
  venus: Body.Venus,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
};

const DEG = Math.PI / 180;
const moonKm: Vec3 = { x: 0, y: 0, z: 0 };
/** How long light takes to cross one astronomical unit, ms. */
const LIGHT_MS_PER_AU = 499_004.784;

/** How wide a ball of `radiusKm` looks from `distanceKm`, radians. */
export function angularDiameter(radiusKm: number, distanceKm: number): number {
  return 2 * Math.asin(Math.min(1, radiusKm / distanceKm));
}

function unit(vector: { x: number; y: number; z: number }): Vec3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

export interface PlanetDisc extends PlanetPosition {
  /** How wide it looks across its equator, radians. */
  angularDiameter: number;
  /** Unit vector from the planet toward the Sun, in the frame of the date like `direction`. */
  sunward: Vec3;
  /** How much of the disc facing the Earth is lit, 0 to 1. */
  litFraction: number;
  /** Unit vector along its axis, toward its north pole. */
  pole: Vec3;
  /**
   * Unit vector from its center through where its prime meridian crosses its
   * equator: with `pole`, which way round it is turned at this instant.
   */
  meridian: Vec3;
}

function discOf(planet: Planet, date: Date, toDate: RotationMatrix): PlanetDisc {
  const body = BODIES[planet];
  const turned = (vector: Vector) => RotateVector(toDate, vector);
  const seen = turned(GeoVector(body, date, true));
  const distanceAu = Math.hypot(seen.x, seen.y, seen.z);
  const light = Illumination(body, date);

  // The axis and the turn about it, as the IAU defines them: the prime
  // meridian is `spin` degrees round the planet's equator from where that
  // crosses the Earth's (of 2000), going up.
  const axis = RotationAxis(body, date);
  const rightAscension = axis.ra * 15 * DEG;
  const spin = axis.spin * DEG;
  const node = { x: -Math.sin(rightAscension), y: Math.cos(rightAscension), z: 0 };
  const north = axis.north;
  const ahead = {
    x: north.y * node.z - north.z * node.y,
    y: north.z * node.x - north.x * node.z,
    z: north.x * node.y - north.y * node.x,
  };
  const meridian = {
    x: node.x * Math.cos(spin) + ahead.x * Math.sin(spin),
    y: node.y * Math.cos(spin) + ahead.y * Math.sin(spin),
    z: node.z * Math.cos(spin) + ahead.z * Math.sin(spin),
  };
  const fromSun = turned(HelioVector(body, date));
  return {
    planet,
    direction: unit(seen),
    distanceKm: distanceAu * AU_KM,
    magnitude: light.mag,
    angularDiameter: angularDiameter(BODY_SHAPES[planet].radiusKm, distanceAu * AU_KM),
    sunward: unit({ x: -fromSun.x, y: -fromSun.y, z: -fromSun.z }),
    litFraction: light.phase_fraction,
    pole: unit(turned(north)),
    meridian: unit(turned(new Vector(meridian.x, meridian.y, meridian.z, north.t))),
  };
}

/**
 * The planets as they look from the Earth's center at `timeMs`: where, as
 * `planetPositions` gives, and besides that how big, how lit and how turned.
 */
export function planetDiscs(timeMs: number): PlanetDisc[] {
  const date = new Date(timeMs);
  const toDate = Rotation_EQJ_EQD(date);
  return PLANETS.map((planet) => discOf(planet, date, toDate));
}

export const JUPITER_MOONS = ['io', 'europa', 'ganymede', 'callisto'] as const;
export type JupiterMoon = (typeof JUPITER_MOONS)[number];

export const JUPITER_MOON_NAMES: Record<JupiterMoon, string> = {
  io: 'Io',
  europa: 'Europa',
  ganymede: 'Ganymede',
  callisto: 'Callisto',
};

export const JUPITER_MOON_RADII_KM: Record<JupiterMoon, number> = {
  io: 1821.6,
  europa: 1560.8,
  ganymede: 2634.1,
  callisto: 2410.3,
};

/**
 * Where Jupiter's four large moons are seen relative to Jupiter's center at
 * `timeMs`, km, in the frame of the date. Seen: the light showing them left
 * the better part of an hour ago, in which Io goes a twelfth of the way
 * round, so they are placed where they were then. `distanceKm` is how far
 * Jupiter is.
 */
export function jupiterMoonOffsets(timeMs: number, distanceKm: number): Record<JupiterMoon, Vec3> {
  const left = new Date(timeMs - (distanceKm / AU_KM) * LIGHT_MS_PER_AU);
  const toDate = Rotation_EQJ_EQD(new Date(timeMs));
  const moons = JupiterMoons(left);
  const time = MakeTime(left);
  const offset = (moon: JupiterMoon): Vec3 => {
    const state = moons[moon];
    const v = RotateVector(toDate, new Vector(state.x, state.y, state.z, time));
    return { x: v.x * AU_KM, y: v.y * AU_KM, z: v.z * AU_KM };
  };
  return {
    io: offset('io'),
    europa: offset('europa'),
    ganymede: offset('ganymede'),
    callisto: offset('callisto'),
  };
}

/** The Sun's apparent magnitude, which the Moon's is measured against. */
const SUN_MAGNITUDE = -26.74;
const sunKm: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * How much light the Moon sends the Earth, as a share of the Sun's: about
 * two and a half millionths when full, a tenth of that at the quarters (it
 * falls off far faster than the lit part of the disc shrinks, as a rough
 * surface lit from the side is mostly its own shadows), next to nothing when
 * new, and nothing while the Earth's shadow is on it.
 */
export function moonlight(timeMs: number): number {
  const magnitude = Illumination(Body.Moon, new Date(timeMs)).mag;
  const share = 10 ** (-0.4 * (magnitude - SUN_MAGNITUDE));
  const eclipsed = sunHiddenByEarth(moonPosition(timeMs, moonKm), sunPosition(timeMs, sunKm));
  return share * (1 - eclipsed);
}

/** The light of a full Moon, on the same scale: what `moonlight` is at its most, near enough. */
export const FULL_MOONLIGHT = 2.5e-6;
/** Moonlight is sunlight off gray-brown rock: a little warmer than the Sun's. */
export const MOONLIGHT_COLOR = [1.06, 1.0, 0.88] as const;

/**
 * How much of the stars' light is left to see with the Moon up, 0 to 1. A
 * full Moon high in the sky takes most of the faint ones: its light in the
 * air is a veil in front of them. `share` is `moonlight`, and `elevation`
 * how high the Moon is, degrees.
 */
export function starsByMoonlight(share: number, elevationDeg: number): number {
  const up = Math.min(1, Math.max(0, (elevationDeg + 2) / 12));
  const strength = Math.sqrt(Math.min(1, share / FULL_MOONLIGHT));
  return 1 - 0.6 * strength * up * up * (3 - 2 * up);
}

export interface BodyView {
  /** From the observer, km. */
  distanceKm: number;
  /** How wide it looks, radians. */
  angularDiameter: number;
  /** Apparent visual magnitude: smaller is brighter. */
  magnitude: number;
  /** How much of the disc facing the observer is lit, 0 to 1. */
  litFraction: number;
  /** Degrees clockwise from north. */
  azimuth: number;
  /** Degrees above the horizon; negative below it. */
  elevation: number;
  /** The constellation it is in front of. */
  constellation: string;
}

/** The constellation behind a direction given for the equator and equinox of 2000. */
function constellationOf(j2000: { x: number; y: number; z: number }): string {
  const length = Math.hypot(j2000.x, j2000.y, j2000.z);
  const hours = (Math.atan2(j2000.y, j2000.x) / DEG / 15 + 24) % 24;
  return Constellation(hours, Math.asin(j2000.z / length) / DEG).name;
}

/** What an observer sees of the Moon or a planet at `timeMs`. */
export function bodyView(body: SkyBody, observer: Observer, timeMs: number): BodyView {
  const date = new Date(timeMs);
  const frame = observerFrame(observer, timeMs);
  if (body === 'moon') {
    // The Moon is near enough for where on the Earth it is seen from to
    // matter: by up to a degree in direction, and a sixtieth in size.
    const { azimuth, elevation, rangeKm } = lookAngles(frame, moonPosition(timeMs, moonKm));
    const light = Illumination(Body.Moon, date);
    return {
      distanceKm: rangeKm,
      angularDiameter: angularDiameter(MOON_RADIUS_KM, rangeKm),
      magnitude: light.mag,
      litFraction: light.phase_fraction,
      azimuth,
      elevation,
      constellation: constellationOf(GeoMoon(date)),
    };
  }
  const disc = discOf(body, date, Rotation_EQJ_EQD(date));
  const { azimuth, elevation } = directionAngles(frame, disc.direction);
  return {
    distanceKm: disc.distanceKm,
    angularDiameter: disc.angularDiameter,
    magnitude: disc.magnitude,
    litFraction: disc.litFraction,
    azimuth,
    elevation,
    constellation: constellationOf(GeoVector(BODIES[body], date, true)),
  };
}

/**
 * How tall the view is made for a close look at each body, in its own
 * diameters. The Moon nearly fills it. Jupiter is given room for its moons,
 * the farthest of which strays 13 of Jupiter's diameters to either side, and
 * Saturn for its rings.
 */
const FRAMING: Record<SkyBody, number> = {
  moon: 1.8,
  mercury: 5,
  venus: 5,
  mars: 5,
  jupiter: 21,
  saturn: 6,
  uranus: 8,
  neptune: 8,
};

/** The narrowest the view goes, degrees: about 15 seconds of arc, top to bottom. */
export const NARROWEST_FOV = 0.004;

/** The field of view, degrees, that frames `body` when it looks `diameter` radians wide. */
export function framingFov(body: SkyBody, diameter: number): number {
  return Math.max(NARROWEST_FOV, (FRAMING[body] * diameter) / DEG);
}

/** The field of view, degrees, at which a disc `diameter` radians wide all but fills the view. */
export function closestFov(diameter: number): number {
  return Math.max(NARROWEST_FOV, (1.2 * diameter) / DEG);
}
