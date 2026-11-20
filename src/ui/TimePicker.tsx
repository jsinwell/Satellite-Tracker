import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { currentSimTime, useApp } from '../app/store';
import { wallNow } from '../core/clock';
import type { Observer } from '../core/observer';
import {
  clampSettable,
  MONTH_NAMES,
  type Month,
  monthOf,
  monthSettable,
  monthWeeks,
  moveByKey,
  onDay,
  PART_COUNT,
  shiftMonth,
  startOfDay,
  type TimePart,
  timePart,
  WEEKDAY_NAMES,
  withTimePart,
} from './calendar';
import { fromUtcField, SETTABLE_RANGE_MS, toUtcField } from './format';
import { useSimTime, useWideScreen } from './hooks';
import { ChevronIcon } from './icons';
import { NightStrip } from './NightStrip';
import { Panel } from './Panel';

/**
 * Further than this from the present, satellite positions are predictions
 * from orbital elements measured now, and drift further from where the
 * satellites will really be the longer the reach. The Sun, Moon and planets
 * are good for any date.
 */
const RELIABLE_MS = 7 * 86_400_000;

const FIRST_YEAR = new Date(SETTABLE_RANGE_MS.first).getUTCFullYear();
const LAST_YEAR = new Date(SETTABLE_RANGE_MS.last).getUTCFullYear();

/**
 * With a keyboard to hand, the picker opens ready to be typed in. On a touch
 * screen that would bring the keyboard up over the calendar, which is the
 * easier way there.
 */
const TYPES_FIRST =
  typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches;

const dayLabel = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const stepClass =
  'grid size-7 place-items-center rounded-full text-chalk/80 enabled:hover:bg-chalk/10 disabled:text-graphite/30';

/** A box to type a figure in: the date, the year, a part of the time. */
const FIELD =
  'rounded-lg border border-chalk/15 bg-space/40 text-chalk tabular-nums outline-none placeholder:text-graphite/60 focus:border-chalk/50';

/**
 * Sets the simulated date and time, in UTC like the time bar: by typing it,
 * or from a calendar and a clock. Opens on the instant showing, and keeps the
 * clock's rate when it jumps.
 */
