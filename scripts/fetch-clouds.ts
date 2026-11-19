/**
 * Writes the picture of the Earth's clouds that the app draws over the globe.
 *
 * Usage: node scripts/fetch-clouds.ts [--fresh]
 *
 * By default this reuses the picture the live site is serving, and only the
 * production build downloads a new one; `--fresh` forces a download. The
 * reasons, and the rest of the policy, are in `clouds-builder.ts`. It never
 * fails: with no picture to be had, the app goes without clouds.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CLOUDS_INFO_FILE } from '../src/core/clouds.ts';
import { buildClouds } from './clouds-builder.ts';

const DEFAULT_OUTPUT = 'public/data';
const PUBLISHED_DATA_URL =
  process.env.PUBLISHED_DATA_URL ?? 'https://jsinwell-satellite-tracker.pages.dev/data/';
/** Cloudflare Pages sets CF_PAGES_BRANCH on every build; this is the branch it deploys live. */
const PRODUCTION_BRANCH = 'main';

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// Run as part of `fetch-data.ts`, the arguments are the catalog's too: the
// path it takes is not this script's to use.
const { values } = parseArgs({
  options: { fresh: { type: 'boolean', default: false } },
  allowPositionals: true,
});
const outputFolder = resolve(DEFAULT_OUTPUT);

const clouds = await buildClouds({
  fetchBytes,
  now: Date.now,
  refresh: values.fresh || process.env.CF_PAGES_BRANCH === PRODUCTION_BRANCH,
  publishedUrl: PUBLISHED_DATA_URL,
  log: console.log,
});

if (clouds) {
  await mkdir(outputFolder, { recursive: true });
  for (const { file, bytes } of clouds.maps) {
    await writeFile(join(outputFolder, file), bytes);
    console.log(`Wrote ${file} (${Math.round(bytes.length / 1024)} KB)`);
  }
  // Last, so that it is never there to point at pictures that are not.
  await writeFile(join(outputFolder, CLOUDS_INFO_FILE), JSON.stringify(clouds.info));
}
