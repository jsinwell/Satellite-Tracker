import { useEffect, useState } from 'react';
import { useApp } from './app/store';
import { Scene } from './scene/Scene';
import { BootScreen } from './ui/BootScreen';
import { FilterPanel } from './ui/FilterPanel';
import { HoverLabel } from './ui/HoverLabel';
import { InfoPanel } from './ui/InfoPanel';
import { SearchBox } from './ui/SearchBox';
import { StatusLine } from './ui/StatusLine';
import { TimeBar } from './ui/TimeBar';

/**
 * Escape backs out one step: off the ride if the camera is on one, otherwise
 * out of the selection. Not while a text field wants the key.
 */
function useEscapeToDeselect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target instanceof HTMLInputElement) return;
      const { riding, setRiding, select } = useApp.getState();
      if (riding) setRiding(false);
      else select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
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
  // Both only matter on narrow screens, where the filters are tucked behind a
  // button and the selected satellite shows a summary until asked for the rest.
  // Opening one closes the other: there is not room for both and the globe.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEscapeToDeselect();

  if (phase !== 'ready' || world === null) return <BootScreen />;

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-space font-sans text-slate-200">
      <div className="absolute inset-0">
        <Scene world={world} />
      </div>

      {/*
        The HUD floats over the globe; only its panels take pointer input.
        The top and bottom rows are anchored separately, so a tall panel in
        one cannot push the other off the screen.
      */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-3 top-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="w-full sm:w-80">
            <h1 className="sr-only">Satellite Tracker</h1>
            <SearchBox world={world} />
          </div>
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
            className={`[grid-area:filters] sm:block ${filtersOpen ? '' : 'hidden'}`}
          >
            <FilterPanel world={world} />
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
