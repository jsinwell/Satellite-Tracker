import { OBJECT_TYPES } from '../core/catalog';
import { CONSTELLATION_IDS } from '../core/constellation';
import { allEnabled, type Filters, SHOW_EVERYTHING } from '../core/filter';
import { isObserver, type Observer } from '../core/observer';
import { ORBIT_REGIMES } from '../core/orbit';

/**
 * What this browser remembers between visits: how the view was set up, and
 * where the viewer said they are. Kept in local storage, which can be
 * unavailable (private windows, blocked site data) or hold anything an
 * earlier version wrote, so reading is forgiving and writing may quietly fail.
 * The clock is not kept, since a visit should start in the present, and the
 * selected satellite lives in the URL.
 */

/** What a satellite's color stands for. */
export type ColorBy = 'type' | 'constellation';

/** What can be drawn for the selected satellite, each of which can be turned off. */
export const OVERLAYS = ['orbit', 'groundTrack', 'coverage'] as const;
export type Overlay = (typeof OVERLAYS)[number];

export interface Settings {
  colorBy: ColorBy;
  filters: Filters;
  overlays: Readonly<Record<Overlay, boolean>>;
  /** Whether the Earth is drawn with its clouds. */
  clouds: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  colorBy: 'type',
  filters: SHOW_EVERYTHING,
  overlays: allEnabled(OVERLAYS),
  clouds: true,
};

const SETTINGS_KEY = 'satellite-tracker.settings';
const OBSERVER_KEY = 'satellite-tracker.observer';
/** No launch is earlier than Sputnik, and a year this far out is a corrupted value. */
const LAUNCH_YEARS = { first: 1957, last: 2200 } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * One saved flag per key, falling back to the default for any key that is
 * missing or not a boolean. A key added since the settings were saved (a new
 * constellation, say) gets its default; one that has since gone is dropped.
 */
function flags<K extends string>(
  keys: readonly K[],
  saved: unknown,
  fallback: Readonly<Record<K, boolean>>,
): Record<K, boolean> {
  const source = isRecord(saved) ? saved : {};
  return Object.fromEntries(
    keys.map((key) => [key, typeof source[key] === 'boolean' ? source[key] : fallback[key]]),
  ) as Record<K, boolean>;
}

function launchedBy(saved: unknown): number | null {
  return typeof saved === 'number' &&
    Number.isInteger(saved) &&
    saved >= LAUNCH_YEARS.first &&
    saved <= LAUNCH_YEARS.last
    ? saved
    : null;
}

/**
 * Settings as saved by this or any earlier version, or anything at all:
 * whatever still makes sense is kept, and the rest is the default.
 */
export function parseSettings(raw: unknown): Settings {
  const saved = isRecord(raw) ? raw : {};
  const filters = isRecord(saved.filters) ? saved.filters : {};
  const colorBy: ColorBy = saved.colorBy === 'constellation' ? 'constellation' : 'type';
  const { filters: defaults } = DEFAULT_SETTINGS;
  return {
    colorBy,
    filters: {
      // Only the filter that goes with the color scheme is shown in the
      // legend, so the other is always kept clear; a hidden filter could not
      // be turned off again.
      types:
        colorBy === 'type'
          ? flags(OBJECT_TYPES, filters.types, defaults.types)
          : allEnabled(OBJECT_TYPES),
      constellations:
        colorBy === 'constellation'
          ? flags(CONSTELLATION_IDS, filters.constellations, defaults.constellations)
          : allEnabled(CONSTELLATION_IDS),
      regimes: flags(ORBIT_REGIMES, filters.regimes, defaults.regimes),
      launchedBy: launchedBy(filters.launchedBy),
    },
    overlays: flags(OVERLAYS, saved.overlays, DEFAULT_SETTINGS.overlays),
    clouds: typeof saved.clouds === 'boolean' ? saved.clouds : DEFAULT_SETTINGS.clouds,
  };
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered next time, which is all that is lost.
  }
}

export function loadSettings(): Settings {
  return parseSettings(read(SETTINGS_KEY));
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/** Where the viewer said they are on an earlier visit, if anywhere. */
export function loadObserver(): Observer | null {
  const saved = read(OBSERVER_KEY);
  return isObserver(saved) ? { latitude: saved.latitude, longitude: saved.longitude } : null;
}

export function saveObserver(observer: Observer | null): void {
  write(OBSERVER_KEY, observer);
}
