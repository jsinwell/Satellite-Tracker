import {
  Body,
  GeoMoon,
  GeoVector,
  RotateVector,
  Rotation_EQJ_EQD,
  type Vector,
} from 'astronomy-engine';
import { eciToGeodetic, gstime, shadowFraction, sunPos } from 'satellite.js';
import { EARTH_RADIUS_KM, julianDate } from './constants';
import type { Vec3 } from './kinematics';

/** The astronomical unit, km. */
export const AU_KM = 149_597_870.7;

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Greenwich mean sidereal time, radians: the angle between the inertial
 * frame's x-axis and the Greenwich meridian at `timeMs`.
 */
export function gmst(timeMs: number): number {
  return gstime(julianDate(timeMs));
}

/**
 * A J2000 vector from astronomy-engine, in AU, turned into the equator and
 * equinox of the date (the frame the satellites are in, to within a
 * hundredth of a degree) and scaled to km.
 */
function toDateKm(vector: Vector, date: Date, out: Vec3): Vec3 {
  const v = RotateVector(Rotation_EQJ_EQD(date), vector);
  out.x = v.x * AU_KM;
  out.y = v.y * AU_KM;
  out.z = v.z * AU_KM;
  return out;
}

/**
 * Where the Sun appears from the Earth's center, km, inertial frame, light
 * travel time included. From astronomy-engine, good to a few arcseconds:
 * close enough to place the Moon's shadow on the ground for an eclipse.
 */
export function sunPosition(timeMs: number, out: Vec3): Vec3 {
  const date = new Date(timeMs);
  return toDateKm(GeoVector(Body.Sun, date, true), date, out);
}

/** Unit vector from the Earth's center toward the Sun, inertial frame. */
export function sunDirection(timeMs: number, out: Vec3): Vec3 {
  sunPosition(timeMs, out);
  const length = Math.hypot(out.x, out.y, out.z);
  out.x /= length;
  out.y /= length;
  out.z /= length;
  return out;
}

export interface GroundPoint {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive, in (−180, 180]. */
  longitude: number;
  /** Kilometers above the WGS-84 ellipsoid. */
  altitudeKm: number;
}

/** The point on the Earth directly beneath an inertial position at `timeMs`. */
export function subSatellitePoint(position: Vec3, timeMs: number): GroundPoint {
  const geodetic = eciToGeodetic(position, gmst(timeMs));
  return {
    latitude: geodetic.latitude * RAD_TO_DEG,
    longitude: geodetic.longitude * RAD_TO_DEG,
    altitudeKm: geodetic.height,
  };
}

/** True if an inertial position (km) is in direct sunlight at `timeMs`. */
export function isSunlit(position: Vec3, timeMs: number): boolean {
  const { rsun } = sunPos(julianDate(timeMs));
  return shadowFraction(rsun, position) < 0.5;
}

const J2000_JD = 2451545;
const DAYS_PER_JULIAN_CENTURY = 36525;

/** The tilt of the Earth's axis to the plane of its orbit, degrees. */
export function obliquity(timeMs: number): number {
  const t = (julianDate(timeMs) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  return 23.439291 - 0.0130042 * t;
}

/**
 * Position of the Moon relative to the Earth's center, km, inertial frame.
 * From astronomy-engine's lunar theory: good to seconds of arc, which puts
 * the Moon's shadow within a few km of where it really falls in an eclipse.
 */
export function moonPosition(timeMs: number, out: Vec3): Vec3 {
  const date = new Date(timeMs);
  return toDateKm(GeoMoon(date), date, out);
}

/** Half-width of the soft edge of the Earth's shadow, km. */
export const SHADOW_EDGE_KM = 40;

/**
 * How deep in the Earth's shadow an inertial position (km) is: 0 in full
 * sunlight, 1 in full shadow, in between across a narrow soft edge.
 *
 * Treats the shadow as a cylinder behind the Earth. That ignores the penumbra
 * and the slight taper of the umbra, which matter by a few kilometers at
 * satellite altitudes; it is cheap enough to run per satellite on the GPU,
 * where `ORBIT_GLSL` implements the same test.
 */
export function shadowDepth(position: Vec3, sunDirection: Vec3): number {
  const along =
    position.x * sunDirection.x + position.y * sunDirection.y + position.z * sunDirection.z;
  if (along >= 0) return 0; // on the sunward side of the Earth
  const fromAxis = Math.hypot(
    position.x - along * sunDirection.x,
    position.y - along * sunDirection.y,
    position.z - along * sunDirection.z,
  );
  const t = (fromAxis - (EARTH_RADIUS_KM - SHADOW_EDGE_KM)) / (2 * SHADOW_EDGE_KM);
  const edge = Math.min(1, Math.max(0, t));
  return 1 - edge * edge * (3 - 2 * edge); // smoothstep, as in GLSL
}
