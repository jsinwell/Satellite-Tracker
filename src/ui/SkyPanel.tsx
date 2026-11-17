import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { satelliteColor } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { soleEnabled } from '../core/constellation';
import { type Observer, parseCoordinates, skyState } from '../core/observer';
import { brightnessWords, PLANET_NAMES } from '../core/planets';
import {
  formatCompass,
  formatInteger,
  formatLocalClock,
  formatLocalTime,
  formatPlace,
} from './format';
import { useEclipse, usePlanetsUp, useSimTime, useSkyNow, useViewingWindow } from './hooks';
import { Panel } from './Panel';

/** Rows listed under "Up now"; the rest are counted. */
const LISTED = 8;

const buttonClass =
  'rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/10 disabled:text-slate-500';

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[0.65rem] font-semibold tracking-widest text-slate-500 uppercase">
      {children}
    </h3>
  );
}

type Locating = { state: 'idle' } | { state: 'busy' } | { state: 'failed'; message: string };

function geolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location access is turned off for this site. Pick your spot on the globe instead.';
    case error.TIMEOUT:
      return 'Finding your location took too long. Try again, or pick it on the globe.';
    default:
      return 'Your location could not be found. Pick it on the globe instead.';
  }
}

/** The ways to say where you are: the device's location, a click on the globe, or typed coordinates. */
function ChooseLocation({ onCancel }: { onCancel?: () => void }) {
  const picking = useApp((state) => state.pickingObserver);
  const { setObserver, setPickingObserver } = useApp.getState();
  const [locating, setLocating] = useState<Locating>({ state: 'idle' });
  const [typed, setTyped] = useState('');
  const [typedError, setTypedError] = useState(false);
  const inputId = useId();

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocating({ state: 'failed', message: 'This browser cannot share its location.' });
      return;
    }
    setLocating({ state: 'busy' });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating({ state: 'idle' });
        // Two decimals is about a kilometer: plenty for the sky, and no more
        // precise than anyone needs their location remembered.
        const round = (degrees: number) => Math.round(degrees * 100) / 100;
        setObserver({ latitude: round(coords.latitude), longitude: round(coords.longitude) });
      },
      (error) => setLocating({ state: 'failed', message: geolocationError(error) }),
      { timeout: 15_000, maximumAge: 600_000 },
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const observer = parseCoordinates(typed);
    setTypedError(observer === null);
    if (observer) setObserver(observer);
  };

  if (picking) {
    return (
      <div className="space-y-2 px-4 pb-3">
        <p className="text-xs text-slate-300">Click where you are on the globe.</p>
        <button type="button" className={buttonClass} onClick={() => setPickingObserver(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={locate}
          disabled={locating.state === 'busy'}
        >
          {locating.state === 'busy' ? 'Finding you…' : 'Use my location'}
        </button>
        <button type="button" className={buttonClass} onClick={() => setPickingObserver(true)}>
          Pick on the globe
        </button>
        {onCancel && (
          <button
            type="button"
            className="px-2 py-1.5 text-xs text-slate-400 hover:text-slate-200"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      {locating.state === 'failed' && (
        <p role="alert" className="text-xs text-amber-300/90">
          {locating.message}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor={inputId} className="mb-1 block text-xs text-slate-400">
          Or type its coordinates
        </label>
        <input
          id={inputId}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setTypedError(false);
          }}
          placeholder="41.88, -87.63"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={typedError}
          aria-describedby={typedError ? `${inputId}-error` : undefined}
          className="w-full rounded-lg border border-white/10 bg-slate-900/80 px-3 py-1.5 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-accent/60 aria-invalid:border-amber-300/60"
        />
        {typedError && (
          <p id={`${inputId}-error`} className="mt-1 text-xs text-amber-300/90">
            That doesn't look like a latitude and longitude. Try "41.88, -87.63".
          </p>
        )}
      </form>
    </div>
  );
}

function SkyDarkness({ sunElevation }: { sunElevation: number }) {
  const degrees = Math.abs(Math.round(sunElevation));
  switch (skyState(sunElevation)) {
    case 'dark':
      return <p>Dark sky: the Sun is {degrees}° below the horizon.</p>;
    case 'twilight':
      return <p>Twilight: the Sun is {degrees}° below the horizon.</p>;
    case 'day':
      return <p>Daylight: the Sun is {degrees}° up.</p>;
  }
}

/** An eclipse going on overhead, said plainly; nothing when there is none. */
function EclipseNow({ observer }: { observer: Observer }) {
  const eclipse = useEclipse(observer);
  if (!eclipse) return null;
  if (eclipse.kind === 'solar') {
    return (
      <p className="text-amber-200">
        {eclipse.covered >= 1
          ? 'Total solar eclipse: the Moon is covering the Sun.'
          : `Partial solar eclipse: the Moon covers ${Math.max(1, Math.round(eclipse.covered * 100))}% of the Sun.`}
      </p>
    );
  }
  return (
    <p className="text-amber-200">
      {eclipse.inUmbra
        ? "Lunar eclipse: the Moon is in the Earth's shadow."
        : "Lunar eclipse: the Moon is passing through the edge of the Earth's shadow."}
    </p>
  );
}

/**
 * When to go out and look: satellites shine by sunlight against a dark sky,
 * which only happens in the hour or two after dusk and before dawn.
 */
function WhenToLook({ observer }: { observer: Observer }) {
  const window = useViewingWindow(observer);
  const simMs = useSimTime(10_000);
  if (!window) {
    return <p className="text-slate-400">The sky doesn't get dark enough here for a while.</p>;
  }
  if (window.startMs <= simMs) {
    return (
      <p className="text-emerald-300">
        A good time to look: low satellites are lit against a dark sky until{' '}
        {formatLocalClock(window.endMs)}.
      </p>
    );
  }
  return (
    <p>
      Best time to look: {formatLocalTime(window.startMs)} to {formatLocalClock(window.endMs)}, when
      the sky is dark but low satellites are still in sunlight.
    </p>
  );
}

/**
 * The planets in the sky, brightest first. They are the brightest points of
 * light after the Moon, so they are what a moving satellite is most easily
 * mistaken for, and the first thing to rule out.
 */
function PlanetsUp({ observer }: { observer: Observer }) {
  const planets = usePlanetsUp(observer);
  return (
    <div className="border-t border-white/10 px-2 py-2.5">
      <div className="px-2">
        <Heading>Planets</Heading>
      </div>
      {planets.length === 0 ? (
        <p className="px-2 text-xs text-slate-400">None above the horizon right now.</p>
      ) : (
        <ul aria-label="Planets above the horizon">
          {planets.map(({ planet, magnitude, azimuth, elevation }) => (
            <li key={planet} className="flex items-baseline gap-2.5 px-2 py-0.5 text-xs">
              <span className="text-slate-100">{PLANET_NAMES[planet]}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">
                {brightnessWords(magnitude)}
              </span>
              <span className="w-16 shrink-0 text-right font-mono text-slate-300 tabular-nums">
                {Math.round(elevation)}° {formatCompass(azimuth)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpNow({ world, observer }: { world: World; observer: Observer }) {
  const sky = useSkyNow(world, observer);
  const colorBy = useApp((state) => state.colorBy);
  const alone = useApp((state) => soleEnabled(state.filters.constellations));
  const dark = skyState(sky.sunElevation) !== 'day';
  const lookingUp = useApp((state) => state.lookingUp);

  return (
    <>
      <div className="space-y-2.5 border-t border-white/10 px-4 py-2.5 text-xs text-slate-300">
        <div className="space-y-1">
          <EclipseNow observer={observer} />
          <SkyDarkness sunElevation={sky.sunElevation} />
          <WhenToLook observer={observer} />
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().setLookingUp(!lookingUp)}
          aria-pressed={lookingUp}
          className="w-full rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25"
        >
          {lookingUp ? 'Back to the globe' : 'Look up from here'}
        </button>
      </div>
      <PlanetsUp observer={observer} />
      <div className="border-t border-white/10 px-2 py-2.5">
        <div className="px-2">
          <Heading>Up now</Heading>
          <p className="mb-1.5 text-xs text-slate-400">
            {formatInteger(sky.above.length)} above the horizon
            {dark && (
              <>
                {' · '}
                <span className={sky.seeable > 0 ? 'text-emerald-300' : undefined}>
                  {sky.seeable === 0 ? 'none' : formatInteger(sky.seeable)} you could see
                </span>
              </>
            )}
          </p>
          {skyState(sky.sunElevation) === 'dark' && sky.seeable === 0 && sky.withinReach > 0 && (
            <p className="mb-1.5 text-xs text-slate-400">
              The {formatInteger(sky.withinReach)} close enough to see are all in the Earth's shadow
              at this hour.
            </p>
          )}
        </div>
        <ul aria-label="Satellites above the horizon">
          {sky.above.slice(0, LISTED).map((entry) => (
            <li key={entry.index}>
              <button
                type="button"
                onClick={() => useApp.getState().selectAndFocus(entry.index)}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-xs hover:bg-white/10"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: satelliteColor(world, entry.index, colorBy, alone) }}
                />
                <span className="min-w-0 flex-1 truncate text-slate-100">
                  {world.satellites[entry.index].name}
                </span>
                {entry.seeable && (
                  <span
                    className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[0.65rem] text-emerald-300"
                    title="Sunlit, well up, and in a dark sky: look for a moving star"
                  >
                    visible
                  </span>
                )}
                <span className="w-16 shrink-0 text-right font-mono text-slate-300 tabular-nums">
                  {Math.round(entry.elevation)}° {formatCompass(entry.azimuth)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 px-2 text-[0.7rem] text-slate-500">
          Height above the horizon and direction. Select a satellite to see when it passes over
          next.
        </p>
      </div>
    </>
  );
}

/**
 * What is in the sky over a place the viewer chooses: whether it is dark
 * enough to see satellites, and which are up right now.
 */
export function SkyPanel({ world, onClose }: { world: World; onClose(): void }) {
  const observer = useApp((state) => state.observer);
  // The place being changed away from. Choosing any place replaces the
  // observer, which ends the change without anything having to reset it.
  const [changingFrom, setChangingFrom] = useState<Observer | null>(null);
  const shown = observer !== null && changingFrom !== observer ? observer : null;

  return (
    <Panel aria-label="Your sky" className="w-full text-sm">
      <header className="flex items-start gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-white">Your sky</h2>
          {shown ? (
            // Baselines, not centers: the coordinates are monospaced and the
            // button is not, and the two fonts sit differently in their boxes.
            <p className="mt-0.5 flex items-baseline gap-2 font-mono text-xs text-slate-400">
              {formatPlace(shown.latitude, shown.longitude)}
              <button
                type="button"
                onClick={() => setChangingFrom(shown)}
                className="font-sans text-accent hover:underline"
              >
                Change
              </button>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-400">
              Where are you? See what's overhead, and when a satellite passes over.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-0.5 -mr-1.5 rounded-md px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </header>
      {shown ? (
        <UpNow world={world} observer={shown} />
      ) : (
        <ChooseLocation onCancel={observer ? () => setChangingFrom(null) : undefined} />
      )}
    </Panel>
  );
}
