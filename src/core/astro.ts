import { eciToGeodetic, gstime, shadowFraction, sunPos } from 'satellite.js';
import { EARTH_RADIUS_KM, julianDate } from './constants';
import type { Vec3 } from './kinematics';

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Greenwich mean sidereal time, radians: the angle between the inertial
 * frame's x-axis and the Greenwich meridian at `timeMs`.
 */
export function gmst(timeMs: number): number {
  return gstime(julianDate(timeMs));
}

/** Unit vector from the Earth's center toward the Sun, inertial frame. */
export function sunDirection(timeMs: number, out: Vec3): Vec3 {
  const { rsun } = sunPos(julianDate(timeMs));
  const length = Math.hypot(rsun.x, rsun.y, rsun.z);
  out.x = rsun.x / length;
  out.y = rsun.y / length;
  out.z = rsun.z / length;
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

const DEG = Math.PI / 180;
const J2000_JD = 2451545;
const DAYS_PER_JULIAN_CENTURY = 36525;

const sinDeg = (degrees: number) => Math.sin(degrees * DEG);
const cosDeg = (degrees: number) => Math.cos(degrees * DEG);

/** The tilt of the Earth's axis to the plane of its orbit, degrees. */
export function obliquity(timeMs: number): number {
  const t = (julianDate(timeMs) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;
  return 23.439291 - 0.0130042 * t;
}

/**
 * Position of the Moon relative to the Earth's center, km, inertial frame.
 *
 * The low-precision series from the Astronomical Almanac (as given by
 * Vallado): good to about 0.3° in direction and 0.2% in distance, which is far
 * finer than the half-degree disc it is used to place.
 */
export function moonPosition(timeMs: number, out: Vec3): Vec3 {
  const t = (julianDate(timeMs) - J2000_JD) / DAYS_PER_JULIAN_CENTURY;

  const longitude =
    218.32 +
    481267.8813 * t +
    6.29 * sinDeg(134.9 + 477198.85 * t) -
    1.27 * sinDeg(259.2 - 413335.38 * t) +
    0.66 * sinDeg(235.7 + 890534.23 * t) +
    0.21 * sinDeg(269.9 + 954397.7 * t) -
    0.19 * sinDeg(357.5 + 35999.05 * t) -
    0.11 * sinDeg(186.6 + 966404.05 * t);
  const latitude =
    5.13 * sinDeg(93.3 + 483202.03 * t) +
    0.28 * sinDeg(228.2 + 960400.87 * t) -
    0.28 * sinDeg(318.3 + 6003.18 * t) -
    0.17 * sinDeg(217.6 - 407332.2 * t);
  const parallax =
    0.9508 +
    0.0518 * cosDeg(134.9 + 477198.85 * t) +
    0.0095 * cosDeg(259.2 - 413335.38 * t) +
    0.0078 * cosDeg(235.7 + 890534.23 * t) +
    0.0028 * cosDeg(269.9 + 954397.7 * t);

  const distanceKm = EARTH_RADIUS_KM / sinDeg(parallax);
  const tilt = obliquity(timeMs);
  // Ecliptic longitude and latitude to equatorial axes.
  out.x = distanceKm * cosDeg(latitude) * cosDeg(longitude);
  out.y =
    distanceKm *
    (cosDeg(tilt) * cosDeg(latitude) * sinDeg(longitude) - sinDeg(tilt) * sinDeg(latitude));
  out.z =
    distanceKm *
    (sinDeg(tilt) * cosDeg(latitude) * sinDeg(longitude) + cosDeg(tilt) * sinDeg(latitude));
  return out;
}