export function TimePicker({ onClose }: { onClose(): void }) {
  // What would be gone to: always an instant that can be.
  const [instant, setInstant] = useState(() =>
    clampSettable(Math.floor(currentSimTime() / 1000) * 1000),
  );
  // What is typed, which while it is being typed may not be one.
  const [text, setText] = useState(() => toUtcField(instant));
  const [refused, setRefused] = useState(false);
  // The calendar's page, which can be turned without choosing anything.
  const [page, setPage] = useState(() => monthOf(instant));
  const [choosingMonth, setChoosingMonth] = useState(false);
  const fieldId = useId();
  // Where the time bar has no room for tonight's strip, it is here: this is
  // where the time is set.
  const observer = useApp((state) => state.observer);
  const stripHere = !useWideScreen();
  const panel = useRef<HTMLFormElement>(null);
  const typed = fromUtcField(text);
  const farFromNow = typed !== null && Math.abs(typed - wallNow()) > RELIABLE_MS;

  // Clicking anywhere else puts it away, as a menu would.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  /** Takes an instant from the calendar or the clock, and shows it everywhere. */
  const choose = (timeMs: number) => {
    const chosen = clampSettable(timeMs);
    setInstant(chosen);
    setText(toUtcField(chosen));
    setPage(monthOf(chosen));
    setRefused(false);
  };

  const type = (value: string) => {
    setText(value);
    setRefused(false);
    const timeMs = fromUtcField(value);
    if (timeMs === null) return;
    setInstant(timeMs);
    setPage(monthOf(timeMs));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed === null) {
      setRefused(true);
      return;
    }
    useApp.getState().jumpTo(typed);
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
      className="absolute bottom-full left-1/2 mb-2 w-[19rem] max-w-[calc(100vw-1.5rem)] -translate-x-1/2"
    >
      <Panel
        aria-label="Go to a date and time"
        // Room is left under it for the time bar, which is taller on a wide screen: see `NightStrip`.
        className="thin-scrollbar max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto p-3 text-xs lg:max-h-[calc(100dvh-8rem)]"
      >
        {stripHere && observer && (
          <div>
            <p className="mb-1.5 text-chalk/80">Tonight</p>
            <Tonight observer={observer} onGoTo={choose} />
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor={fieldId} className="block text-chalk/80">
            Go to a date and time (UTC)
          </label>
          <div className="flex gap-2">
            <input
              id={fieldId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder="2027-08-02 10:07:00"
              value={text}
              onChange={(event) => type(event.target.value)}
              aria-invalid={refused}
              // biome-ignore lint/a11y/noAutofocus: the picker is opened to type in it
              autoFocus={TYPES_FIRST}
              className={`min-w-0 flex-1 px-2 py-1.5 text-xs aria-invalid:border-caution ${FIELD}`}
            />
            <button
              type="submit"
              className="rounded-lg bg-chalk px-3.5 py-1.5 font-semibold text-night hover:bg-chalk/85"
            >
              Go
            </button>
          </div>
          {refused && (
            <p role="alert" className="text-caution">
              Type a date as year-month-day, from {FIRST_YEAR} to {LAST_YEAR}, then a time if you
              like: 2027-08-02 10:07
            </p>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setPage(shiftMonth(page, choosingMonth ? -12 : -1))}
              disabled={
                choosingMonth ? page.year <= FIRST_YEAR : !monthSettable(shiftMonth(page, -1))
              }
              aria-label={choosingMonth ? 'Previous year' : 'Previous month'}
              className={stepClass}
            >
              <ChevronIcon pointing="left" />
            </button>
            <button
              type="button"
              onClick={() => setChoosingMonth((open) => !open)}
              aria-expanded={choosingMonth}
              title={choosingMonth ? 'Back to the days' : 'Choose a month and year'}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-chalk hover:bg-chalk/10 aria-expanded:bg-chalk/10"
            >
              {choosingMonth ? page.year : `${MONTH_NAMES[page.month]} ${page.year}`}
              <span className="text-graphite">
                <ChevronIcon pointing={choosingMonth ? 'up' : 'down'} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPage(shiftMonth(page, choosingMonth ? 12 : 1))}
              disabled={
                choosingMonth ? page.year >= LAST_YEAR : !monthSettable(shiftMonth(page, 1))
              }
              aria-label={choosingMonth ? 'Next year' : 'Next month'}
              className={stepClass}
            >
              <ChevronIcon pointing="right" />
            </button>
          </div>

          {choosingMonth ? (
            <MonthGrid
              page={page}
              chosen={monthOf(instant)}
              onYear={(year) => setPage({ year, month: page.month })}
              onChoose={(month) => {
                setPage(month);
                setChoosingMonth(false);
              }}
            />
          ) : (
            <DayGrid page={page} instant={instant} onChoose={choose} />
          )}
        </div>

        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend will not sit in a row */}
        <div role="group" aria-label="Time" className="flex items-center gap-1.5">
          <span className="mr-1.5 text-graphite">Time</span>
          <TimeField label="Hours" part="hours" instant={instant} onChoose={choose} />
          <span className="text-graphite">:</span>
          <TimeField label="Minutes" part="minutes" instant={instant} onChoose={choose} />
          <span className="text-graphite">:</span>
          <TimeField label="Seconds" part="seconds" instant={instant} onChoose={choose} />
          <span className="ml-1 text-graphite">UTC</span>
          <button
            type="button"
            onClick={() => choose(Math.floor(wallNow() / 1000) * 1000)}
            className="ml-auto rounded-full bg-chalk/10 px-2.5 py-1 text-chalk hover:bg-chalk/20"
          >
            Now
          </button>
        </div>

        {farFromNow && !refused && (
          <p className="text-graphite">
            The Sun, Moon and planets are right for any date. Satellites this far from today are
            only a guess: their orbits are known as they are now.
          </p>
        )}
      </Panel>
    </form>
  );
}

/** Tonight's strip, keeping its own time, so that the picker is not redrawn as the clock runs. */
function Tonight({ observer, onGoTo }: { observer: Observer; onGoTo(timeMs: number): void }) {
  const simMs = useSimTime(200);
  return <NightStrip observer={observer} simMs={simMs} hoursApart={6} onGoTo={onGoTo} />;
}

/**
 * A month's days. One of them takes the keyboard: the chosen day if it is on
 * the page, or else the first. From there the keys choose another: see
 * `moveByKey`.
 */
function DayGrid({
  page,
  instant,
  onChoose,
}: {
  page: Month;
  instant: number;
  onChoose(timeMs: number): void;
}) {
  const grid = useRef<HTMLTableElement>(null);
  // Set when the keyboard moves the choice, so that it can be followed.
  const follow = useRef(false);
  const weeks = monthWeeks(page);
  const chosenDay = startOfDay(instant);
  const today = startOfDay(wallNow());
  const onPage = weeks.flat().some((day) => day.inMonth && day.startMs === chosenDay);
  const tabStop = onPage ? chosenDay : Date.UTC(page.year, page.month, 1);

  useLayoutEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
  });

  const onKeyDown = (event: KeyboardEvent) => {
    // From the day the keyboard is on, which is not the chosen one if the
    // page has been turned away from it.
    const held = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
    if (held === undefined) return;
    const to = moveByKey(onDay(instant, Number(held)), event.key, event.shiftKey);
    if (to === null) return;
    event.preventDefault();
    // The arrow keys also steer the camera, when nothing else wants them.
    event.stopPropagation();
    follow.current = true;
    onChoose(to);
  };

  return (
    <table
      ref={grid}
      aria-label={`${MONTH_NAMES[page.month]} ${page.year}`}
      onKeyDown={onKeyDown}
      className="w-full table-fixed border-separate border-spacing-px"
    >
      <thead>
        <tr>
          {WEEKDAY_NAMES.map((name) => (
            <th
              key={name}
              scope="col"
              abbr={name}
              className="py-1 text-center text-2xs font-normal text-graphite"
            >
              {name.slice(0, 2)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].startMs}>
            {week.map((day) => (
              <td key={day.startMs} className="p-0">
                <button
                  type="button"
                  disabled={!day.settable}
                  data-day={day.startMs}
                  tabIndex={day.startMs === tabStop ? 0 : -1}
                  onClick={() => onChoose(onDay(instant, day.startMs))}
                  aria-label={dayLabel.format(day.startMs)}
                  aria-pressed={day.startMs === chosenDay}
                  aria-current={day.startMs === today ? 'date' : undefined}
                  className={`mx-auto grid size-8 place-items-center rounded-full tabular-nums enabled:hover:bg-chalk/10 disabled:text-graphite/30 aria-pressed:bg-chalk aria-pressed:font-semibold aria-pressed:text-night aria-pressed:hover:bg-chalk aria-[current=date]:ring-1 aria-[current=date]:ring-chalk/40 ${
                    day.inMonth ? 'text-chalk' : 'text-graphite/60'
                  }`}
                >
                  {day.day}
                </button>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The months of a year, and the year itself to type, for going a long way at once. */
function MonthGrid({
  page,
  chosen,
  onYear,
  onChoose,
}: {
  page: Month;
  chosen: Month;
  onYear(year: number): void;
  onChoose(month: Month): void;
}) {
  // What is typed for the year, while it is not yet one that can be gone to.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-center gap-2 text-graphite">
        Year
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={draft ?? String(page.year)}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, '');
            const year = Number(value);
            if (value.length === 4 && year >= FIRST_YEAR && year <= LAST_YEAR) {
              setDraft(null);
              onYear(year);
            } else {
              setDraft(value);
            }
          }}
          onBlur={() => setDraft(null)}
          className={`w-16 px-2 py-1 text-center ${FIELD}`}
        />
        <span className="text-graphite/60">
          {FIRST_YEAR}–{LAST_YEAR}
        </span>
      </label>
      <div className="grid grid-cols-3 gap-1">
        {MONTH_NAMES.map((name, month) => {
          const isChosen = chosen.year === page.year && chosen.month === month;
          return (
            <button
              key={name}
              type="button"
              disabled={!monthSettable({ year: page.year, month })}
              onClick={() => onChoose({ year: page.year, month })}
              aria-pressed={isChosen}
              className="h-9 rounded-lg text-chalk enabled:hover:bg-chalk/10 disabled:text-graphite/30 aria-pressed:bg-chalk/25 aria-pressed:font-medium"
            >
              {name.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One part of the time of day: two digits to type over, or to step with the
 * arrow keys, going round from the last value to the first.
 */
function TimeField({
  label,
  part,
  instant,
  onChoose,
}: {
  label: string;
  part: TimePart;
  instant: number;
  onChoose(timeMs: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const value = timePart(instant, part);
  const count = PART_COUNT[part];

  return (
    <input
      type="text"
      inputMode="numeric"
      role="spinbutton"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      maxLength={2}
      value={draft ?? String(value).padStart(2, '0')}
      onFocus={(event) => event.target.select()}
      onChange={(event) => {
        const typed = event.target.value.replace(/\D/g, '');
        setDraft(typed);
        if (typed !== '' && Number(typed) < count)
          onChoose(withTimePart(instant, part, Number(typed)));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        setDraft(null);
        onChoose(withTimePart(instant, part, (value + step + count) % count));
      }}
      className={`w-9 py-1 text-center ${FIELD}`}
    />
  );
}
