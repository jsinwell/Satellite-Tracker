import { useEffect, useState } from 'react';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { PauseIcon, PlayIcon } from './icons';

/** How long the animation takes to run from the first launch to the present. */
const SWEEP_MS = 14_000;

/**
 * Limits the view to what had been launched by a given year, and can sweep
 * through the years to show orbit filling up. Only objects still in orbit are
 * in the catalog, so this is the history of what survives, not of everything
 * ever launched.
 */
export function LaunchSlider({ world }: { world: World }) {
  const [first, last] = world.launchYearRange;
  const launchedBy = useApp((state) => state.filters.launchedBy);
  const setLaunchedBy = useApp((state) => state.setLaunchedBy);
  const [playing, setPlaying] = useState(false);
  const year = launchedBy ?? last;

  // The last year means "no limit", so objects of unknown age come back too.
  const show = (value: number) => setLaunchedBy(value >= last ? null : value);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => {
        const current = useApp.getState().filters.launchedBy;
        if (current === null) {
          setPlaying(false);
        } else {
          setLaunchedBy(current + 1 >= last ? null : current + 1);
        }
      },
      SWEEP_MS / (last - first),
    );
    return () => clearInterval(timer);
  }, [playing, first, last, setLaunchedBy]);

  const togglePlaying = () => {
    if (!playing && launchedBy === null) setLaunchedBy(first);
    setPlaying(!playing);
  };

  return (
    <div className="px-2 pt-1 pb-1.5 text-xs">
      <div className="flex items-center justify-between text-chalk">
        <label htmlFor="launched-by">Launched by</label>
        <output htmlFor="launched-by" className="tabular-nums">
          {year}
        </output>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={togglePlaying}
          aria-label={playing ? 'Stop the launch timeline' : 'Play the launch timeline'}
          aria-pressed={playing}
          className="grid size-5 shrink-0 place-items-center rounded-sm text-chalk/80 hover:text-chalk"
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <input
          id="launched-by"
          type="range"
          min={first}
          max={last}
          step={1}
          value={year}
          onChange={(event) => {
            setPlaying(false);
            show(Number(event.target.value));
          }}
          title="Only objects still in orbit are shown"
          className="w-full accent-chalk"
        />
      </div>
    </div>
  );
}
