import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { isSunlit, subSatellitePoint } from '../core/astro';
import { type BodyView, bodyView, type SkyBody } from '../core/bodies';
import { wallNow } from '../core/clock';
import { type EclipseView, eclipseFrom } from '../core/eclipse';
import { footprintWidthKm } from '../core/ground';
import { extrapolatePosition, hasState, speed, type Vec3 } from '../core/kinematics';
import {
  createObserverFrame,
  nextViewingWindow,
  type Observer,
  observerFrame,
  type PassPrediction,
  predictPasses,
  type SkyNow,
  skyNow,
  type ViewingWindow,
} from '../core/observer';
import { type PlanetInSky, planetsUp } from '../core/planets';

/**
 * Re-evaluates `read` on an interval. The simulation changes every frame;
 * panels that display it sample it a few times a second instead of
 * re-rendering React at the frame rate.
 *
 * `read` must be referentially stable (module-level or `useCallback`).
 */
function usePolled<T>(read: () => T, intervalMs: number): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    const timer = setInterval(() => setValue(read()), intervalMs);
    return () => clearInterval(timer);
  }, [read, intervalMs]);
  return value;
}

/** Tailwind's `lg` breakpoint: from here up the bottom of the screen is one row. */
const WIDE_SCREEN = '(min-width: 64rem)';

/** Tailwind's `sm` breakpoint: below it is a phone, with a layout of its own. */
const NOT_A_PHONE = '(min-width: 40rem)';

