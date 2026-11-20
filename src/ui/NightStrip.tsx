import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { currentSimTime, useApp } from '../app/store';
import { MS_PER_DAY } from '../core/constants';
import { daylight, type Night, nightOf, nightStart } from '../core/night';
import { type Observer, type Pass, predictPasses, skyState } from '../core/observer';
import { clampSettable } from './calendar';
import { formatLocalClock, formatLocalTime } from './format';

/** How far an arrow key moves the time, and Page Up and Page Down. */
const STEP_MS = 10 * 60_000;
const BIG_STEP_MS = 60 * 60_000;
/** Passes of the selected satellite marked on it, at most: a low one makes a dozen a night. */
const MOST_PASSES = 16;
/** A pass shorter than this is a mark too narrow to show which part of it can be seen. */
const SHORT_PASS_MS = 20 * 60_000;
/** A pass is a few pixels wide: this near it still counts as pointing at it. */
const PASS_SLACK_MS = 6 * 60_000;
/** How much of the band's white shows in full night and in full day. */
const SHADE = { night: 0.1, day: 0.6 };
/** Hours are named this far apart, and not so near an end that the name would be cut off. */
const HOURS_APART = 3;
const EDGE_SHARE = 0.04;

const hourFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric' });

/** The band's shading, light where the sky is light, as a CSS gradient. */
function shadingOf(night: Night): string {
  const last = night.sunElevations.length - 1;
  const stops = Array.from(night.sunElevations, (elevation, i) => {
    const shown = SHADE.night + (SHADE.day - SHADE.night) * daylight(elevation);
    return `color-mix(in srgb, var(--color-chalk) ${(shown * 100).toFixed(1)}%, transparent) ${((i / last) * 100).toFixed(2)}%`;
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** The whole hours to name along it, by the viewer's clock. */
function hoursOf(night: Night): { atMs: number; label: string }[] {
  const hours = [];
  const hour = new Date(night.startMs);
  hour.setMinutes(0, 0, 0);
  for (hour.setHours(hour.getHours() + 1); hour.getTime() < night.endMs; ) {
    const share = (hour.getTime() - night.startMs) / MS_PER_DAY;
    if (hour.getHours() % HOURS_APART === 0 && share > EDGE_SHARE && share < 1 - EDGE_SHARE) {
      hours.push({ atMs: hour.getTime(), label: hourFormat.format(hour) });
    }
    hour.setHours(hour.getHours() + 1);
  }
  return hours;
}

const SKY_WORDS = { day: 'Daylight', twilight: 'Twilight', dark: 'Dark sky' } as const;

/**
 * Tonight, end to end: the 24 hours from noon to noon where the viewer is,
 * shaded by how light the sky is, with the stretches worth going outside for
 * marked on it and the selected satellite's passes above it. The line across
 * it is now. Dragging along it, or clicking, goes to that time.
 *
 * It answers what the sky by itself cannot: at midday or at midnight no
 * satellite can be seen, and this shows how far off the next good hour is,
 * and takes you there.
 */
export function NightStrip({ observer, simMs }: { observer: Observer; simMs: number }) {
  const world = useApp((state) => state.world);
  const selected = useApp((state) => state.selected);
  // While it is being dragged it stays the night it was: at speed, time can
  // run past noon under a pointer held still at the end, and the same spot
  // would then mean a day later.
  const [held, setHeld] = useState<number | null>(null);
  const startMs = held ?? nightStart(observer.longitude, simMs);
  const night = useMemo(() => nightOf(observer, startMs), [observer, startMs]);
  const shading = useMemo(() => shadingOf(night), [night]);
  const hours = useMemo(() => hoursOf(night), [night]);
  const satellite = world !== null && selected !== null ? world.satellites[selected] : null;
  const passes = useMemo((): Pass[] => {
    if (!satellite) return [];
    const prediction = predictPasses(satellite, observer, night.startMs, night.endMs, MOST_PASSES);
    // One that never sets has no passes to mark.
    return prediction?.kind === 'passes' ? prediction.passes : [];
  }, [satellite, observer, night]);

  /** Where the pointer is on it, as a time; null when it is somewhere else. */
  const [pointerMs, setPointerMs] = useState<number | null>(null);
  const track = useRef<HTMLDivElement>(null);
  // Going to a time re-places every satellite, so a drag asks for it once a frame at most.
  const wanted = useRef<number | null>(null);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const goTo = (timeMs: number) => {
    wanted.current = clampSettable(timeMs);
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (wanted.current !== null) useApp.getState().jumpTo(wanted.current);
    });
  };

  /** How far along it a time is: 0 at the start, 1 at the end. */
  const share = (timeMs: number) => Math.min(1, Math.max(0, (timeMs - night.startMs) / MS_PER_DAY));
  const percent = (timeMs: number) => `${(share(timeMs) * 100).toFixed(3)}%`;

  const timeAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return simMs;
    const along = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    // Short of the end, which is the start of the next night.
    return Math.min(night.endMs - 1000, night.startMs + along * MS_PER_DAY);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(night.startMs);
    const timeMs = timeAt(event.clientX);
    setPointerMs(timeMs);
    goTo(timeMs);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const timeMs = timeAt(event.clientX);
    setPointerMs(timeMs);
    if (held !== null) goTo(timeMs);
  };
  const letGo = () => setHeld(null);

  const onKeyDown = (event: KeyboardEvent) => {
    const now = currentSimTime();
    const to = {
      ArrowRight: now + STEP_MS,
      ArrowUp: now + STEP_MS,
      ArrowLeft: now - STEP_MS,
      ArrowDown: now - STEP_MS,
      PageUp: now + BIG_STEP_MS,
      PageDown: now - BIG_STEP_MS,
      Home: night.startMs,
      End: night.endMs - 1000,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    // The arrow keys also steer the camera, when nothing else wants them.
    event.stopPropagation();
    goTo(to);
  };

  /** What is going on at a time, in a word or two: the pass, the good stretch, or the sky. */
  const happening = (timeMs: number): { words: string; seen: boolean } => {
    const pass = passes.find(
      (each) => timeMs >= each.riseMs - PASS_SLACK_MS && timeMs <= each.setMs + PASS_SLACK_MS,
    );
    if (pass && satellite) {
      return {
        words: `${satellite.name} passes${pass.seeable ? ', visible' : ''}`,
        seen: pass.seeable !== null,
      };
    }
    if (night.windows.some((window) => timeMs >= window.startMs && timeMs <= window.endMs)) {
      return { words: 'A good time to look', seen: true };
    }
    const elevations = night.sunElevations;
    const nearest = Math.round(share(timeMs) * (elevations.length - 1));
    return { words: SKY_WORDS[skyState(elevations[nearest])], seen: false };
  };
  const pointed = pointerMs === null ? null : happening(pointerMs);

  return (
    <div className="relative w-full basis-full pb-4">
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Time, from noon to noon where you are"
        aria-valuemin={night.startMs}
        aria-valuemax={night.endMs}
        aria-valuenow={Math.round(simMs)}
        aria-valuetext={`${formatLocalTime(simMs)}, ${happening(simMs).words}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerLeave={() => {
          if (held === null) setPointerMs(null);
        }}
        onKeyDown={onKeyDown}
        className="relative h-5 cursor-pointer touch-none rounded-sm"
      >
        {/* The selected satellite's passes: a mark for each, yellow where it can be seen. */}
        {passes.map((pass) => {
          const length = pass.setMs - pass.riseMs;
          const short = length < SHORT_PASS_MS;
          return (
            <span
              key={pass.riseMs}
              data-pass=""
              className={`absolute top-0 h-1 min-w-1 rounded-full ${
                short && pass.seeable ? 'bg-sunlit' : 'bg-chalk/55'
              }`}
              style={{
                left: percent(pass.riseMs),
                width: `${((share(pass.setMs) - share(pass.riseMs)) * 100).toFixed(3)}%`,
              }}
            >
              {!short && pass.seeable && (
                <span
                  className="absolute inset-y-0 rounded-full bg-sunlit"
                  style={{
                    left: `${((pass.seeable.fromMs - pass.riseMs) / length) * 100}%`,
                    width: `${((pass.seeable.toMs - pass.seeable.fromMs) / length) * 100}%`,
                  }}
                />
              )}
            </span>
          );
        })}

        {/* The night itself, and on it the stretches good for spotting satellites. */}
        <div
          className="absolute inset-x-0 bottom-1 h-2 overflow-hidden rounded-full"
          style={{ backgroundImage: shading }}
        >
          {night.windows.map((window) => (
            <span
              key={window.startMs}
              data-good-time=""
              className="absolute inset-y-0 bg-sunlit"
              style={{
                left: percent(window.startMs),
                width: `${((share(window.endMs) - share(window.startMs)) * 100).toFixed(3)}%`,
              }}
            />
          ))}
        </div>

        {/* Now. Edged in the panel's own dark, so it shows over the day and the yellow alike. */}
        <span
          className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-chalk shadow-[0_0_0_1.5px_var(--color-night)]"
          style={{ left: percent(simMs) }}
        />

        {pointerMs !== null && pointed && (
          <span
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-lg border border-chalk/10 bg-night/90 px-2 py-1 text-center text-2xs whitespace-nowrap backdrop-blur-xl"
            style={{ left: percent(pointerMs) }}
          >
            <span className="block font-medium text-chalk tabular-nums">
              {formatLocalClock(pointerMs)}
            </span>
            <span className={`block ${pointed.seen ? 'text-sunlit' : 'text-graphite'}`}>
              {pointed.words}
            </span>
          </span>
        )}
      </div>

      {hours.map((hour) => (
        <span
          key={hour.atMs}
          aria-hidden="true"
          className="absolute bottom-0 -translate-x-1/2 text-2xs leading-none text-graphite tabular-nums"
          style={{ left: percent(hour.atMs) }}
        >
          {hour.label}
        </span>
      ))}
    </div>
  );
}
