import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from './app/store';
import { setLabelLayer } from './scene/labelLayer';
import { Scene } from './scene/Scene';
import { BodyPanel } from './ui/BodyPanel';
import { BootScreen } from './ui/BootScreen';
import { FilterPanel } from './ui/FilterPanel';
import { HoverLabel } from './ui/HoverLabel';
import { InfoPanel } from './ui/InfoPanel';
import { SearchBox } from './ui/SearchBox';
import { SkyPanel } from './ui/SkyPanel';
import { StatusLine } from './ui/StatusLine';
import { TimeBar } from './ui/TimeBar';

/**
 * Escape backs out one step: out of choosing a place on the globe, off a
 * ride, up from the ground, and last of all out of the selection. Not while
 * a text field wants the key.
 */
function useEscapeToDeselect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) return;
      const state = useApp.getState();
      if (state.pickingObserver) state.setPickingObserver(false);
      else if (state.riding) state.setRiding(false);
      else if (state.watching !== null) state.watch(null);
      else if (state.lookingUp) state.setLookingUp(false);
      else state.select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The space kept between two panels stacked in a column, px; Tailwind's `gap-3`. */
const PANEL_GAP = 12;

/**
 * Caps the height of `panel` to the room between its top and the top of
 * `below`, which shares its column further down, so that the two never
 * overlap however short the window. Measured, rather than set in CSS, because
 * the room depends on how tall `below` is at the moment. Where `below` is not
 * shown, the panel's own CSS cap applies.
 */
function useRoomAbove(
  panel: RefObject<HTMLElement | null>,
  below: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const top = panel.current;
    const bottom = below.current;
    if (!active || !top || !bottom) return;
    const refit = () => {
      if (bottom.getClientRects().length === 0) {
        top.style.maxHeight = '';
        return;
      }
      const room = bottom.getBoundingClientRect().top - top.getBoundingClientRect().top - PANEL_GAP;
      top.style.maxHeight = `${Math.max(0, room)}px`;
    };
    refit();
    // The filters change height when switching what color stands for.
    const observer = new ResizeObserver(refit);
    observer.observe(bottom);
    window.addEventListener('resize', refit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', refit);
      top.style.maxHeight = '';
    };
  }, [panel, below, active]);
}

/** A crescent and a star: the night sky. */
function SkyIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path
        d="M11.5 3.2a6.8 6.8 0 1 0 5.3 9.9 5.6 5.6 0 0 1-5.3-9.9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="m15 2.5.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" fill="currentColor" />
    </svg>
  );
}

/** A cloud. */
function CloudIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
      <path
        d="M6 15.5a3.5 3.5 0 0 1-.6-6.95 4.75 4.75 0 0 1 9.15 1.2A3 3 0 0 1 14 15.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const BOTTOM_ROW = [
  'absolute inset-x-3 bottom-3 grid items-end gap-x-3 gap-y-2',
  "grid-cols-[auto_1fr] [grid-template-areas:'filters_filters'_'toggle_status'_'time_time']",
  "sm:[grid-template-areas:'filters_status'_'time_time']",
  "lg:grid-cols-[1fr_auto_1fr] lg:[grid-template-areas:'filters_time_status']",
].join(' ');

