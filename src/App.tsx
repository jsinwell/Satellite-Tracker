import { useEffect } from 'react';
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
  useEscapeToDeselect();

  if (phase !== 'ready' || world === null) return <BootScreen />;

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-space font-sans text-slate-200">
      <div className="absolute inset-0">
        <Scene world={world} />
      </div>

      {/* The HUD floats over the globe; only its panels take pointer input. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col gap-3 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="w-full sm:w-80">
            <h1 className="sr-only">Satellite Tracker</h1>
            <SearchBox world={world} />
          </div>
          {selected !== null && (
            <div className="w-full sm:w-72">
              <InfoPanel key={selected} world={world} index={selected} />
            </div>
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
          <div className="hidden sm:block">
            <FilterPanel world={world} />
          </div>
          <TimeBar />
          <StatusLine world={world} />
        </div>
      </div>

      <HoverLabel world={world} />
    </main>
  );
}
