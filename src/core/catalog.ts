/**
 * The catalog is the app's single data contract: `scripts/fetch-catalog.ts`
 * produces it from CelesTrak, and the client consumes it. Upstream data is
 * validated when the catalog is built; the client only checks the envelope.
 */

export const CATALOG_SCHEMA_VERSION = 1;

export const OBJECT_TYPES = ['payload', 'rocket-body', 'debris', 'unknown'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

/** Mean orbital elements for SGP4, in the units CelesTrak publishes (OMM). */
export interface OrbitalElements {
  /** ISO-8601 UTC instant the elements are valid for. */
  epoch: string;
  /** Revolutions per day. */
  meanMotion: number;
  eccentricity: number;
  /** Degrees. */
  inclination: number;
  /** Right ascension of the ascending node, degrees. */
  raan: number;
  /** Degrees. */
  argOfPericenter: number;
  /** Degrees. */
  meanAnomaly: number;
  /** Drag term, 1 / Earth radii. */
  bstar: number;
  meanMotionDot: number;
  meanMotionDdot: number;
}

export interface SatelliteRecord {
  /** NORAD catalog number. The only stable identifier; names are not unique. */
  noradId: number;
  name: string;
  /** International designator, e.g. `1998-067A`. */
  intlDesignator: string;
  objectType: ObjectType;
  /** SATCAT owner code, e.g. `US`, `PRC`, `ISS`. */
  owner: string | null;
  /** `YYYY-MM-DD`. */
  launchDate: string | null;
  elements: OrbitalElements;
}

export interface Catalog {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  /** ISO-8601 UTC instant the orbital elements were fetched. */
  generatedAt: string;
  /**
   * ISO-8601 UTC instant the descriptive fields (object type, owner, launch
   * date) were last refreshed from SATCAT, which happens far less often than
   * the elements; null if they never have been. Used by the catalog build to
   * decide when to refresh them, not by the app.
   */
  metadataFetchedAt?: string | null;
  source: string;
  satellites: SatelliteRecord[];
}

export class CatalogError extends Error {
  override name = 'CatalogError';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks that `raw` is a catalog this build understands. Records were already
 * validated when the file was generated, so only the envelope and the first
 * record are inspected: enough to reject a wrong or stale file cheaply.
 */
export function parseCatalog(raw: unknown): Catalog {
  if (!isObject(raw)) {
    throw new CatalogError('Catalog is not a JSON object.');
  }
  if (raw.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new CatalogError(
      `Unsupported catalog schema version ${String(raw.schemaVersion)} (expected ${CATALOG_SCHEMA_VERSION}).`,
    );
  }
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) {
    throw new CatalogError('Catalog has no valid generation time.');
  }
  if (!Array.isArray(raw.satellites) || raw.satellites.length === 0) {
    throw new CatalogError('Catalog contains no satellites.');
  }
  const first: unknown = raw.satellites[0];
  if (
    !isObject(first) ||
    typeof first.noradId !== 'number' ||
    typeof first.name !== 'string' ||
    !isObject(first.elements)
  ) {
    throw new CatalogError('Catalog records are malformed.');
  }
  return raw as unknown as Catalog;
}
