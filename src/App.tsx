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

/** Escape clears the selection, unless a text field wants the key. */
function useEscapeToDeselect() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
        useApp.getState().select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

export function App() {
  const phase = useApp((state) => state.phase);
  const world = useApp((state) => state.world);
  const selected = useApp((state) => state.selected);
  // Only matters on narrow screens, where the filters are tucked behind a button.
  const [filtersOpen, setFiltersOpen] = useState(false);
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
            // Capped and scrollable, so on a phone it cannot cover the whole globe.
            <div className="pointer-events-auto max-h-[42dvh] w-full overflow-y-auto rounded-xl sm:max-h-[calc(100dvh-7.5rem)] sm:w-72">
              <InfoPanel key={selected} world={world} index={selected} />
            </div>
          )}
        </div>

        {/*
          Wide screens: filters, time and status side by side along the bottom.
          Narrow screens: the filters open from a button, the status sits beside
          that button, and the time controls take the full width underneath.
        */}
        <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div id="filters" className={`w-full sm:block sm:w-auto ${filtersOpen ? '' : 'hidden'}`}>
            <FilterPanel world={world} />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="filters"
            className="pointer-events-auto rounded-xl border border-white/10 bg-slate-950/75 px-3 py-2 text-xs text-slate-200 shadow-xl shadow-black/40 backdrop-blur-md aria-expanded:border-accent/60 sm:hidden"
          >
            Filters
          </button>
          <div className="order-last w-full sm:order-none sm:w-auto">
            <TimeBar />
          </div>
          <StatusLine world={world} />
        </div>
      </div>

      <HoverLabel world={world} />
    </main>
  );
}
