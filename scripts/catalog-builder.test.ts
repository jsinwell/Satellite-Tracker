import { describe, expect, it } from 'vitest';
import { iss } from '../src/core/__fixtures__/satellites.ts';
import type { Catalog, SatelliteRecord } from '../src/core/catalog.ts';
import {
  type BuildContext,
  buildCatalog,
  GP_GROUPS,
  GP_URL,
  parseCsvLine,
  SATCAT_URL,
} from './catalog-builder.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const HOUR_MS = 3_600_000;
const PUBLISHED_URL = 'https://live.example/data/catalog.json';
const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR_MS).toISOString();
const gpUrl = (group: string) => `${GP_URL}?GROUP=${group}&FORMAT=json`;

/** An element set as CelesTrak's GP endpoint returns it. */
function omm(noradId: number, name: string, overrides: Record<string, unknown> = {}) {
  return {
    OBJECT_NAME: name,
    OBJECT_ID: '1998-067A',
    EPOCH: '2026-11-16T08:00:00.000000',
    MEAN_MOTION: 15.49,
    ECCENTRICITY: 0.0007,
    INCLINATION: 51.63,
    RA_OF_ASC_NODE: 269.2,
    ARG_OF_PERICENTER: 30.3,
    MEAN_ANOMALY: 329.8,
    NORAD_CAT_ID: noradId,
    BSTAR: 0.00017,
    MEAN_MOTION_DOT: 0.00009,
    MEAN_MOTION_DDOT: 0,
    ...overrides,
  };
}

function satcat(...rows: string[]): string {
  return ['OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OWNER,LAUNCH_DATE', ...rows].join('\n');
}

function record(noradId: number, overrides: Partial<SatelliteRecord> = {}): SatelliteRecord {
  return { ...iss, noradId, name: `SAT ${noradId}`, ...overrides };
}

function published(
  ageHours: number,
  satellites: SatelliteRecord[],
  metadataAgeHours: number | null = null,
): string {
  const catalog: Catalog = {
    schemaVersion: 1,
    generatedAt: hoursAgo(ageHours),
    metadataFetchedAt: metadataAgeHours === null ? null : hoursAgo(metadataAgeHours),
    source: 'test',
    satellites,
  };
  return JSON.stringify(catalog);
}

/** Responses for every GP group: the given ones, and an empty list for the rest. */
function gpResponses(groups: Record<string, unknown[]>): Record<string, string> {
  return Object.fromEntries(
    GP_GROUPS.map(({ name }) => [gpUrl(name), JSON.stringify(groups[name] ?? [])]),
  );
}

const refused = new Error('responded 403 Forbidden');

/** Runs a build against canned responses; any URL without one is a 404. */
async function build(refresh: boolean, responses: Record<string, string | Error>) {
  const requested: string[] = [];
  const context: BuildContext = {
    refresh,
    publishedUrl: PUBLISHED_URL,
    now: () => NOW,
    log: () => {},
    fetchText: async (url) => {
      requested.push(url);
      const response = responses[url] ?? new Error(`${url} responded 404 Not Found`);
      if (response instanceof Error) throw response;
      return response;
    },
  };
  const catalog = await buildCatalog(context);
  const askedCelestrak = requested.some((url) => url.includes('celestrak.org'));
  return { catalog, requested, askedCelestrak };
}

const byId = (catalog: Catalog, noradId: number) =>
  catalog.satellites.find((satellite) => satellite.noradId === noradId);

describe('a build that does not refresh (previews, local development)', () => {
  it('reuses the published catalog without contacting CelesTrak', async () => {
    const { catalog, askedCelestrak } = await build(false, {
      [PUBLISHED_URL]: published(30, [record(1)]),
    });

    expect(askedCelestrak).toBe(false);
    expect(catalog.generatedAt).toBe(hoursAgo(30)); // its true age is preserved
    expect(catalog.satellites).toHaveLength(1);
  });

  it('builds from CelesTrak when nothing has been published yet', async () => {
    const { catalog } = await build(false, {
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)')] }),
      [SATCAT_URL]: satcat('ISS (ZARYA),1998-067A,25544,PAY,ISS,1998-11-20'),
    });

    expect(byId(catalog, 25544)).toMatchObject({ objectType: 'payload', owner: 'ISS' });
  });

  it('does not reuse a published catalog that is days out of date', async () => {
    const { catalog, askedCelestrak } = await build(false, {
      [PUBLISHED_URL]: published(100, [record(1)]),
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)')] }),
    });

    expect(askedCelestrak).toBe(true);
    expect(catalog.generatedAt).toBe(hoursAgo(0));
  });
});

