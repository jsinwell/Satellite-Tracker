/**
 * Writes the satellite catalog the app loads at startup.
 *
 * Usage: node scripts/fetch-catalog.ts [--fresh] [output path]
 *
 * By default this reuses the catalog the live site is serving, and only the
 * production build downloads from CelesTrak; `--fresh` forces a download.
 * The reasons, and the rest of the policy, are in `catalog-builder.ts`.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ObjectType } from '../src/core/catalog.ts';
import { buildCatalog } from './catalog-builder.ts';

const DEFAULT_OUTPUT = 'public/data/catalog.json';
const USER_AGENT = 'satellite-tracker (+https://github.com/jsinwell/Satellite-Tracker)';
const PUBLISHED_CATALOG_URL =
  process.env.PUBLISHED_CATALOG_URL ??
  'https://jsinwell-satellite-tracker.pages.dev/data/catalog.json';
/** Cloudflare Pages sets CF_PAGES_BRANCH on every build; this is the branch it deploys live. */
const PRODUCTION_BRANCH = 'main';

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

const { values, positionals } = parseArgs({
  options: { fresh: { type: 'boolean', default: false } },
  allowPositionals: true,
});
const outputPath = resolve(positionals[0] ?? DEFAULT_OUTPUT);

const catalog = await buildCatalog({
  fetchText,
  now: Date.now,
  refresh: values.fresh || process.env.CF_PAGES_BRANCH === PRODUCTION_BRANCH,
  publishedUrl: PUBLISHED_CATALOG_URL,
  log: console.log,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(catalog));

const countByType = new Map<ObjectType, number>();
for (const { objectType } of catalog.satellites) {
  countByType.set(objectType, (countByType.get(objectType) ?? 0) + 1);
}
console.log(`Wrote ${catalog.satellites.length} satellites to ${outputPath}`);
console.log(`  elements from ${catalog.generatedAt}`);
for (const [type, count] of countByType) {
  console.log(`  ${type}: ${count}`);
}
