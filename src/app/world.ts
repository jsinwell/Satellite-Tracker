import { type Catalog, OBJECT_TYPES, type ObjectType, type SatelliteRecord } from '../core/catalog';
import { ORBIT_REGIMES, type OrbitRegime, type OrbitSummary, summarizeOrbit } from '../core/orbit';
import { createSearchIndex, type SearchIndex } from '../core/search';
import { Simulation } from '../sim/Simulation';

/**
 * Everything derived from a catalog. Built once at startup and immutable
 * afterwards; satellites are referred to everywhere by their index into
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
  readonly indexByNoradId: ReadonlyMap<number, number>;
  readonly countByType: Readonly<Record<ObjectType, number>>;
  readonly countByRegime: Readonly<Record<OrbitRegime, number>>;
}

function tally<K extends string>(keys: readonly K[], values: Iterable<K>): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const value of values) counts[value]++;
  return counts;
}

export async function createWorld(catalog: Catalog): Promise<World> {
  const { satellites } = catalog;
  const orbits = satellites.map((satellite) => summarizeOrbit(satellite.elements));
  return {
    generatedAtMs: Date.parse(catalog.generatedAt),
    source: catalog.source,
    satellites,
    orbits,
    simulation: await Simulation.start(satellites),
    search: createSearchIndex(satellites),
    indexByNoradId: new Map(satellites.map((satellite, index) => [satellite.noradId, index])),
    countByType: tally(
      OBJECT_TYPES,
      satellites.map((satellite) => satellite.objectType),
    ),
    countByRegime: tally(
      ORBIT_REGIMES,
      orbits.map((orbit) => orbit.regime),
    ),
  };
}
