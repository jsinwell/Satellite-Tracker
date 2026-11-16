import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'vitest';
import { fixtures } from './__fixtures__/satellites';
import type { Catalog, SatelliteRecord } from './catalog';
import { Propagator, STATE_STRIDE } from './propagator';

/**
 * Measures the per-refresh cost of the simulation worker. Uses the full
 * catalog when `npm run data` has been run, so the number reflects what the
 * app actually does; otherwise it falls back to the fixtures, repeated.
 */
const CATALOG_PATH = 'public/data/catalog.json';

function loadSatellites(): SatelliteRecord[] {
  if (existsSync(CATALOG_PATH)) {
    return (JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Catalog).satellites;
  }
  return Array.from({ length: 20_000 }, (_, i) => fixtures[i % fixtures.length]);
}

const satellites = loadSatellites();
const propagator = new Propagator(satellites);
const state = new Float32Array(satellites.length * STATE_STRIDE);
let timeMs = Date.parse(fixtures[0].elements.epoch);

describe(`${satellites.length} satellites`, () => {
  test('initialise SGP4 for every satellite', async ({ bench }) => {
    await bench('initialise', () => {
      new Propagator(satellites);
    }).run();
  });

  test('propagate every satellite to one instant', async ({ bench }) => {
    await bench('propagate', () => {
      timeMs += 1000;
      propagator.propagate(timeMs, state);
    }).run();
  });
});
