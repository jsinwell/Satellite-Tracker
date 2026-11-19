/**
 * Fetches everything the app loads at startup: the satellite catalog, and the
 * picture of the Earth's clouds. `npm run data`.
 *
 * Usage: node scripts/fetch-data.ts [--fresh] [catalog output path]
 *
 * Both parts read the same arguments; see each for what it does with them.
 * The catalog comes first and must succeed. The clouds never fail.
 */

await import('./fetch-catalog.ts');
await import('./fetch-clouds.ts');
