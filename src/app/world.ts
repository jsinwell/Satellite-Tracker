import { standardMagnitude } from '../core/brightness';
import { type Catalog, OBJECT_TYPES, type ObjectType, type SatelliteRecord } from '../core/catalog';
import {
  CONSTELLATION_IDS,
  type ConstellationId,
  constellationOf,
  typicalAltitudeKm,
} from '../core/constellation';
import { launchYear } from '../core/filter';
import { ORBIT_REGIMES, type OrbitRegime, type OrbitSummary, summarizeOrbit } from '../core/orbit';
import { createSearchIndex, type SearchIndex } from '../core/search';
import { Simulation } from '../sim/Simulation';

/**
 * Everything derived from a catalog. Built once at startup and immutable
 * afterward; satellites are referred to everywhere by their index into
 * `satellites`, which every parallel array here shares.
 */
export interface World {
  /** When the catalog was built, ms since the Unix epoch. */
  readonly generatedAtMs: number;
  readonly source: string;
  readonly satellites: readonly SatelliteRecord[];
  readonly orbits: readonly OrbitSummary[];
  readonly simulation: Simulation;
  readonly search: SearchIndex;
  /** Launch year of each satellite; 0 where the catalog does not say. */
  readonly launchYears: Int16Array;
  /** The earliest and latest launch years among the satellites. */
  readonly launchYearRange: readonly [number, number];
  /** Each satellite's constellation, as an index into `CONSTELLATION_IDS`. */
  readonly constellations: Uint8Array;
  /** How bright each satellite is, as far as its kind says; see `standardMagnitude`. */
  readonly standardMagnitudes: Float32Array;
  readonly indexByNoradId: ReadonlyMap<number, number>;
  readonly countByType: Readonly<Record<ObjectType, number>>;
  readonly countByRegime: Readonly<Record<OrbitRegime, number>>;
  readonly countByConstellation: Readonly<Record<ConstellationId, number>>;
  /** The altitude each constellation typically flies at; null if it has no members. */
  readonly altitudeByConstellation: Readonly<Record<ConstellationId, number | null>>;
}

function tally<K extends string>(keys: readonly K[], values: Iterable<K>): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) counts[value]++;
  return counts;
}

export async function createWorld(catalog: Catalog): Promise<World> {
  const { satellites } = catalog;
  const orbits = satellites.map((satellite) => summarizeOrbit(satellite.elements));
  const launchYears = Int16Array.from(satellites, (satellite) => launchYear(satellite) ?? 0);
  const knownYears = launchYears.filter((year) => year !== 0);
  const memberships = satellites.map(constellationOf);

  return {
    generatedAtMs: Date.parse(catalog.generatedAt),
    source: catalog.source,
    satellites,
    orbits,
    simulation: await Simulation.start(satellites),
    search: createSearchIndex(satellites),
    launchYears,
    launchYearRange: [
      knownYears.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY),
      knownYears.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY),
    ],
    constellations: Uint8Array.from(memberships, (id) => CONSTELLATION_IDS.indexOf(id)),
    standardMagnitudes: Float32Array.from(satellites, standardMagnitude),
    indexByNoradId: new Map(satellites.map((satellite, index) => [satellite.noradId, index])),
    countByType: tally(
      OBJECT_TYPES,
      satellites.map((satellite) => satellite.objectType),
    ),
    countByRegime: tally(
      ORBIT_REGIMES,
      orbits.map((orbit) => orbit.regime),
    ),
    countByConstellation: tally(CONSTELLATION_IDS, memberships),
    altitudeByConstellation: Object.fromEntries(
      CONSTELLATION_IDS.map((id) => [
        id,
        typicalAltitudeKm(orbits.filter((_, index) => memberships[index] === id)),
      ]),
    ) as Record<ConstellationId, number | null>,
  };
}
