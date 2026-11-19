/**
 * The picture of the Earth's clouds: what the build leaves for the app to
 * find, and how the picture is read. Where it comes from, and how often, is
 * in `scripts/clouds-builder.ts`.
 */

/**
 * The picture in two sizes: the large one for screens that can show it, and
 * a small one for phones, which could not, and should not have to download it.
 */
export const CLOUD_MAPS = { large: 'clouds-4k.jpg', small: 'clouds-2k.jpg' } as const;

/** What says when the picture is from; the app reads it before asking for the picture. */
export const CLOUDS_INFO_FILE = 'clouds.json';

export interface CloudsInfo {
  schemaVersion: 1;
  /** When the picture was fetched from its source: it shows the weather of up to three hours before. */
  fetchedAt: string;
  source: string;
}

/** What `clouds.json` holds, or null if `raw` is not one this version understands. */
export function parseCloudsInfo(raw: unknown): CloudsInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { schemaVersion, fetchedAt, source } = raw as Record<string, unknown>;
  if (schemaVersion !== 1 || typeof fetchedAt !== 'string' || typeof source !== 'string') {
    return null;
  }
  return Number.isNaN(Date.parse(fetchedAt)) ? null : { schemaVersion, fetchedAt, source };
}

/**
 * The picture is white where there is cloud and black where there is none,
 * with thin cloud and haze in between. How much of what is under a place is
 * hidden, 0 to 1, for the picture's value there: the faintest grays are left
 * out, as they are as much the picture's noise as weather.
 */
export const CLOUD_COVER = { from: 0.1, to: 0.8 } as const;

/**
 * The weather satellites the picture is made from sit over the equator, and
 * see the ground at a glancing angle beyond about 60° of latitude and not at
 * all near the poles, which the picture fills in with a flat gray. So the
 * clouds are drawn in full only up to the first of these latitudes, degrees,
 * and thin out to none by the second, rather than painting the poles white.
 */
export const CLOUD_LATITUDES = { full: 62, none: 76 } as const;

/** How much of the picture's cloud is drawn at a latitude, 0 to 1. */
export function cloudsDrawnAt(latitudeDeg: number): number {
  const { full, none } = CLOUD_LATITUDES;
  const t = Math.min(1, Math.max(0, (Math.abs(latitudeDeg) - full) / (none - full)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Seen from the ground, the clouds are one layer this high, km, about where
 * fair-weather cloud sits, and are lost in the haze over about this distance.
 */
export const SKY_CLOUDS = { heightKm: 3, hazeKm: 80 } as const;

/**
 * The clouds overhead drift with the wind, which is made up, as they are:
 * the picture they come from is one moment's, and says nothing of it.
 *
 * `windMs` is how fast, m/s: a fresh wind for their height. They go with the
 * simulated time, but no more than `fastest` times as fast as life: run any
 * faster they would only flicker, and a jump to another date is not weeks
 * of wind. `shear` is how much faster each finer size of lump goes than the
 * one before, as a share of the wind, which is what makes the clouds change
 * shape as they go and not slide over like a picture. And the drift starts
 * again from nothing after `periodKm`, to keep the numbers small enough to
 * stay exact: the clouds jump then, once in two days and more of watching.
 */
export const CLOUD_DRIFT = { windMs: 20, fastest: 40, shear: 0.06, periodKm: 4096 } as const;

/**
 * Which way the clouds go at a latitude, as shares of the wind's speed east
 * and north: with the trade winds toward the west in the tropics, and with
 * the westerlies toward the east beyond them, and a little toward the pole.
 */
export function cloudWind(
  latitudeDeg: number,
  out: { east: number; north: number },
): { east: number; north: number } {
  const t = Math.min(1, Math.max(0, (Math.abs(latitudeDeg) - 20) / 15));
  const east = 2 * t * t * (3 - 2 * t) - 1;
  const north = 0.3 * Math.sign(latitudeDeg || 1);
  const length = Math.hypot(east, north);
  // Where the two winds meet there is still some: clouds never just stop.
  const speed = Math.max(0.35, Math.abs(east));
  out.east = (east / length) * speed;
  out.north = (north / length) * speed;
  return out;
}

const wind = { east: 0, north: 0 };

/**
 * Moves `drift`, km east and north, by the wind at `latitudeDeg` over
 * `simSeconds` of simulated time, which took `realSeconds` to pass.
 */
export function driftClouds(
  drift: { x: number; y: number },
  latitudeDeg: number,
  simSeconds: number,
  realSeconds: number,
): void {
  if (!Number.isFinite(simSeconds) || !(realSeconds > 0)) return;
  const most = CLOUD_DRIFT.fastest * realSeconds;
  const seconds = Math.min(most, Math.max(-most, simSeconds));
  cloudWind(latitudeDeg, wind);
  const km = (CLOUD_DRIFT.windMs * seconds) / 1000;
  drift.x = (drift.x + wind.east * km) % CLOUD_DRIFT.periodKm;
  drift.y = (drift.y + wind.north * km) % CLOUD_DRIFT.periodKm;
}

export function cloudCover(value: number): number {
  const t = Math.min(
    1,
    Math.max(0, (value - CLOUD_COVER.from) / (CLOUD_COVER.to - CLOUD_COVER.from)),
  );
  return t * t * (3 - 2 * t);
}
