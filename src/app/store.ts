import { create } from 'zustand';
import { OBJECT_TYPES, type ObjectType } from '../core/catalog';
import {
  type Clock,
  realTimeClock,
  simTimeAt,
  wallNow,
  withRate,
  withSimTime,
} from '../core/clock';
import { CONSTELLATION_IDS, type ConstellationId, soleEnabled } from '../core/constellation';
import {
  allEnabled,
  countVisible,
  type FacetCounts,
  type FilterSubjects,
  type Filters,
  facetCounts,
  SHOW_EVERYTHING,
  visibilityMask,
} from '../core/filter';
import { isObserver, type Observer } from '../core/observer';
import type { OrbitRegime } from '../core/orbit';
import type { World } from './world';

/** What a satellite's color stands for. */
export type ColorBy = 'type' | 'constellation';

const OBSERVER_KEY = 'satellite-tracker.observer';

/**
 * Where the viewer said they are, from a previous visit. Kept in this browser
 * only; storage can be unavailable or hold anything, so both are tolerated.
 */
function loadObserver(): Observer | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(OBSERVER_KEY) ?? 'null');
    return isObserver(saved) ? { latitude: saved.latitude, longitude: saved.longitude } : null;
  } catch {
    return null;
  }
}

function saveObserver(observer: Observer | null): void {
  try {
    if (observer) localStorage.setItem(OBSERVER_KEY, JSON.stringify(observer));
    else localStorage.removeItem(OBSERVER_KEY);
  } catch {
    // Not remembered next time, which is all that is lost.
  }
}

/** What can be drawn for the selected satellite, each of which can be turned off. */
export const OVERLAYS = ['orbit', 'groundTrack', 'coverage'] as const;
export type Overlay = (typeof OVERLAYS)[number];

interface AppState {
  phase: 'loading' | 'ready' | 'error';
  error: string | null;
  world: World | null;

  clock: Clock;
  /** Catalog index of the selected satellite. */
  selected: number | null;
  /** Catalog index of the satellite under the pointer. */
  hovered: number | null;
  /** Incremented to ask the camera to fly to the selected satellite. */
  focusRequests: number;
  /** Whether the camera is traveling with the selected satellite. */
  riding: boolean;
  /** Which drawings accompany the selected satellite. Kept from one selection to the next. */
  overlays: Readonly<Record<Overlay, boolean>>;
  /** Where the viewer is, for what is in their sky; null until they say. */
  observer: Observer | null;
  /** True while the next click on the Earth is to set `observer`. */
  pickingObserver: boolean;
  /** Incremented to ask the camera to fly to `observer`. */
  observerFocusRequests: number;

  colorBy: ColorBy;
  filters: Filters;
  /** One byte per satellite: 1 if it passes `filters`. Replaced, never mutated. */
  visible: Uint8Array;
  visibleCount: number;
  /** What each legend row stands for under the other filters. */
  counts: FacetCounts;
}

interface AppActions {
  ready(world: World): void;
  fail(message: string): void;
  /**
   * Selects a satellite without moving the camera: right for a click, where
   * the satellite is already in view.
   */
  select(index: number | null): void;
  hover(index: number | null): void;
  /** Flies the camera to the selected satellite. */
  focusSelected(): void;
  /** Selects a satellite that may be anywhere, and brings it into view. */
  selectAndFocus(index: number): void;
  /**
   * Starts or stops riding along with the selected satellite. Choosing another
   * satellite during the ride carries on with that one; clearing the selection
   * ends it.
   */
  setRiding(riding: boolean): void;
  toggleOverlay(overlay: Overlay): void;
  /** Sets or clears where the viewer is, and remembers it for next time. */
  setObserver(observer: Observer | null): void;
  setPickingObserver(picking: boolean): void;
  /**
   * Switches what color stands for. The legend only shows the filter that
   * matches, so the other one is reset rather than left on out of sight.
   */
  setColorBy(colorBy: ColorBy): void;
  toggleType(type: ObjectType): void;
  toggleRegime(regime: OrbitRegime): void;
  toggleConstellation(id: ConstellationId): void;
  /** Shows one constellation alone, or everything again if it already is alone. */
  soloConstellation(id: ConstellationId): void;
  /** Shows only objects launched in or before `year`; null removes the limit. */
  setLaunchedBy(year: number | null): void;
  /** Sets simulated seconds per real second; 0 pauses. */
  setRate(rate: number): void;
  /** Returns to the present, running in real time. */
  goLive(): void;
  /** Moves simulated time to `simMs`, keeping the rate. */
  jumpTo(simMs: number): void;
}

