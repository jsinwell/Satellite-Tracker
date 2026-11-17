import { OBJECT_TYPES, type ObjectType, type SatelliteRecord } from './catalog';
import { CONSTELLATION_IDS, type ConstellationId } from './constellation';
import { ORBIT_REGIMES, type OrbitRegime, type OrbitSummary } from './orbit';

export interface Filters {
  types: Readonly<Record<ObjectType, boolean>>;
  regimes: Readonly<Record<OrbitRegime, boolean>>;
  constellations: Readonly<Record<ConstellationId, boolean>>;
  /** Show only objects launched in or before this year; null shows everything. */
  launchedBy: number | null;
}

/** What the filters are applied to: parallel arrays, one entry per satellite. */
export interface FilterSubjects {
  readonly satellites: readonly SatelliteRecord[];
  readonly orbits: readonly OrbitSummary[];
  /** `launchYear` for each satellite, with 0 for unknown. */
  readonly launchYears: ArrayLike<number>;
  /** Each satellite's constellation, as an index into `CONSTELLATION_IDS`. */
  readonly constellations: ArrayLike<number>;
}

export function allEnabled<K extends string>(keys: readonly K[]): Record<K, boolean> {
  return Object.fromEntries(keys.map((key) => [key, true])) as Record<K, boolean>;
}

export const SHOW_EVERYTHING: Filters = {
  types: allEnabled(OBJECT_TYPES),
  regimes: allEnabled(ORBIT_REGIMES),
  constellations: allEnabled(CONSTELLATION_IDS),
  launchedBy: null,
};

/**
 * The year an object was launched, or null if the catalog does not say.
 * Falls back to the international designator, which begins with the launch
 * year (`1998-067A`), when SATCAT's launch date is missing.
 */
export function launchYear(record: SatelliteRecord): number | null {
  const source = record.launchDate ?? record.intlDesignator;
  const year = Number(/^(\d{4})-/.exec(source)?.[1]);
  return Number.isInteger(year) ? year : null;
}

/**
 * One byte per satellite, in catalog order: 1 if it passes every filter.
 * The renderer uploads this as a vertex attribute and the picker reads it, so
 * what is drawn and what can be clicked are the same set by construction.
 *
 * An object of unknown launch year is only shown when no year limit is set.
 */
export function visibilityMask(subjects: FilterSubjects, filters: Filters): Uint8Array {
  const { satellites, orbits, launchYears, constellations } = subjects;
  const { types, regimes, launchedBy } = filters;
  const constellationShown = CONSTELLATION_IDS.map((id) => filters.constellations[id]);

  const mask = new Uint8Array(satellites.length);
  for (let i = 0; i < satellites.length; i++) {
    const launched = launchedBy === null || (launchYears[i] !== 0 && launchYears[i] <= launchedBy);
    mask[i] =
      types[satellites[i].objectType] &&
      regimes[orbits[i].regime] &&
      constellationShown[constellations[i]] &&
      launched
        ? 1
        : 0;
  }
  return mask;
}

/** Number of satellites a mask shows. */
export function countVisible(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}
