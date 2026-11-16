/**
 * Decides where a build's satellite catalog comes from, and assembles it.
 *
 * CelesTrak is a free service with firm limits: orbital elements (GP data)
 * change about every two hours, the satellite catalog (SATCAT) two or three
 * times a day, and clients that download either more often than it changes
 * are blocked for hours. A site that fetched both on every build would lock
 * itself out with two pushes in a row. So:
 *
 * - Only a *refreshing* build (production) contacts CelesTrak at all. Every
 *   other build — branch previews, local development — reuses the catalog the
 *   live site is already serving.
 * - A refreshing build skips CelesTrak if the published catalog is newer than
 *   CelesTrak's own update interval: there would be nothing new to get.
 * - SATCAT only supplies slow-changing descriptive fields. They are carried
 *   forward from the published catalog and re-downloaded at most once a day,
 *   and a failure to get them never fails the build.
 * - If the elements cannot be fetched, the published catalog is reused, so a
 *   CelesTrak outage delays the data but never blocks a code deploy.
 *
 * All I/O is injected, so the policy above is covered by unit tests.
 */

import { z } from 'zod';
import {
  type Catalog,
  type ObjectType,
  parseCatalog,
  type SatelliteRecord,
} from '../src/core/catalog.ts';

export const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
export const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';

const HOUR_MS = 3_600_000;
/** CelesTrak publishes new elements about this often; asking sooner gains nothing. */
export const ELEMENTS_REFRESH_INTERVAL_MS = 2 * HOUR_MS;
/** SATCAT changes two or three times a day, and only to add newly launched objects. */
export const METADATA_REFRESH_INTERVAL_MS = 24 * HOUR_MS;
/** Beyond this, failing the build is better than quietly shipping stale positions. */
export const MAX_PUBLISHED_AGE_MS = 72 * HOUR_MS;

interface GpGroup {
  name: string;
  /** What the group contains, used when SATCAT has not classified an object. */
  contains: ObjectType;
}

/** Every active payload, plus the four largest tracked debris fields. */
export const GP_GROUPS: readonly GpGroup[] = [
  { name: 'active', contains: 'payload' },
  { name: 'cosmos-1408-debris', contains: 'debris' },
  { name: 'fengyun-1c-debris', contains: 'debris' },
  { name: 'iridium-33-debris', contains: 'debris' },
  { name: 'cosmos-2251-debris', contains: 'debris' },
];

export interface BuildContext {
  /** Downloads a URL as text, rejecting on any unsuccessful response. */
  fetchText(url: string): Promise<string>;
  now(): number;
  /** True for the build that keeps the data current; see the module comment. */
  refresh: boolean;
  /** Where the live site serves its catalog. */
  publishedUrl: string;
  log(message: string): void;
}

/** The descriptive fields SATCAT contributes to a record. */
type Metadata = Pick<SatelliteRecord, 'objectType' | 'owner' | 'launchDate'>;

interface MetadataSet {
  byNoradId: Map<number, Metadata>;
  /** When these fields were last downloaded from SATCAT; null if never. */
  fetchedAt: string | null;
}

const ommSchema = z.object({
  OBJECT_NAME: z.string().trim().min(1),
  OBJECT_ID: z.string().trim(),
  NORAD_CAT_ID: z.coerce.number().int().positive(),
  EPOCH: z.string().refine((value) => !Number.isNaN(Date.parse(toUtc(value))), 'invalid epoch'),
  MEAN_MOTION: z.coerce.number().positive(),
  ECCENTRICITY: z.coerce.number().min(0).lt(1),
  INCLINATION: z.coerce.number().min(0).max(180),
  RA_OF_ASC_NODE: z.coerce.number(),
  ARG_OF_PERICENTER: z.coerce.number(),
  MEAN_ANOMALY: z.coerce.number(),
  BSTAR: z.coerce.number(),
  MEAN_MOTION_DOT: z.coerce.number(),
  MEAN_MOTION_DDOT: z.coerce.number(),
});
type Omm = z.infer<typeof ommSchema>;

