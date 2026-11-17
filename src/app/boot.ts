import { CatalogError, parseCatalog } from '../core/catalog';
import { realTimeClock, wallNow, withSimTime } from '../core/clock';
import { useApp } from './store';
import { createWorld, type World } from './world';

const CATALOG_URL = `${import.meta.env.BASE_URL}data/catalog.json`;
const SATELLITE_PARAM = 'sat';
const RIDE_PARAM = 'ride';
const TIME_PARAM = 't';

async function fetchCatalog(): Promise<unknown> {
  const response = await fetch(CATALOG_URL);
  // A dev server answers a missing file with the app's HTML, so check the type too.
  const isJson = response.headers.get('content-type')?.includes('json') ?? false;
  if (response.status === 404 || (response.ok && !isJson)) {
    throw new CatalogError('No satellite catalog was found. Run `npm run data` to fetch one.');
  }
  if (!response.ok) {
    throw new CatalogError(`The satellite catalog could not be loaded (HTTP ${response.status}).`);
  }
  return response.json();
}

/**
 * Keeps `?sat=<NORAD ID>` in step with the selection, and `&ride=1` with
 * whether the camera is riding along with it, so a view can be linked to.
 */
function syncSelectionWithUrl(world: World): void {
  const params = new URLSearchParams(window.location.search);
  const index = world.indexByNoradId.get(Number(params.get(SATELLITE_PARAM)));
  if (index !== undefined) {
    useApp.getState().selectAndFocus(index);
    if (params.get(RIDE_PARAM) === '1') useApp.getState().setRiding(true);
  }

  useApp.subscribe((state, previous) => {
    if (state.selected === previous.selected && state.riding === previous.riding) return;
    const url = new URL(window.location.href);
    if (state.selected === null) {
      url.searchParams.delete(SATELLITE_PARAM);
    } else {
      url.searchParams.set(SATELLITE_PARAM, String(world.satellites[state.selected].noradId));
    }
    if (state.riding) url.searchParams.set(RIDE_PARAM, '1');
    else url.searchParams.delete(RIDE_PARAM);
    window.history.replaceState(null, '', url);
  });
}

/**
 * `?t=<ISO-8601 instant>` opens the app at that moment instead of the present.
 * Read once at startup; it is not kept in step afterward, since time runs on.
 */
function applyStartTimeFromUrl(): void {
  const requested = new URLSearchParams(window.location.search).get(TIME_PARAM);
  const simMs = requested === null ? Number.NaN : Date.parse(requested);
  if (Number.isNaN(simMs)) return;
  const now = wallNow();
  useApp.setState({ clock: withSimTime(realTimeClock(now), now, simMs) });
}

/** Loads the catalog, starts the simulation, and hands the app its world. */
export async function boot(): Promise<void> {
  const { ready, fail } = useApp.getState();
  try {
    const world = await createWorld(parseCatalog(await fetchCatalog()));
    world.simulation.onError = fail;
    applyStartTimeFromUrl();
    ready(world);
    syncSelectionWithUrl(world);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
