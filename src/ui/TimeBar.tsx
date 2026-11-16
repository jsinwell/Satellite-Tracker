import { useApp } from '../app/store';
import { TIME_RATES, wallNow } from '../core/clock';
import { formatUtc } from './format';
import { useSimTime } from './hooks';
import { Panel } from './Panel';

/** Simulated time within this of the wall clock, at 1×, counts as live. */
const LIVE_TOLERANCE_MS = 1500;

const buttonClass =
  'rounded-md px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/10 aria-pressed:bg-accent/20 aria-pressed:text-accent';

/** The simulation clock: what instant is shown, and how fast it is moving. */
export function TimeBar() {
  const rate = useApp((state) => state.clock.rate);
  const setRate = useApp((state) => state.setRate);
  const goLive = useApp((state) => state.goLive);
  const simMs = useSimTime(100);
  const live = rate === 1 && Math.abs(simMs - wallNow()) < LIVE_TOLERANCE_MS;
  const paused = rate === 0;

  return (
    <Panel
      aria-label="Simulation time"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-2"
    >
      <time className="font-mono text-sm text-slate-100 tabular-nums">{formatUtc(simMs)} UTC</time>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setRate(paused ? 1 : 0)}
          aria-label={paused ? 'Resume' : 'Pause'}
          aria-pressed={paused}
          className={`${buttonClass} w-8`}
        >
          {paused ? '▶' : '❚❚'}
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
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold tracking-wider text-slate-400 enabled:hover:bg-white/10 disabled:text-emerald-300"
      >
        <span className={`size-1.5 rounded-full ${live ? 'bg-emerald-400' : 'bg-slate-600'}`} />
        {live ? 'LIVE' : 'GO LIVE'}
      </button>
    </Panel>
  );
}
