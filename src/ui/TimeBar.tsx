import { useCallback, useState } from 'react';
import { useApp } from '../app/store';
import { TIME_RATES, wallNow } from '../core/clock';
import { formatUtc } from './format';
import { useSimTime } from './hooks';
import { PauseIcon, PlayIcon } from './icons';
import { Panel } from './Panel';
import { TimePicker } from './TimePicker';

/** Simulated time within this of the wall clock, at 1×, counts as live. */
const LIVE_TOLERANCE_MS = 1500;

const buttonClass =
  'grid h-6 place-items-center rounded-full px-2.5 text-xs text-chalk/80 tabular-nums hover:bg-chalk/10 aria-pressed:bg-chalk/25 aria-pressed:font-medium aria-pressed:text-chalk';

/** The simulation clock: what instant is shown, and how fast it is moving. */
export function TimeBar() {
  const rate = useApp((state) => state.clock.rate);
  const setRate = useApp((state) => state.setRate);
  const goLive = useApp((state) => state.goLive);
  const simMs = useSimTime(100);
  const live = rate === 1 && Math.abs(simMs - wallNow()) < LIVE_TOLERANCE_MS;
  const paused = rate === 0;
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => setPicking(false), []);

  return (
    <div className="relative">
      {picking && <TimePicker onClose={closePicker} />}
      <Panel
        aria-label="Simulation time"
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-2"
      >
        {/* The time itself is the way to set it. */}
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          aria-haspopup="dialog"
          title="Go to a date and time"
          className="-mx-1.5 rounded-lg px-1.5 py-0.5 hover:bg-chalk/10 aria-expanded:bg-chalk/10"
        >
          <time className="text-sm font-medium text-chalk tabular-nums">
            {formatUtc(simMs)} UTC
          </time>
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setRate(paused ? 1 : 0)}
            aria-label={paused ? 'Resume' : 'Pause'}
            aria-pressed={paused}
            className={`${buttonClass} w-8`}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </button>
          {TIME_RATES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRate(option)}
              aria-label={`${option} times real speed`}
              aria-pressed={rate === option}
              className={buttonClass}
            >
              {option}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={goLive}
          disabled={live}
          title={live ? 'Showing the present, in real time' : 'Return to the present'}
          className="flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs text-graphite enabled:hover:bg-chalk/10 enabled:hover:text-chalk disabled:text-chalk"
        >
          {/* Filled while the clock is the real one, hollow while it is not. */}
          <span
            className={`size-1.5 rounded-full border ${live ? 'border-chalk bg-chalk' : 'border-graphite'}`}
          />
          {live ? 'Live' : 'Go live'}
        </button>
      </Panel>
    </div>
  );
}
