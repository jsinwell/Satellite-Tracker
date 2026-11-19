import { describe, expect, it } from 'vitest';
import {
  CLOUDS_INFO_FILE,
  cloudCover,
  cloudsDrawnAt,
  parseCloudsInfo,
} from '../src/core/clouds.ts';
import {
  buildClouds,
  CLOUD_MAPS,
  CLOUDS_SOURCE_URL,
  type CloudsContext,
} from './clouds-builder.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const HOUR_MS = 3_600_000;
const PUBLISHED_URL = 'https://live.example/data/';
const hoursAgo = (hours: number) => new Date(NOW - hours * HOUR_MS).toISOString();

/** Bytes that pass for a JPEG, told apart by `mark`. */
function picture(mark: number): Uint8Array {
  const bytes = new Uint8Array(2048).fill(mark);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  return bytes;
}

const FROM_SOURCE = 1;
const FROM_SITE = 2;

function sourceUrls(): Record<string, Uint8Array> {
  return Object.fromEntries(
    CLOUD_MAPS.map((map) => [`${CLOUDS_SOURCE_URL}/${map.source}`, picture(FROM_SOURCE)]),
  );
}

function publishedUrls(ageHours: number): Record<string, Uint8Array> {
  const info = { schemaVersion: 1, fetchedAt: hoursAgo(ageHours), source: CLOUDS_SOURCE_URL };
  return {
    [PUBLISHED_URL + CLOUDS_INFO_FILE]: new TextEncoder().encode(JSON.stringify(info)),
    ...Object.fromEntries(CLOUD_MAPS.map((map) => [PUBLISHED_URL + map.file, picture(FROM_SITE)])),
  };
}

function contextWith(
  urls: Record<string, Uint8Array>,
  refresh: boolean,
): CloudsContext & { asked: string[]; logged: string[] } {
  const asked: string[] = [];
  const logged: string[] = [];
  return {
    asked,
    logged,
    fetchBytes: async (url) => {
      asked.push(url);
      const bytes = urls[url];
      if (!bytes) throw new Error(`${url} responded 404`);
      return bytes;
    },
    now: () => NOW,
    refresh,
    publishedUrl: PUBLISHED_URL,
    log: (message) => logged.push(message),
  };
}

const askedSource = (asked: string[]) => asked.some((url) => url.startsWith(CLOUDS_SOURCE_URL));
const marks = (maps: { bytes: Uint8Array }[]) => maps.map(({ bytes }) => bytes[2]);

describe('buildClouds', () => {
  it('reuses what the live site serves on a build that is not the refreshing one', async () => {
    const context = contextWith({ ...publishedUrls(40), ...sourceUrls() }, false);
    const clouds = await buildClouds(context);
    expect(clouds?.info.fetchedAt).toBe(hoursAgo(40));
    expect(marks(clouds?.maps ?? [])).toEqual([FROM_SITE, FROM_SITE]);
    expect(askedSource(context.asked)).toBe(false);
  });

  it('asks the source on a refreshing build once the published picture has aged', async () => {
    const context = contextWith({ ...publishedUrls(5), ...sourceUrls() }, true);
    const clouds = await buildClouds(context);
    expect(clouds?.info.fetchedAt).toBe(new Date(NOW).toISOString());
    expect(clouds?.maps.map(({ file }) => file)).toEqual(CLOUD_MAPS.map(({ file }) => file));
    expect(marks(clouds?.maps ?? [])).toEqual([FROM_SOURCE, FROM_SOURCE]);
  });

  it('does not ask the source for a picture it cannot have renewed yet', async () => {
    const context = contextWith({ ...publishedUrls(2), ...sourceUrls() }, true);
    const clouds = await buildClouds(context);
    expect(clouds?.info.fetchedAt).toBe(hoursAgo(2));
    expect(askedSource(context.asked)).toBe(false);
  });

  it('asks the source when the live site has none yet, whatever the build', async () => {
    const context = contextWith(sourceUrls(), false);
    const clouds = await buildClouds(context);
    expect(marks(clouds?.maps ?? [])).toEqual([FROM_SOURCE, FROM_SOURCE]);
  });

  it('falls back on the published picture when the source fails', async () => {
    const context = contextWith(publishedUrls(30), true);
    const clouds = await buildClouds(context);
    expect(clouds?.info.fetchedAt).toBe(hoursAgo(30));
    expect(context.logged.join(' ')).toContain('reusing the published one');
  });

  it('builds without clouds, rather than failing, when there are none to be had', async () => {
    const context = contextWith({}, true);
    expect(await buildClouds(context)).toBeNull();
    expect(context.logged.join(' ')).toContain('building without one');
  });

  it('does not take a page of HTML for a picture', async () => {
    const page = new TextEncoder().encode(`<!doctype html>${'x'.repeat(4000)}`);
    const urls = Object.fromEntries(Object.keys(sourceUrls()).map((url) => [url, page]));
    expect(await buildClouds(contextWith(urls, true))).toBeNull();
  });

  it('ignores a published picture whose description it does not understand', async () => {
    const urls = publishedUrls(1);
    urls[PUBLISHED_URL + CLOUDS_INFO_FILE] = new TextEncoder().encode('{"schemaVersion":7}');
    const clouds = await buildClouds(contextWith({ ...urls, ...sourceUrls() }, false));
    expect(marks(clouds?.maps ?? [])).toEqual([FROM_SOURCE, FROM_SOURCE]);
  });
});

describe('parseCloudsInfo', () => {
  it('takes what the builder writes', () => {
    const info = { schemaVersion: 1, fetchedAt: hoursAgo(1), source: CLOUDS_SOURCE_URL };
    expect(parseCloudsInfo(info)).toEqual(info);
  });

  it.each([
    null,
    'clouds',
    {},
    { schemaVersion: 2, fetchedAt: hoursAgo(1), source: 'x' },
    { schemaVersion: 1, fetchedAt: 'yesterday', source: 'x' },
    { schemaVersion: 1, fetchedAt: hoursAgo(1) },
  ])('refuses %j', (raw) => {
    expect(parseCloudsInfo(raw)).toBeNull();
  });
});

describe('cloudsDrawnAt', () => {
  it('draws them in full where the satellites see well', () => {
    for (const latitude of [0, 30, -45, 60]) expect(cloudsDrawnAt(latitude)).toBe(1);
  });

  it('draws none at the poles, north or south', () => {
    for (const latitude of [80, 90, -78, -90]) expect(cloudsDrawnAt(latitude)).toBe(0);
  });

  it('thins them out in between', () => {
    expect(cloudsDrawnAt(69)).toBeCloseTo(0.5, 6);
    expect(cloudsDrawnAt(-65)).toBeGreaterThan(cloudsDrawnAt(-72));
  });
});

describe('cloudCover', () => {
  it('is none for clear sky and all for thick cloud', () => {
    expect(cloudCover(0)).toBe(0);
    expect(cloudCover(0.08)).toBe(0);
    expect(cloudCover(0.9)).toBe(1);
    expect(cloudCover(1)).toBe(1);
  });

  it('grows with the brightness of the picture in between', () => {
    let last = 0;
    for (const value of [0.2, 0.35, 0.5, 0.65, 0.78]) {
      const cover = cloudCover(value);
      expect(cover).toBeGreaterThan(last);
      expect(cover).toBeLessThan(1);
      last = cover;
    }
  });
});
