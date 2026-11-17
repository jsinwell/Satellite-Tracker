import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { currentSimTime, useApp } from '../app/store';
import { wallNow } from '../core/clock';
import { fromUtcInput, SETTABLE_RANGE_MS, toUtcInput } from './format';
import { Panel } from './Panel';

/**
 * Further than this from the present, satellite positions are predictions
 * from orbital elements measured now, and drift further from where the
 * satellites will really be the longer the reach. The Sun, Moon and planets
 * are good for any date.
 */
const RELIABLE_MS = 7 * 86_400_000;

/**
 * Sets the simulated date and time, in UTC like the time bar. Opens on the
 * instant showing, and keeps the clock's rate when it jumps.
 */
export function TimePicker({ onClose }: { onClose(): void }) {
  const [value, setValue] = useState(() => toUtcInput(currentSimTime()));
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const panel = useRef<HTMLFormElement>(null);
  const chosen = fromUtcInput(value);
  const farFromNow = chosen !== null && Math.abs(chosen - wallNow()) > RELIABLE_MS;

  // Clicking anywhere else puts it away, as a menu would.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen === null) {
      setInvalid(true);
      return;
    }
    useApp.getState().jumpTo(chosen);
    onClose();
  };

  return (
    <form
      ref={panel}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute bottom-full left-1/2 mb-2 w-72 max-w-[calc(100vw-1.5rem)] -translate-x-1/2"
    >
      <Panel aria-label="Go to a date and time" className="space-y-2 p-3 text-xs">
        <label htmlFor={inputId} className="block text-slate-300">
          Go to a date and time (UTC)
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="datetime-local"
            step={1}
            min={toUtcInput(SETTABLE_RANGE_MS.first)}
            max={toUtcInput(SETTABLE_RANGE_MS.last)}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            // biome-ignore lint/a11y/noAutofocus: the picker is opened to type in it
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900/80 px-2 py-1.5 font-mono text-xs text-slate-100 [color-scheme:dark] outline-none focus:border-accent/60 aria-invalid:border-amber-300/60"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent/15 px-3 py-1.5 font-medium text-accent hover:bg-accent/25"
          >
            Go
          </button>
        </div>
        {invalid && (
          <p role="alert" className="text-amber-300/90">
            Pick a date between 1957 and 2100.
          </p>
        )}
        {farFromNow && !invalid && (
          <p className="text-slate-400">
            The Sun, Moon and planets are right for any date. Satellites this far from today are
            only a guess: their orbits are known as they are now.
          </p>
        )}
      </Panel>
    </form>
  );
}
