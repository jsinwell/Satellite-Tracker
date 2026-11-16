import { eciToGeodetic, gstime, shadowFraction, sunPos } from 'satellite.js';
import { julianDate } from './constants';
import type { Vec3 } from './kinematics';

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Greenwich mean sidereal time, radians: the angle between the inertial
 * frame's x-axis and the Greenwich meridian at `timeMs`.
 */
export function gmst(timeMs: number): number {
  return gstime(julianDate(timeMs));
}

/** Unit vector from the Earth's centre toward the Sun, inertial frame. */
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
  /** Kilometres above the WGS-84 ellipsoid. */
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