/** Tells `onChange` whenever the answer to a media query changes. */
const watching = (media: string) => (onChange: () => void) => {
  const query = window.matchMedia(media);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const watchWidth = watching(WIDE_SCREEN);
const watchPhone = watching(NOT_A_PHONE);

/**
 * True on a screen wide enough for the time bar to sit beside the filters.
 * For what is not worth working out, let alone drawing, where there is no
 * room to show it: CSS alone would hide it and still pay for it.
 */
export function useWideScreen(): boolean {
  return useSyncExternalStore(watchWidth, () => window.matchMedia(WIDE_SCREEN).matches);
}

/**
 * True on a phone-sized screen, which gets a layout of its own: one sheet at
 * the bottom in place of panels at the sides.
 */
export function usePhoneScreen(): boolean {
  return !useSyncExternalStore(watchPhone, () => window.matchMedia(NOT_A_PHONE).matches);
}

/** The simulated instant, refreshed every `intervalMs`. */
export function useSimTime(intervalMs: number): number {
  return usePolled(currentSimTime, intervalMs);
}

/** The real, present instant, refreshed every `intervalMs`. */
export function useWallTime(intervalMs: number): number {
  return usePolled(wallNow, intervalMs);
}

export interface Telemetry {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive. */
  longitude: number;
  altitudeKm: number;
  speedKmS: number;
  sunlit: boolean;
  /** How wide its coverage is, km: the stretch of ground that has it above the horizon. */
  footprintKm: number;
}

const TELEMETRY_INTERVAL_MS = 250;
const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function readTelemetry(world: World, index: number): Telemetry | null {
  const { simulation } = world;
  if (!hasState(simulation.state, index)) return null;
  const simMs = currentSimTime();
  const position = extrapolatePosition(
    simulation.state,
    index,
    simulation.dtSeconds(simMs),
    scratch,
  );
  return {
    ...subSatellitePoint(position, simMs),
    speedKmS: speed(simulation.state, index),
    sunlit: isSunlit(position, simMs),
    footprintKm: footprintWidthKm(Math.hypot(position.x, position.y, position.z)),
  };
}

/** Live position of one satellite, or null while it has no propagated state. */
export function useTelemetry(world: World, index: number): Telemetry | null {
  const read = useCallback(() => readTelemetry(world, index), [world, index]);
  return usePolled(read, TELEMETRY_INTERVAL_MS);
}

const SKY_INTERVAL_MS = 1000;
const frame = createObserverFrame();

function readSky(world: World, observer: Observer, seenWith: 'eye' | 'binoculars'): SkyNow {
  const { simulation } = world;
  const simMs = currentSimTime();
  return skyNow(
    observerFrame(observer, simMs, frame),
    simMs,
    simulation.state,
    simulation.count,
    simulation.dtSeconds(simMs),
    useApp.getState().visible,
    world.standardMagnitudes,
    seenWith,
  );
}

/**
 * What is above `observer` now, among the satellites the filters show, and
 * which of them show by eye, or in binoculars if `seenWith` says so.
 */
export function useSkyNow(
  world: World,
  observer: Observer,
  seenWith: 'eye' | 'binoculars' = 'eye',
): SkyNow {
  const read = useCallback(() => readSky(world, observer, seenWith), [world, observer, seenWith]);
  return usePolled(read, SKY_INTERVAL_MS);
}

/** How far ahead passes are looked for. */
export const PASS_HORIZON_MS = 3 * 86_400_000;
const PASS_LIMIT = 5;
/** With no pass to wait for, the prediction is redone after this much simulated time. */
const PASS_STALE_MS = 3_600_000;

interface PassCache {
  key: string;
  fromMs: number;
  /** Redone once simulated time passes this, or goes back before `fromMs`. */
  untilMs: number;
  prediction: PassPrediction | null;
}

function predict(world: World, index: number, observer: Observer, simMs: number): PassCache {
  const prediction = predictPasses(
    world.satellites[index],
    observer,
    simMs,
    simMs + PASS_HORIZON_MS,
    PASS_LIMIT,
  );
  const first = prediction?.kind === 'passes' ? prediction.passes[0] : undefined;
  return {
    key: `${index}:${observer.latitude}:${observer.longitude}`,
    fromMs: simMs,
    untilMs: first ? first.setMs : simMs + PASS_STALE_MS,
    prediction,
  };
}

/**
 * The next passes of satellite `index` over `observer`. Predicting them takes
 * a few milliseconds, so it is only redone when the first one is over, or
 * when simulated time jumps.
 */
export function usePasses(world: World, index: number, observer: Observer): PassPrediction | null {
  const key = `${index}:${observer.latitude}:${observer.longitude}`;
  const [cache, setCache] = useState(() => predict(world, index, observer, currentSimTime()));
  useEffect(() => {
    const check = () => {
      const simMs = currentSimTime();
      setCache((current) =>
        current.key === key && simMs >= current.fromMs && simMs <= current.untilMs
          ? current
          : predict(world, index, observer, simMs),
      );
    };
    check();
    const timer = setInterval(check, SKY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [world, index, observer, key]);
  // A new satellite or place: predict straight away rather than show the old one's.
  if (cache.key !== key) {
    const fresh = predict(world, index, observer, currentSimTime());
    setCache(fresh);
    return fresh.prediction;
  }
  return cache.prediction;
}

interface WindowCache {
  observer: Observer;
  fromMs: number;
  window: ViewingWindow | null;
}

/** With no window to wait for, the search is redone after this much simulated time. */
const WINDOW_STALE_MS = 6 * 3_600_000;

function findWindow(observer: Observer, simMs: number): WindowCache {
  return { observer, fromMs: simMs, window: nextViewingWindow(observer, simMs) };
}

/**
 * The next good time to look for satellites from `observer`; see
 * `nextViewingWindow`. Searched for again once it is over, or when simulated
 * time jumps back before it was found.
 */
export function useViewingWindow(observer: Observer): ViewingWindow | null {
  const [cache, setCache] = useState(() => findWindow(observer, currentSimTime()));
  useEffect(() => {
    const check = () => {
      const simMs = currentSimTime();
      setCache((current) => {
        const until = current.window ? current.window.endMs : current.fromMs + WINDOW_STALE_MS;
        return current.observer === observer && simMs >= current.fromMs && simMs <= until
          ? current
          : findWindow(observer, simMs);
      });
    };
    check();
    const timer = setInterval(check, SKY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [observer]);
  return cache.observer === observer ? cache.window : null;
}

/** The planets above `observer`'s horizon that the eye can see, brightest first. */
export function usePlanetsUp(observer: Observer): PlanetInSky[] {
  const read = useCallback(() => planetsUp(observer, currentSimTime()), [observer]);
  return usePolled(read, SKY_INTERVAL_MS);
}

/** How the Moon or a planet looks to `observer` now; see `bodyView`. */
export function useBodyView(body: SkyBody, observer: Observer): BodyView {
  const read = useCallback(() => bodyView(body, observer, currentSimTime()), [body, observer]);
  return usePolled(read, SKY_INTERVAL_MS);
}

/** The eclipse `observer` could see now, if any; see `eclipseFrom`. */
export function useEclipse(observer: Observer): EclipseView | null {
  const read = useCallback(() => eclipseFrom(observer, currentSimTime()), [observer]);
  return usePolled(read, SKY_INTERVAL_MS);
}