const SATCAT_OBJECT_TYPES: Record<string, ObjectType> = {
  PAY: 'payload',
  'R/B': 'rocket-body',
  DEB: 'debris',
};

/** CelesTrak omits the zone designator; OMM epochs are always UTC. */
function toUtc(epoch: string): string {
  return epoch.endsWith('Z') ? epoch : `${epoch}Z`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Splits one CSV line, honoring double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function parseSatcat(csv: string): Map<number, Metadata> {
  const lines = csv.split(/\r?\n/);
  const header = parseCsvLine(lines[0] ?? '');
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index === -1) {
      throw new Error(`SATCAT is missing the ${name} column`);
    }
    return index;
  };
  const idColumn = column('NORAD_CAT_ID');
  const typeColumn = column('OBJECT_TYPE');
  const ownerColumn = column('OWNER');
  const launchColumn = column('LAUNCH_DATE');

  const entries = new Map<number, Metadata>();
  for (const line of lines.slice(1)) {
    if (line === '') continue;
    const fields = parseCsvLine(line);
    const id = Number(fields[idColumn]);
    if (!Number.isInteger(id)) continue;
    entries.set(id, {
      objectType: SATCAT_OBJECT_TYPES[fields[typeColumn] ?? ''] ?? 'unknown',
      owner: fields[ownerColumn] || null,
      launchDate: fields[launchColumn] || null,
    });
  }
  return entries;
}

/**
 * Best guess at what an object is when SATCAT has not told us: NORAD's naming
 * convention marks debris and rocket bodies, and otherwise the group it was
 * listed in says what it contains.
 */
function inferMetadata(name: string, group: GpGroup): Metadata {
  let objectType = group.contains;
  if (/\bDEB\b/.test(name)) objectType = 'debris';
  else if (/\bR\/B\b/.test(name)) objectType = 'rocket-body';
  return { objectType, owner: null, launchDate: null };
}

function toRecord(omm: Omm, metadata: Metadata): SatelliteRecord {
  return {
    noradId: omm.NORAD_CAT_ID,
    name: omm.OBJECT_NAME,
    intlDesignator: omm.OBJECT_ID,
    ...metadata,
    elements: {
      epoch: toUtc(omm.EPOCH),
      meanMotion: omm.MEAN_MOTION,
      eccentricity: omm.ECCENTRICITY,
      inclination: omm.INCLINATION,
      raan: omm.RA_OF_ASC_NODE,
      argOfPericenter: omm.ARG_OF_PERICENTER,
      meanAnomaly: omm.MEAN_ANOMALY,
      bstar: omm.BSTAR,
      meanMotionDot: omm.MEAN_MOTION_DOT,
      meanMotionDdot: omm.MEAN_MOTION_DDOT,
    },
  };
}

function ageMs(catalog: Catalog, context: BuildContext): number {
  return context.now() - Date.parse(catalog.generatedAt);
}

/** The catalog the live site is serving, or null if there is no usable one. */
async function fetchPublished(context: BuildContext): Promise<Catalog | null> {
  try {
    const catalog = parseCatalog(JSON.parse(await context.fetchText(context.publishedUrl)));
    if (ageMs(catalog, context) > MAX_PUBLISHED_AGE_MS) {
      context.log(`The published catalog (${catalog.generatedAt}) is too old to reuse.`);
      return null;
    }
    return catalog;
  } catch (error) {
    context.log(`No published catalog at ${context.publishedUrl}: ${messageOf(error)}`);
    return null;
  }
}

/**
 * The SATCAT fields to join onto this build's records: carried forward from
 * the previous catalog while they are recent enough, otherwise downloaded.
 * Never throws — these fields enrich the catalog but nothing depends on them.
 */
