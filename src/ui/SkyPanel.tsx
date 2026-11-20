import { type FormEvent, useId, useState } from 'react';
import { satelliteColor } from '../app/palette';
import { useApp } from '../app/store';
import type { World } from '../app/world';
import { BODY_NAMES, type SkyBody } from '../core/bodies';
import { soleEnabled } from '../core/constellation';
import { type Observer, parseCoordinates, skyState } from '../core/observer';
import { brightnessWords } from '../core/planets';
import {
  formatCompass,
  formatInteger,
  formatLocalClock,
  formatLocalTime,
  formatPlace,
  litWords,
} from './format';
import {
  useBodyView,
  useEclipse,
  usePlanetsUp,
  useSimTime,
  useSkyNow,
  useViewingWindow,
} from './hooks';
import { CloseButton, Panel, PanelHeading, PanelTitle, SUNLIT_TAG } from './Panel';

/** Rows listed under "Up now"; the rest are counted. */
const LISTED = 8;

const buttonClass =
  'rounded-full bg-chalk/10 px-3.5 py-1.5 text-xs font-medium text-chalk hover:bg-chalk/20 disabled:text-graphite';

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
        <p className="text-xs text-chalk/80">Click where you are on the globe.</p>
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
            className="rounded-full px-2 py-1.5 text-xs text-graphite hover:text-chalk"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
      </div>
      {locating.state === 'failed' && (
        <p role="alert" className="text-xs text-caution">
          {locating.message}
        </p>
      )}
      <form onSubmit={submit}>
        <label htmlFor={inputId} className="mb-1 block text-xs text-graphite">
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
          className="w-full rounded-lg border border-chalk/15 bg-space/40 px-3 py-1.5 text-xs text-chalk tabular-nums outline-none placeholder:text-graphite/60 focus:border-chalk/50 aria-invalid:border-caution"
        />
        {typedError && (
          <p id={`${inputId}-error`} className="mt-1 text-xs text-caution">
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
      <p className="text-sunlit">
        {eclipse.covered >= 1
          ? 'Total solar eclipse: the Moon is covering the Sun.'
          : `Partial solar eclipse: the Moon covers ${Math.max(1, Math.round(eclipse.covered * 100))}% of the Sun.`}
      </p>
    );
  }
  return (
    <p className="text-sunlit">
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
    return <p className="text-graphite">The sky doesn't get dark enough here for a while.</p>;
  }
  if (window.startMs <= simMs) {
    return (
      <p className="text-sunlit">
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

/** One line of the list below: click it to look at that body up close. */
function BodyRow({
  body,
  note,
  elevation,
  azimuth,
}: {
  body: SkyBody;
  note: string;
  elevation: number;
  azimuth: number;
}) {
  const watching = useApp((state) => state.watching === body);
  return (
    <li>
      <button
        type="button"
        onClick={() => useApp.getState().watch(body)}
        aria-pressed={watching}
        title={`Look at ${body === 'moon' ? 'the Moon' : BODY_NAMES[body]} up close`}
        className="flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1 text-left text-xs hover:bg-chalk/10 aria-pressed:bg-chalk/20"
      >
        <span className="text-chalk">{BODY_NAMES[body]}</span>
        <span className="min-w-0 flex-1 truncate text-graphite">{note}</span>
        <span className="w-16 shrink-0 text-right text-chalk/80 tabular-nums">
          {Math.round(elevation)}° {formatCompass(azimuth)}
        </span>
      </button>
    </li>
  );
}

/**
 * The Moon, if it is up, and the planets in the sky, brightest first. The
 * planets are the brightest points of light after the Moon, so they are what
 * a moving satellite is most easily mistaken for, and the first thing to rule
 * out. Clicking one turns the view to it and closes in.
 */
function PlanetsUp({ observer }: { observer: Observer }) {
  const planets = usePlanetsUp(observer);
  const moon = useBodyView('moon', observer);
  const moonUp = moon.elevation > 0;
  return (
    <div className="border-t border-chalk/10 px-2 py-2.5">
      <PanelHeading className="px-2">Moon and planets</PanelHeading>
      {planets.length === 0 && !moonUp ? (
        <p className="px-2 text-xs text-graphite">None above the horizon right now.</p>
      ) : (
        <ul aria-label="Moon and planets above the horizon">
          {moonUp && (
            <BodyRow
              body="moon"
              note={litWords(moon.litFraction)}
              elevation={moon.elevation}
              azimuth={moon.azimuth}
            />
          )}
          {planets.map(({ planet, magnitude, azimuth, elevation }) => (
            <BodyRow
              key={planet}
              body={planet}
              note={brightnessWords(magnitude)}
              elevation={elevation}
              azimuth={azimuth}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UpNow({ world, observer }: { world: World; observer: Observer }) {
  // What is said to be seen is what the view from the ground is showing:
  // through binoculars if that is what it is set to, and by eye otherwise.
  const binoculars = useApp((state) => state.skyShows === 'binoculars');
  const sky = useSkyNow(world, observer, binoculars ? 'binoculars' : 'eye');
  const colorBy = useApp((state) => state.colorBy);
  const alone = useApp((state) => soleEnabled(state.filters.constellations));
  const dark = skyState(sky.sunElevation) !== 'day';
  const lookingUp = useApp((state) => state.lookingUp);

  return (
    <>
      <div className="space-y-2.5 border-t border-chalk/10 px-4 py-2.5 text-xs text-chalk/80">
        <div className="space-y-1">
          <EclipseNow observer={observer} />
          <SkyDarkness sunElevation={sky.sunElevation} />
          <WhenToLook observer={observer} />
        </div>
        <button
          type="button"
          onClick={() => useApp.getState().setLookingUp(!lookingUp)}
          aria-pressed={lookingUp}
          className="w-full rounded-lg bg-chalk/15 px-3 py-2 text-xs font-semibold text-chalk hover:bg-chalk/25"
        >
          {lookingUp ? 'Back to the globe' : 'Look up from here'}
        </button>
      </div>
      <PlanetsUp observer={observer} />
      <div className="border-t border-chalk/10 px-2 py-2.5">
        <div className="px-2">
          <PanelHeading>Up now</PanelHeading>
          <p className="mb-1.5 text-xs text-graphite">
            {formatInteger(sky.above.length)} above the horizon
            {dark && (
              <>
                {', '}
                <span className={sky.seeable > 0 ? 'text-sunlit' : undefined}>
                  {sky.seeable === 0 ? 'none' : formatInteger(sky.seeable)}{' '}
                  {binoculars ? 'in binoculars' : 'you could see'}
                </span>
              </>
            )}
          </p>
          {skyState(sky.sunElevation) === 'dark' && sky.seeable === 0 && sky.withinReach > 0 && (
            <p className="mb-1.5 text-xs text-graphite">
              The {formatInteger(sky.withinReach)} bright enough{' '}
              {binoculars ? 'for binoculars' : 'to see'} are all in the Earth's shadow at this hour.
            </p>
          )}
        </div>
        <ul aria-label="Satellites above the horizon">
          {sky.above.slice(0, LISTED).map((entry) => (
            <li key={entry.index}>
              <button
                type="button"
                onClick={() => useApp.getState().selectAndFocus(entry.index)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-xs hover:bg-chalk/10"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: satelliteColor(world, entry.index, colorBy, alone) }}
                />
                <span className="min-w-0 flex-1 truncate text-chalk">
                  {world.satellites[entry.index].name}
                </span>
                {entry.seeable && (
                  <span
                    className={SUNLIT_TAG}
                    title={
                      binoculars
                        ? 'Sunlit, and bright enough for binoculars'
                        : 'Sunlit, and bright enough to see: look for a moving star'
                    }
                  >
                    {binoculars ? 'binoculars' : 'visible'}
                  </span>
                )}
                <span className="w-16 shrink-0 text-right text-chalk/80 tabular-nums">
                  {Math.round(entry.elevation)}° {formatCompass(entry.azimuth)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 px-2 text-2xs text-graphite">
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
          <PanelTitle>Your sky</PanelTitle>
          {shown ? (
            <p className="mt-0.5 flex items-baseline gap-2 text-xs text-graphite tabular-nums">
              {formatPlace(shown.latitude, shown.longitude)}
              <button
                type="button"
                onClick={() => setChangingFrom(shown)}
                className="rounded text-chalk underline decoration-chalk/40 underline-offset-2 hover:decoration-chalk"
              >
                Change
              </button>
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-graphite">
              Where are you? See what's overhead, and when a satellite passes over.
            </p>
          )}
        </div>
        <CloseButton onClick={onClose} />
      </header>
      {shown ? (
        <UpNow world={world} observer={shown} />
      ) : (
        <ChooseLocation onCancel={observer ? () => setChangingFrom(null) : undefined} />
      )}
    </Panel>
  );
}