export function App() {
  const phase = useApp((state) => state.phase);
  const world = useApp((state) => state.world);
  const selected = useApp((state) => state.selected);
  const watching = useApp((state) => state.watching);
  const haveClouds = useApp((state) => state.cloudsAtMs !== null);
  const showClouds = useApp((state) => state.showClouds);
  // Both only matter on narrow screens, where the filters are tucked behind a
  // button and the selected satellite shows a summary until asked for the rest.
  // Opening one closes the other: there is not room for both and the globe.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Closed at the start, even with a place remembered: it covers part of the
  // globe, and is one click away on the moon button.
  const [skyOpen, setSkyOpen] = useState(false);
  const skyRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  useRoomAbove(skyRef, filtersRef, skyOpen && phase === 'ready');
  // A new place replaces what the sky panel shows; start it from the top,
  // not wherever typing the coordinates left it scrolled.
  const observer = useApp((state) => state.observer);
  useEffect(() => {
    if (observer) skyRef.current?.scrollTo({ top: 0 });
  }, [observer]);
  useEscapeToDeselect();

  if (phase !== 'ready' || world === null) return <BootScreen />;

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-space font-sans text-slate-200">
      <div className="absolute inset-0">
        <Scene world={world} />
      </div>
      {/* Text the scene pins to places on the globe; under the HUD, over the canvas. */}
      <div
        ref={setLabelLayer}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      />

      {/*
        The HUD floats over the globe; only its panels take pointer input.
        The top and bottom rows are anchored separately, so a tall panel in
        one cannot push the other off the screen.
      */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-3 top-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex w-full flex-col gap-3 sm:w-80">
            <h1 className="sr-only">Satellite Tracker</h1>
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <SearchBox world={world} />
              </div>
              <button
                type="button"
                onClick={() => {
                  // On a phone the open filters hide the sky; then this shows it.
                  if (filtersOpen) setSkyOpen(true);
                  else setSkyOpen((open) => !open);
                  setFiltersOpen(false);
                }}
                aria-expanded={skyOpen}
                aria-controls="your-sky"
                aria-label="Your sky"
                title="What's over you"
                className="pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/75 px-3 text-xs text-slate-200 shadow-xl shadow-black/40 backdrop-blur-md hover:text-white aria-expanded:border-accent/60 aria-expanded:text-accent"
              >
                <SkyIcon />
              </button>
              {haveClouds && (
                <button
                  type="button"
                  onClick={() => useApp.getState().setShowClouds(!showClouds)}
                  aria-pressed={showClouds}
                  aria-label="Clouds"
                  // Says whose data it is, as its license asks.
                  title={`${showClouds ? 'Hide' : 'Show'} the clouds (contains modified EUMETSAT data)`}
                  className="pointer-events-auto flex shrink-0 items-center rounded-xl border border-white/10 bg-slate-950/75 px-3 text-xs text-slate-400 shadow-xl shadow-black/40 backdrop-blur-md hover:text-white aria-pressed:text-slate-100"
                >
                  <CloudIcon />
                </button>
              )}
            </div>
            {skyOpen && (
              // On a phone the selected satellite takes this spot, and the
              // filters need the room it would cover; the sky comes back when
              // they are closed. Wider, it shares the left column with the
              // filters, and is fitted to the room above them.
              <div
                id="your-sky"
                ref={skyRef}
                className={`thin-scrollbar pointer-events-auto max-h-[40dvh] overflow-y-auto rounded-xl sm:block sm:max-h-[calc(50dvh-4.5rem)] lg:max-h-[calc(50dvh-3rem)] ${
                  selected === null && !filtersOpen ? '' : 'hidden'
                }`}
              >
                <SkyPanel world={world} onClose={() => setSkyOpen(false)} />
              </div>
            )}
          </div>
          {watching !== null && observer && (
            <div className="pointer-events-auto w-full sm:w-72">
              <BodyPanel body={watching} observer={observer} />
            </div>
          )}
          {selected !== null && (
            // Capped and scrollable, so it can never run under the bottom row.
            <div className="thin-scrollbar pointer-events-auto max-h-[48dvh] w-full overflow-y-auto rounded-xl sm:max-h-[calc(100dvh-7.5rem)] sm:w-72">
              <InfoPanel
                key={selected}
                world={world}
                index={selected}
                expanded={detailsOpen}
                onToggleExpanded={() => {
                  setDetailsOpen((open) => !open);
                  setFiltersOpen(false);
                }}
              />
            </div>
          )}
        </div>

        {/*
          Placed by named grid areas that change at fixed breakpoints, so the
          layout depends on the width of the screen and not on whether the
          panels happen to fit side by side.
            phone:   filters (when open) / [Filters] status / time, full width
            tablet:  filters, status / time, centered
            desktop: filters, time, status in one row
        */}
        <div className={BOTTOM_ROW}>
          <div
            id="filters"
            ref={filtersRef}
            className={`[grid-area:filters] sm:block ${filtersOpen ? '' : 'hidden'}`}
          >
            <FilterPanel world={world} sharingColumn={skyOpen} />
          </div>
          <button
            type="button"
            onClick={() => {
              setFiltersOpen((open) => !open);
              setDetailsOpen(false);
            }}
            aria-expanded={filtersOpen}
            aria-controls="filters"
            className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-200 shadow-xl shadow-black/40 backdrop-blur-md [grid-area:toggle] aria-expanded:border-accent/60 sm:hidden"
          >
            Filters
          </button>
          <div className="[grid-area:time] sm:justify-self-center">
            <TimeBar />
          </div>
          <div className="justify-self-end [grid-area:status]">
            <StatusLine world={world} />
          </div>
        </div>
      </div>

      <HoverLabel world={world} />
    </main>
  );
}