async function loadMetadata(context: BuildContext, previous: Catalog | null): Promise<MetadataSet> {
  const carried: MetadataSet = {
    byNoradId: new Map(
      (previous?.satellites ?? []).map(({ noradId, objectType, owner, launchDate }) => [
        noradId,
        { objectType, owner, launchDate },
      ]),
    ),
    fetchedAt: previous?.metadataFetchedAt ?? null,
  };
  const carriedAgeMs =
    carried.fetchedAt === null
      ? Number.POSITIVE_INFINITY
      : context.now() - Date.parse(carried.fetchedAt);
  if (carriedAgeMs < METADATA_REFRESH_INTERVAL_MS) {
    context.log(`Reusing SATCAT fields fetched ${carried.fetchedAt}.`);
    return carried;
  }

  try {
    context.log('Fetching SATCAT…');
    const byNoradId = parseSatcat(await context.fetchText(SATCAT_URL));
    context.log(`  ${byNoradId.size} cataloged objects`);
    return { byNoradId, fetchedAt: new Date(context.now()).toISOString() };
  } catch (error) {
    context.log(`  SATCAT unavailable, continuing without a refresh: ${messageOf(error)}`);
    return carried;
  }
}

async function fetchGroup(context: BuildContext, group: GpGroup): Promise<unknown[]> {
  const body = await context.fetchText(
    `${GP_URL}?GROUP=${encodeURIComponent(group.name)}&FORMAT=json`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // CelesTrak reports problems (unknown group, rate limiting) as plain text.
    throw new Error(`GP group "${group.name}" did not return JSON: ${body.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`GP group "${group.name}" returned ${typeof parsed}, expected an array`);
  }
  return parsed;
}

/** Builds a catalog with fresh elements from CelesTrak. Rejects if they cannot be fetched. */
async function fetchFromCelestrak(
  context: BuildContext,
  previous: Catalog | null,
): Promise<Catalog> {
  // Elements first: if CelesTrak is refusing us, find out before spending a
  // SATCAT download that would then be thrown away.
  const records = new Map<number, { omm: Omm; group: GpGroup }>();
  let rejected = 0;
  // Sequential on purpose: be a polite client.
  for (const group of GP_GROUPS) {
    context.log(`Fetching GP group "${group.name}"…`);
    const entries = await fetchGroup(context, group);
    for (const entry of entries) {
      const result = ommSchema.safeParse(entry);
      if (!result.success) {
        rejected++;
      } else if (!records.has(result.data.NORAD_CAT_ID)) {
        // A satellite can appear in several groups; the first occurrence wins.
        records.set(result.data.NORAD_CAT_ID, { omm: result.data, group });
      }
    }
    context.log(`  ${entries.length} element sets`);
  }
  if (rejected > 0) {
    context.log(`Rejected ${rejected} element sets that failed validation.`);
  }
  if (records.size === 0) {
    throw new Error('CelesTrak returned no valid element sets.');
  }

  const metadata = await loadMetadata(context, previous);
  return {
    schemaVersion: 1,
    generatedAt: new Date(context.now()).toISOString(),
    metadataFetchedAt: metadata.fetchedAt,
    source: 'CelesTrak (celestrak.org)',
    satellites: [...records.values()]
      .map(({ omm, group }) =>
        toRecord(
          omm,
          metadata.byNoradId.get(omm.NORAD_CAT_ID) ?? inferMetadata(omm.OBJECT_NAME, group),
        ),
      )
      .sort((a, b) => a.noradId - b.noradId),
  };
}

/** Obtains the catalog for this build, following the policy in the module comment. */
export async function buildCatalog(context: BuildContext): Promise<Catalog> {
  const published = await fetchPublished(context);

  if (published && !context.refresh) {
    context.log(`Reusing the published catalog from ${published.generatedAt}.`);
    return published;
  }
  if (published && ageMs(published, context) < ELEMENTS_REFRESH_INTERVAL_MS) {
    context.log(`The published catalog (${published.generatedAt}) is still current; reusing it.`);
    return published;
  }

  try {
    return await fetchFromCelestrak(context, published);
  } catch (error) {
    if (!published) {
      throw new Error(
        `CelesTrak could not be reached and there is no published catalog to fall back on: ${messageOf(error)}`,
        { cause: error },
      );
    }
    context.log(`CelesTrak failed (${messageOf(error)}); reusing the published catalog instead.`);
    return published;
  }
}