/** Stands in for the world before the catalog has loaded. */
const NO_SATELLITES: FilterSubjects = {
  satellites: [],
  orbits: [],
  launchYears: [],
  constellations: [],
};

function applyFilters(world: World | null, filters: Filters) {
  const subjects = world ?? NO_SATELLITES;
  const visible = visibilityMask(subjects, filters);
  return {
    filters,
    visible,
    visibleCount: countVisible(visible),
    counts: facetCounts(subjects, filters),
  };
}

export const useApp = create<AppState & AppActions>()((set, get) => {
  const changeFilters = (change: Partial<Filters>) => {
    const { world, filters } = get();
    set(applyFilters(world, { ...filters, ...change }));
  };

  return {
    phase: 'loading',
    error: null,
    world: null,
    clock: realTimeClock(wallNow()),
    selected: null,
    hovered: null,
    focusRequests: 0,
    riding: false,
    overlays: { orbit: true, groundTrack: true, coverage: true },
    observer: loadObserver(),
    pickingObserver: false,
    observerFocusRequests: 0,
    colorBy: 'type',
    ...applyFilters(null, SHOW_EVERYTHING),

    ready: (world) => set({ phase: 'ready', world, ...applyFilters(world, get().filters) }),
    fail: (message) => set({ phase: 'error', error: message }),

    select: (index) =>
      set(index === null ? { selected: null, riding: false } : { selected: index }),
    hover: (index) => {
      if (get().hovered !== index) set({ hovered: index });
    },
    focusSelected: () => set((state) => ({ focusRequests: state.focusRequests + 1 })),
    selectAndFocus: (index) =>
      set((state) => ({ selected: index, focusRequests: state.focusRequests + 1 })),
    setRiding: (riding) => {
      if (!riding || get().selected !== null) set({ riding });
    },
    toggleOverlay: (overlay) =>
      set(({ overlays }) => ({ overlays: { ...overlays, [overlay]: !overlays[overlay] } })),
    setObserver: (observer) => {
      saveObserver(observer);
      // Turn the globe to show the place, so the viewer sees they got it right.
      set((state) => ({
        observer,
        pickingObserver: false,
        observerFocusRequests: state.observerFocusRequests + (observer ? 1 : 0),
      }));
    },
    setPickingObserver: (pickingObserver) => set({ pickingObserver }),

    setColorBy: (colorBy) => {
      if (get().colorBy === colorBy) return;
      set({ colorBy });
      changeFilters({
        types: allEnabled(OBJECT_TYPES),
        constellations: allEnabled(CONSTELLATION_IDS),
      });
    },
    toggleType: (type) => {
      const { types } = get().filters;
      changeFilters({ types: { ...types, [type]: !types[type] } });
    },
    toggleRegime: (regime) => {
      const { regimes } = get().filters;
      changeFilters({ regimes: { ...regimes, [regime]: !regimes[regime] } });
    },
    toggleConstellation: (id) => {
      const { constellations } = get().filters;
      changeFilters({ constellations: { ...constellations, [id]: !constellations[id] } });
    },
    soloConstellation: (id) => {
      const { constellations } = get().filters;
      const alreadyAlone = soleEnabled(constellations) === id;
      const shown = (other: ConstellationId) => alreadyAlone || other === id;
      changeFilters({
        constellations: Object.fromEntries(
          CONSTELLATION_IDS.map((other) => [other, shown(other)]),
        ) as Record<ConstellationId, boolean>,
      });
    },
    setLaunchedBy: (year) => {
      if (get().filters.launchedBy !== year) changeFilters({ launchedBy: year });
    },

    setRate: (rate) => set((state) => ({ clock: withRate(state.clock, wallNow(), rate) })),
    goLive: () => set({ clock: realTimeClock(wallNow()) }),
    jumpTo: (simMs) => set((state) => ({ clock: withSimTime(state.clock, wallNow(), simMs) })),
  };
});

/**
 * The simulated instant right now. Read imperatively — from the render loop
 * and from polling hooks — because time changes every frame and must not
 * drive React renders.
 */
export function currentSimTime(): number {
  return simTimeAt(useApp.getState().clock, wallNow());
}
