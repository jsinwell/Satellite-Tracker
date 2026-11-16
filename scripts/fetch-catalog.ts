/**
 * Builds `public/data/catalog.json` from CelesTrak.
 *
 * Orbital elements come from the GP endpoint as OMM JSON, not as TLEs: a TLE
 * has only a five-character field for the catalog number, which the catalog
 * has outgrown. Object type, owner and launch date are joined in from SATCAT.
 *
 * CelesTrak refreshes GP data roughly every two hours and blocks clients that
 * poll harder than that, so this runs once per site build — never per visitor.
 *
 * Usage: node scripts/fetch-catalog.ts [output path]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Catalog, ObjectType, SatelliteRecord } from '../src/core/catalog.ts';

const GP_URL = 'https://celestrak.org/NORAD/elements/gp.php';
const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';
const USER_AGENT = 'satellite-tracker (+https://github.com/jsinwell/Satellite-Tracker)';

/** Every active payload, plus the four largest tracked debris fields. */
const GP_GROUPS = [
  'active',
  'cosmos-1408-debris',
  'fengyun-1c-debris',
  'iridium-33-debris',
  'cosmos-2251-debris',
];

const DEFAULT_OUTPUT = 'public/data/catalog.json';

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

interface SatcatEntry {
  objectType: ObjectType;
  owner: string | null;
  launchDate: string | null;
}

const SATCAT_OBJECT_TYPES: Record<string, ObjectType> = {
  PAY: 'payload',
  'R/B': 'rocket-body',
  DEB: 'debris',
};

/** CelesTrak omits the zone designator; OMM epochs are always UTC. */
function toUtc(epoch: string): string {
  return epoch.endsWith('Z') ? epoch : `${epoch}Z`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchGroup(group: string): Promise<unknown[]> {
  const body = await fetchText(`${GP_URL}?GROUP=${encodeURIComponent(group)}&FORMAT=json`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // CelesTrak reports problems (unknown group, rate limiting) as plain text.
    throw new Error(`GP group "${group}" did not return JSON: ${body.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`GP group "${group}" returned ${typeof parsed}, expected an array`);
  }
  return parsed;
}

/** Splits one CSV line, honouring double-quoted fields. */
function parseCsvLine(line: string): string[] {
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

function parseSatcat(csv: string): Map<number, SatcatEntry> {
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

  const entries = new Map<number, SatcatEntry>();
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

function toRecord(
  omm: z.infer<typeof ommSchema>,
  satcat: Map<number, SatcatEntry>,
): SatelliteRecord {
  const meta = satcat.get(omm.NORAD_CAT_ID);
  return {
    noradId: omm.NORAD_CAT_ID,
    name: omm.OBJECT_NAME,
    intlDesignator: omm.OBJECT_ID,
    objectType: meta?.objectType ?? 'unknown',
    owner: meta?.owner ?? null,
    launchDate: meta?.launchDate ?? null,
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

async function main(): Promise<void> {
  const outputPath = resolve(process.argv[2] ?? DEFAULT_OUTPUT);

  console.log('Fetching SATCAT…');
  const satcat = parseSatcat(await fetchText(SATCAT_URL));
  console.log(`  ${satcat.size} catalogued objects`);

  const records = new Map<number, SatelliteRecord>();
  let rejected = 0;
  // Sequential on purpose: be a polite client.
  for (const group of GP_GROUPS) {
    console.log(`Fetching GP group "${group}"…`);
    const entries = await fetchGroup(group);
    for (const entry of entries) {
      const result = ommSchema.safeParse(entry);
      if (!result.success) {
        rejected++;
        continue;
      }
      // A satellite can appear in several groups; the first occurrence wins.
      if (!records.has(result.data.NORAD_CAT_ID)) {
        records.set(result.data.NORAD_CAT_ID, toRecord(result.data, satcat));
      }
    }
    console.log(`  ${entries.length} element sets`);
  }

  if (records.size === 0) {
    throw new Error('No valid element sets were fetched; refusing to write an empty catalog.');
  }

  const catalog: Catalog = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'CelesTrak (celestrak.org)',
    satellites: [...records.values()].sort((a, b) => a.noradId - b.noradId),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(catalog));

  const countByType = new Map<ObjectType, number>();
  for (const { objectType } of catalog.satellites) {
    countByType.set(objectType, (countByType.get(objectType) ?? 0) + 1);
  }
  console.log(`Wrote ${catalog.satellites.length} satellites to ${outputPath}`);
  for (const [type, count] of countByType) {
    console.log(`  ${type}: ${count}`);
  }
  if (rejected > 0) {
    console.warn(`Rejected ${rejected} element sets that failed validation.`);
  }
}

await main();
