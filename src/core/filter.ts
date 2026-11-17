import { OBJECT_TYPES, type ObjectType, type SatelliteRecord } from './catalog';
import { ORBIT_REGIMES, type OrbitRegime, type OrbitSummary } from './orbit';

export interface Filters {
  types: Readonly<Record<ObjectType, boolean>>;
  regimes: Readonly<Record<OrbitRegime, boolean>>;
  /** Show only objects launched in or before this year; null shows everything. */
  launchedBy: number | null;
}

function allEnabled<K extends string>(keys: readonly K[]): Record<K, boolean> {
  return Object.fromEntries(keys.map((key) => [key, true])) as Record<K, boolean>;
}

export const SHOW_EVERYTHING: Filters = {
  types: allEnabled(OBJECT_TYPES),
  regimes: allEnabled(ORBIT_REGIMES),
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
 * `launchYears` holds `launchYear` for each record, with 0 for unknown; an
 * object of unknown age is only shown when no year limit is set.
 */
export function visibilityMask(
  records: readonly SatelliteRecord[],
  orbits: readonly OrbitSummary[],
  launchYears: ArrayLike<number>,
  filters: Filters,
): Uint8Array {
  const { types, regimes, launchedBy } = filters;
  const mask = new Uint8Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const launched = launchedBy === null || (launchYears[i] !== 0 && launchYears[i] <= launchedBy);
    mask[i] = types[records[i].objectType] && regimes[orbits[i].regime] && launched ? 1 : 0;
  }
  return mask;
}

/** Number of satellites a mask shows. */
export function countVisible(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}
