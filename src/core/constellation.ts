import type { SatelliteRecord } from './catalog';
import type { OrbitSummary } from './orbit';

/**
 * The satellite constellations large enough to be worth telling apart, largest
 * first, each recognized by how its members are named in the catalog. The list
 * was drawn up from the catalog itself: these account for about two thirds of
 * everything tracked, and Starlink alone for more than half.
 */
const DEFINITIONS = [
  { id: 'starlink', label: 'Starlink', pattern: /^STARLINK/ },
  { id: 'oneweb', label: 'OneWeb', pattern: /^ONEWEB/ },
  { id: 'kuiper', label: 'Kuiper', pattern: /^KUIPER/ },
  { id: 'qianfan', label: 'Qianfan', pattern: /^QIANFAN/ },
  { id: 'guowang', label: 'Guowang', pattern: /^HULIANWANG/ },
  // GPS, GLONASS, Galileo and BeiDou share one group: four operators, one job,
  // and neighboring shells in medium Earth orbit.
  { id: 'navigation', label: 'Navigation', pattern: /^NAVSTAR|GLONASS|GALILEO|^BEIDOU/ },
  { id: 'planet', label: 'Planet', pattern: /^FLOCK|^SKYSAT/ },
  { id: 'iridium', label: 'Iridium', pattern: /^IRIDIUM/ },
] as const;

export type ConstellationId = (typeof DEFINITIONS)[number]['id'] | 'other';

/** Every group in display order; `other` is everything not in a named constellation. */
export const CONSTELLATION_IDS: readonly ConstellationId[] = [
  ...DEFINITIONS.map((definition) => definition.id),
  'other',
];

export const CONSTELLATION_LABELS = Object.fromEntries([
  ...DEFINITIONS.map((definition) => [definition.id, definition.label]),
  ['other', 'Everything else'],
]) as Record<ConstellationId, string>;

/**
 * The constellation a satellite belongs to. Only payloads count: a fragment
 * named `IRIDIUM 33 DEB` is debris, not part of the Iridium constellation.
 */
export function constellationOf(record: SatelliteRecord): ConstellationId {
  if (record.objectType !== 'payload') return 'other';
  return DEFINITIONS.find(({ pattern }) => pattern.test(record.name))?.id ?? 'other';
}

/**
 * The altitude a group of satellites typically flies at: the median of their
 * mean altitudes, km. A median, because every constellation has stragglers
 * still raising their orbits or on their way down. Null for an empty group.
 */
export function typicalAltitudeKm(orbits: readonly OrbitSummary[]): number | null {
  if (orbits.length === 0) return null;
  const altitudes = orbits
    .map((orbit) => (orbit.apogeeKm + orbit.perigeeKm) / 2)
    .sort((a, b) => a - b);
  const middle = altitudes.length >> 1;
  return altitudes.length % 2 === 1
    ? altitudes[middle]
    : (altitudes[middle - 1] + altitudes[middle]) / 2;
}

/** The one group that is switched on, or null if several (or none) are. */
export function soleEnabled(
  enabled: Readonly<Record<ConstellationId, boolean>>,
): ConstellationId | null {
  const on = CONSTELLATION_IDS.filter((id) => enabled[id]);
  return on.length === 1 ? on[0] : null;
}
