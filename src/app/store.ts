import { create } from 'zustand';
import type { ObjectType } from '../core/catalog';
import { type Clock, realTimeClock, simTimeAt, wallNow, withRate } from '../core/clock';
import { countVisible, type Filters, SHOW_EVERYTHING, visibilityMask } from '../core/filter';
import type { OrbitRegime } from '../core/orbit';
import type { World } from './world';

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
  toggleType(type: ObjectType): void;
  toggleRegime(regime: OrbitRegime): void;
  /** Sets simulated seconds per real second; 0 pauses. */
  setRate(rate: number): void;
  /** Returns to the present, running in real time. */
  goLive(): void;
}

function applyFilters(world: World | null, filters: Filters) {
  const visible = world
    ? visibilityMask(world.satellites, world.orbits, filters)
    : new Uint8Array(0);
  return { filters, visible, visibleCount: countVisible(visible) };
}

export const useApp = create<AppState & AppActions>()((set, get) => ({
  phase: 'loading',
  error: null,
  world: null,
  clock: realTimeClock(wallNow()),
  selected: null,
  hovered: null,
  focusRequests: 0,
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

  toggleType: (type) => {
    const { world, filters } = get();
    const types = { ...filters.types, [type]: !filters.types[type] };
    set(applyFilters(world, { ...filters, types }));
  },
  toggleRegime: (regime) => {
    const { world, filters } = get();
    const regimes = { ...filters.regimes, [regime]: !filters.regimes[regime] };
    set(applyFilters(world, { ...filters, regimes }));
  },

  setRate: (rate) => set((state) => ({ clock: withRate(state.clock, wallNow(), rate) })),
  goLive: () => set({ clock: realTimeClock(wallNow()) }),
}));

/**
 * The simulated instant right now. Read imperatively — from the render loop
 * and from polling hooks — because time changes every frame and must not
 * drive React renders.
 */
export function currentSimTime(): number {
  return simTimeAt(useApp.getState().clock, wallNow());
}