describe('a build that refreshes (production)', () => {
  it('skips CelesTrak when the published elements are newer than its update interval', async () => {
    const { catalog, askedCelestrak } = await build(true, {
      [PUBLISHED_URL]: published(1, [record(1)]),
    });

    expect(askedCelestrak).toBe(false);
    expect(catalog.generatedAt).toBe(hoursAgo(1));
  });

  it('fetches fresh elements and joins SATCAT fields onto them', async () => {
    const { catalog } = await build(true, {
      [PUBLISHED_URL]: published(6, [record(1)]),
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)'), omm(43013, 'NOAA 20')] }),
      [SATCAT_URL]: satcat(
        'ISS (ZARYA),1998-067A,25544,PAY,ISS,1998-11-20',
        'NOAA 20,2017-073A,43013,PAY,US,2017-11-18',
      ),
    });

    expect(catalog.generatedAt).toBe(hoursAgo(0));
    expect(catalog.metadataFetchedAt).toBe(hoursAgo(0));
    expect(catalog.satellites.map((satellite) => satellite.noradId)).toEqual([25544, 43013]);
    expect(byId(catalog, 43013)).toMatchObject({
      name: 'NOAA 20',
      objectType: 'payload',
      owner: 'US',
      launchDate: '2017-11-18',
      elements: { epoch: '2026-11-16T08:00:00.000000Z', meanMotion: 15.49 },
    });
  });

  it('does not download SATCAT again while its fields are less than a day old', async () => {
    const carried = record(25544, {
      objectType: 'payload',
      owner: 'ISS',
      launchDate: '1998-11-20',
    });
    const { catalog, requested } = await build(true, {
      [PUBLISHED_URL]: published(6, [carried], 12),
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)')] }),
    });

    expect(requested).not.toContain(SATCAT_URL);
    expect(byId(catalog, 25544)).toMatchObject({ owner: 'ISS', launchDate: '1998-11-20' });
    expect(catalog.metadataFetchedAt).toBe(hoursAgo(12)); // unchanged: still due in 12 h
  });

  it('downloads SATCAT again once its fields are a day old', async () => {
    const { catalog, requested } = await build(true, {
      [PUBLISHED_URL]: published(6, [record(25544, { owner: 'OLD' })], 25),
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)')] }),
      [SATCAT_URL]: satcat('ISS (ZARYA),1998-067A,25544,PAY,ISS,1998-11-20'),
    });

    expect(requested).toContain(SATCAT_URL);
    expect(byId(catalog, 25544)?.owner).toBe('ISS');
    expect(catalog.metadataFetchedAt).toBe(hoursAgo(0));
  });

  it('still succeeds when SATCAT refuses, keeping known fields and inferring the rest', async () => {
    const known = record(25544, { objectType: 'payload', owner: 'ISS', launchDate: '1998-11-20' });
    const { catalog } = await build(true, {
      [PUBLISHED_URL]: published(6, [known], 30),
      ...gpResponses({
        active: [omm(25544, 'ISS (ZARYA)'), omm(70001, 'NEWSAT 1'), omm(70002, 'CZ-5 R/B')],
        'fengyun-1c-debris': [omm(29733, 'FENGYUN 1C DEB'), omm(70003, 'OBJECT A')],
      }),
      [SATCAT_URL]: refused,
    });

    expect(byId(catalog, 25544)).toMatchObject({ objectType: 'payload', owner: 'ISS' });
    // New since the last SATCAT download: classified by name, then by group.
    expect(byId(catalog, 70001)).toMatchObject({ objectType: 'payload', owner: null });
    expect(byId(catalog, 70002)?.objectType).toBe('rocket-body');
    expect(byId(catalog, 29733)?.objectType).toBe('debris');
    expect(byId(catalog, 70003)?.objectType).toBe('debris');
    // Still marked as overdue, so the next build tries SATCAT again.
    expect(catalog.metadataFetchedAt).toBe(hoursAgo(30));
  });

  it('does not spend a SATCAT download when the elements cannot be fetched', async () => {
    const { requested } = await build(true, {
      [PUBLISHED_URL]: published(6, [record(1)]),
      [gpUrl('active')]: refused,
      [SATCAT_URL]: satcat(),
    });

    expect(requested).not.toContain(SATCAT_URL);
  });

  it('falls back to the published catalog when CelesTrak refuses the elements', async () => {
    const { catalog } = await build(true, {
      [PUBLISHED_URL]: published(6, [record(1)]),
      [gpUrl('active')]: refused,
    });

    expect(catalog.generatedAt).toBe(hoursAgo(6));
    expect(catalog.satellites).toHaveLength(1);
  });

  it('fails when CelesTrak refuses and there is nothing published to fall back on', async () => {
    await expect(build(true, { [gpUrl('active')]: refused })).rejects.toThrow(
      /no published catalog to fall back on.*403/,
    );
  });

  it('fails rather than reuse a published catalog that is days out of date', async () => {
    await expect(
      build(true, { [PUBLISHED_URL]: published(100, [record(1)]), [gpUrl('active')]: refused }),
    ).rejects.toThrow(/no published catalog/);
  });

  it('treats a non-JSON reply (a rate-limit notice, say) as a failure', async () => {
    const { catalog } = await build(true, {
      [PUBLISHED_URL]: published(6, [record(1)]),
      [gpUrl('active')]: 'GP data has not updated since your last successful download',
    });

    expect(catalog.generatedAt).toBe(hoursAgo(6));
  });

  it('ignores a published file that is not a catalog', async () => {
    // A host with no such file may answer with its HTML fallback page instead of a 404.
    const { catalog } = await build(true, {
      [PUBLISHED_URL]: '<!DOCTYPE html><html></html>',
      ...gpResponses({ active: [omm(25544, 'ISS (ZARYA)')] }),
    });

    expect(catalog.satellites).toHaveLength(1);
  });
});

