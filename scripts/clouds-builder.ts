/**
 * Decides where a build's picture of the Earth's clouds comes from.
 *
 * The picture is Matt Eason's live cloud map (github.com/matteason/live-cloud-maps):
 * one image of the whole Earth's cloud cover, put together from the weather
 * satellites' data that EUMETSAT publishes, and renewed every three hours.
 * It is free to use, with EUMETSAT credited, and is served by one person's
 * project, so it is asked for no more often than it can have changed:
 *
 * - Only a *refreshing* build (production) asks the source at all. Every
 *   other build — branch previews, local development — reuses what the live
 *   site is already serving.
 * - A refreshing build skips the source too if the published picture is
 *   younger than the source's three hours: there would be nothing new to get.
 * - Clouds are decoration. If no picture can be had from anywhere, the build
 *   goes on without one and the app draws none; nothing here fails a build.
 *
 * All I/O is injected, so the policy above is covered by unit tests.
 */

import {
  CLOUDS_INFO_FILE,
  type CloudsInfo,
  CLOUD_MAPS as MAP_FILES,
  parseCloudsInfo,
} from '../src/core/clouds.ts';

export const CLOUDS_SOURCE_URL = 'https://clouds.matteason.co.uk/images';

/** Each size of the picture: what the app calls it, and where the source keeps it. */
export const CLOUD_MAPS = [
  { file: MAP_FILES.large, source: '4096x2048/clouds.jpg' },
  { file: MAP_FILES.small, source: '2048x1024/clouds.jpg' },
] as const;

const HOUR_MS = 3_600_000;
/** The source renews its picture this often; asking sooner gains nothing. */
export const CLOUDS_REFRESH_INTERVAL_MS = 3 * HOUR_MS;

export interface CloudsBuild {
  info: CloudsInfo;
  maps: { file: string; bytes: Uint8Array }[];
}

export interface CloudsContext {
  /** Downloads a URL, rejecting on any unsuccessful response. */
  fetchBytes(url: string): Promise<Uint8Array>;
  now(): number;
  /** True for the build that keeps the data current; see the module comment. */
  refresh: boolean;
  /** The folder the live site serves its data from, ending in a slash. */
  publishedUrl: string;
  log(message: string): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Looks like a JPEG: a server that has no such file may answer with a page of HTML. */
function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 1024 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

async function fetchMaps(
  context: CloudsContext,
  urlOf: (map: (typeof CLOUD_MAPS)[number]) => string,
): Promise<CloudsBuild['maps']> {
  return Promise.all(
    CLOUD_MAPS.map(async (map) => {
      const bytes = await context.fetchBytes(urlOf(map));
      if (!isJpeg(bytes)) throw new Error(`${urlOf(map)} is not a picture`);
      return { file: map.file, bytes };
    }),
  );
}

/** What the live site is serving, or null if it has none or it cannot be read. */
async function fetchPublished(context: CloudsContext): Promise<CloudsBuild | null> {
  try {
    const text = new TextDecoder().decode(
      await context.fetchBytes(context.publishedUrl + CLOUDS_INFO_FILE),
    );
    const info = parseCloudsInfo(JSON.parse(text));
    if (!info) return null;
    return { info, maps: await fetchMaps(context, (map) => context.publishedUrl + map.file) };
  } catch {
    return null;
  }
}

/** The picture for this build, or null if there is none to be had. */
export async function buildClouds(context: CloudsContext): Promise<CloudsBuild | null> {
  const published = await fetchPublished(context);

  if (published && !context.refresh) {
    context.log(`Reusing the published clouds from ${published.info.fetchedAt}.`);
    return published;
  }
  if (
    published &&
    context.now() - Date.parse(published.info.fetchedAt) < CLOUDS_REFRESH_INTERVAL_MS
  ) {
    context.log(`The published clouds (${published.info.fetchedAt}) are still current.`);
    return published;
  }

  try {
    const maps = await fetchMaps(context, (map) => `${CLOUDS_SOURCE_URL}/${map.source}`);
    const info: CloudsInfo = {
      schemaVersion: 1,
      fetchedAt: new Date(context.now()).toISOString(),
      source: CLOUDS_SOURCE_URL,
    };
    context.log(`Fetched the clouds as of ${info.fetchedAt}.`);
    return { info, maps };
  } catch (error) {
    if (published) {
      context.log(`The cloud map failed (${messageOf(error)}); reusing the published one.`);
      return published;
    }
    context.log(`No cloud map could be had (${messageOf(error)}); building without one.`);
    return null;
  }
}
