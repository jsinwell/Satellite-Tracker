import type { OrbitalElements } from './catalog';
import { EARTH_MU, EARTH_RADIUS_KM, MINUTES_PER_DAY } from './constants';

export const ORBIT_REGIMES = ['LEO', 'MEO', 'GEO', 'HEO'] as const;
export type OrbitRegime = (typeof ORBIT_REGIMES)[number];

export interface OrbitSummary {
  periodMinutes: number;
  semiMajorAxisKm: number;
  /** Altitude above the equatorial radius at the highest point of the orbit. */
  apogeeKm: number;
  /** Altitude above the equatorial radius at the lowest point of the orbit. */
  perigeeKm: number;
  regime: OrbitRegime;
}

const LEO_CEILING_KM = 2000;
const HIGHLY_ELLIPTICAL_ECCENTRICITY = 0.25;
/** Geosynchronous: one revolution per sidereal day, give or take 1%. */
const GEOSYNCHRONOUS_MEAN_MOTION = { min: 0.99, max: 1.01 };

function classify(elements: OrbitalElements, apogeeKm: number): OrbitRegime {
  if (apogeeKm < LEO_CEILING_KM) return 'LEO';
  if (elements.eccentricity >= HIGHLY_ELLIPTICAL_ECCENTRICITY) return 'HEO';
  if (
    elements.meanMotion >= GEOSYNCHRONOUS_MEAN_MOTION.min &&
    elements.meanMotion <= GEOSYNCHRONOUS_MEAN_MOTION.max
  ) {
    return 'GEO';
  }
  return 'MEO';
}

/** Derives the size, shape and regime of an orbit from its mean elements. */
export function summarizeOrbit(elements: OrbitalElements): OrbitSummary {
  const periodMinutes = MINUTES_PER_DAY / elements.meanMotion;
  const periodSeconds = periodMinutes * 60;
  // Kepler's third law: a³ = μ (T / 2π)²
  const semiMajorAxisKm = Math.cbrt(EARTH_MU * (periodSeconds / (2 * Math.PI)) ** 2);
  const apogeeKm = semiMajorAxisKm * (1 + elements.eccentricity) - EARTH_RADIUS_KM;
  const perigeeKm = semiMajorAxisKm * (1 - elements.eccentricity) - EARTH_RADIUS_KM;
  return {
    periodMinutes,
    semiMajorAxisKm,
    apogeeKm,
    perigeeKm,
    regime: classify(elements, apogeeKm),
  };
}