describe('assembling records', () => {
  const fresh = (groups: Record<string, unknown[]>) =>
    build(true, { ...gpResponses(groups), [SATCAT_URL]: satcat() });

  it('keeps one record for a satellite listed in several groups', async () => {
    const { catalog } = await fresh({
      active: [omm(29733, 'IN ACTIVE')],
      'fengyun-1c-debris': [omm(29733, 'IN DEBRIS')],
    });

    expect(catalog.satellites).toHaveLength(1);
    expect(catalog.satellites[0].name).toBe('IN ACTIVE');
  });

  it('drops element sets that fail validation and keeps the rest', async () => {
    const { catalog } = await fresh({
      active: [
        omm(1, 'GOOD'),
        omm(2, 'HYPERBOLIC', { ECCENTRICITY: 1.2 }),
        omm(3, 'NO MOTION', { MEAN_MOTION: 0 }),
        omm(4, 'BAD EPOCH', { EPOCH: 'yesterday' }),
        { OBJECT_NAME: 'INCOMPLETE' },
      ],
    });

    expect(catalog.satellites.map((satellite) => satellite.name)).toEqual(['GOOD']);
  });

  it('accepts numbers sent as strings, as some OMM sources do', async () => {
    const { catalog } = await fresh({
      active: [omm(25544, 'ISS (ZARYA)', { NORAD_CAT_ID: '25544', MEAN_MOTION: '15.49' })],
    });

    expect(catalog.satellites[0]).toMatchObject({
      noradId: 25544,
      elements: { meanMotion: 15.49 },
    });
  });

  it('refuses to produce an empty catalog', async () => {
    await expect(fresh({})).rejects.toThrow(/no valid element sets/);
  });

  it('sorts satellites by NORAD ID', async () => {
    const { catalog } = await fresh({ active: [omm(30, 'C'), omm(10, 'A'), omm(20, 'B')] });
    expect(catalog.satellites.map((satellite) => satellite.noradId)).toEqual([10, 20, 30]);
  });
});

describe('parseCsvLine', () => {
  it('splits plain fields, keeping empty ones', () => {
    expect(parseCsvLine('a,,c,')).toEqual(['a', '', 'c', '']);
  });

  it('keeps commas and escaped quotes inside quoted fields', () => {
    expect(parseCsvLine('"SMITH, J",1,"say ""hi"""')).toEqual(['SMITH, J', '1', 'say "hi"']);
  });
});
