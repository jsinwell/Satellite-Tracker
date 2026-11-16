import { OBJECT_TYPES, type ObjectType, type SatelliteRecord } from './catalog';
import { ORBIT_REGIMES, type OrbitRegime, type OrbitSummary } from './orbit';

export interface Filters {
  types: Readonly<Record<ObjectType, boolean>>;
  regimes: Readonly<Record<OrbitRegime, boolean>>;
}

function allEnabled<K extends string>(keys: readonly K[]): Record<K, boolean> {
  return Object.fromEntries(keys.map((key) => [key, true])) as Record<K, boolean>;
}

export const SHOW_EVERYTHING: Filters = {
  types: allEnabled(OBJECT_TYPES),
  regimes: allEnabled(ORBIT_REGIMES),
};

/**
 * One byte per satellite, in catalog order: 1 if it passes every filter.
 * The renderer uploads this as a vertex attribute and the picker reads it, so
 * what is drawn and what can be clicked are the same set by construction.
 */
export function visibilityMask(
  records: readonly SatelliteRecord[],
  orbits: readonly OrbitSummary[],
  filters: Filters,
): Uint8Array {
  const mask = new Uint8Array(records.length);
  for (let i = 0; i < records.length; i++) {
    mask[i] = filters.types[records[i].objectType] && filters.regimes[orbits[i].regime] ? 1 : 0;
  }
  return mask;
}

/** Number of satellites a mask shows. */
export function countVisible(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}
