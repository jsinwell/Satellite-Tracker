import { useCallback, useState } from 'react';
import { useApp } from '../app/store';
import { TIME_RATES, wallNow } from '../core/clock';
import { formatUtc, formatUtcBrief } from './format';
import { usePhoneScreen, useSimTime, useWideScreen } from './hooks';
import { PauseIcon, PlayIcon } from './icons';
import { NightStrip } from './NightStrip';
import { Panel } from './Panel';
import { TimePicker } from './TimePicker';

/** Simulated time within this of the wall clock, at 1×, counts as live. */
const LIVE_TOLERANCE_MS = 1500;

const buttonClass =
  'grid h-6 place-items-center rounded-full px-2.5 text-xs text-chalk/80 tabular-nums hover:bg-chalk/10 aria-pressed:bg-chalk/25 aria-pressed:font-medium aria-pressed:text-chalk';

/**
 * The simulation clock: what instant is shown, and how fast it is moving. On
 * a phone it is one row: the speeds share one button, which steps through
 * them, and tonight's strip is in the date picker.
 */
export function TimeBar() {
  const rate = useApp((state) => state.clock.rate);
  const setRate = useApp((state) => state.setRate);
  const goLive = useApp((state) => state.goLive);
  const observer = useApp((state) => state.observer);
  const wide = useWideScreen();
  const phone = usePhoneScreen();
  const simMs = useSimTime(100);
  const live = rate === 1 && Math.abs(simMs - wallNow()) < LIVE_TOLERANCE_MS;
  const paused = rate === 0;
  const [picking, setPicking] = useState(false);
  const closePicker = useCallback(() => setPicking(false), []);
  // Paused, the one button still names a speed: the one it would start again at.
  const speed = TIME_RATES.find((option) => option === rate) ?? TIME_RATES[0];
  const nextSpeed = TIME_RATES[(TIME_RATES.indexOf(speed) + 1) % TIME_RATES.length];

  return (
    <div className="relative">
      {picking && <TimePicker onClose={closePicker} />}
      <Panel
        aria-label="Simulation time"
        className={
          phone
            ? 'flex items-center gap-1 py-1.5 pr-1.5 pl-3'
            : 'flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-3 py-2'
        }
      >
        {/*
          Tonight, once there is a place for it to be the night of. Only on a
          wide screen, where the time bar sits beside the filters: narrower,
          it is stacked under them, and growing would push them up into the
          panels above. There it is in the date picker.
        */}
        {observer && wide && <NightStrip observer={observer} simMs={simMs} />}

        {/* The time itself is the way to set it. */}
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          aria-expanded={picking}
          aria-haspopup="dialog"
          title="Go to a date and time"
          className={`-mx-1.5 rounded-lg px-1.5 py-0.5 hover:bg-chalk/10 aria-expanded:bg-chalk/10 ${
            phone ? 'mr-auto min-w-0 truncate' : ''
          }`}
        >
          <time className="text-sm font-medium text-chalk tabular-nums">
            {phone ? formatUtcBrief(simMs) : formatUtc(simMs)} UTC
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
          {phone ? (
            <button
              type="button"
              onClick={() => setRate(nextSpeed)}
              aria-label={`Speed: ${speed} times real speed. Change to ${nextSpeed} times.`}
              className={`${buttonClass} min-w-12 bg-chalk/10 font-medium text-chalk`}
            >
              {speed}×
            </button>
          ) : (
            TIME_RATES.map((option) => (
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
            ))
          )}
        </div>

        <button
          type="button"
          onClick={goLive}
          disabled={live}
          title={live ? 'Showing the present, in real time' : 'Return to the present'}
          className="flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs text-graphite enabled:hover:bg-chalk/10 enabled:hover:text-chalk disabled:text-chalk"
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
