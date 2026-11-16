import { create } from 'zustand';
import { OBJECT_TYPES, type ObjectType } from '../core/catalog';
import { type Clock, realTimeClock, simTimeAt, wallNow, withRate } from '../core/clock';
import { CONSTELLATION_IDS, type ConstellationId, soleEnabled } from '../core/constellation';
import {
  allEnabled,
  countVisible,
  type Filters,
  SHOW_EVERYTHING,
  visibilityMask,
} from '../core/filter';
import type { OrbitRegime } from '../core/orbit';
import type { World } from './world';

/** What a satellite's color stands for. */
export type ColorBy = 'type' | 'constellation';

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

  colorBy: ColorBy;
  filters: Filters;
  /** One byte per satellite: 1 if it passes `filters`. Replaced, never mutated. */
  visible: Uint8Array;
  visibleCount: number;
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
}

function applyFilters(world: World | null, filters: Filters) {
  const visible = world ? visibilityMask(world, filters) : new Uint8Array(0);
  return { filters, visible, visibleCount: countVisible(visible) };
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
    colorBy: 'type',
    ...applyFilters(null, SHOW_EVERYTHING),

    ready: (world) => set({ phase: 'ready', world, ...applyFilters(world, get().filters) }),
    fail: (message) => set({ phase: 'error', error: message }),

    select: (index) => set({ selected: index }),
    hover: (index) => {
      if (get().hovered !== index) set({ hovered: index });
    },
    focusSelected: () => set((state) => ({ focusRequests: state.focusRequests + 1 })),
    selectAndFocus: (index) =>
      set((state) => ({ selected: index, focusRequests: state.focusRequests + 1 })),

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
