/**
 * The simulation clock is a pure function of the wall clock: simulated time
 * advances at `rate` simulated seconds per real second from an anchor pair.
 * Nothing ticks or accumulates, so the clock cannot drift and any consumer can
 * sample it at any moment and get a consistent answer.
 */
export interface Clock {
  /** Wall-clock instant (ms since Unix epoch) at which the anchor was set. */
  readonly anchorWallMs: number;
  /** Simulated instant (ms since Unix epoch) at the anchor. */
  readonly anchorSimMs: number;
  /** Simulated seconds per real second. 0 is paused; negative runs backwards. */
  readonly rate: number;
}

export const TIME_RATES = [1, 10, 100, 1000] as const;

/**
 * The wall clock, in ms since the Unix epoch. Unlike `Date.now()` it is
 * monotonic and sub-millisecond, which matters at high time rates: a 1 ms step
 * at 1000× is a visible 7 km jump in low orbit.
 */
export function wallNow(): number {
  return performance.timeOrigin + performance.now();
}

/**
 * A reading that can be held still. Between `hold` and `release`, `now`
 * gives the reading taken at `hold`; otherwise it reads afresh each time.
 *
 * One frame of the picture is drawn by many hands, each asking the time: the
 * camera, the Earth, the sky, the ground. Asked a fraction of a millisecond
 * apart they get different answers, and at 1000× that fraction is enough
 * for the Earth to have turned hundreds of meters between the camera being
 * placed on it and the ground being drawn under the camera. Held for the
 * frame, the time is the same for all of them.
 */
export interface Holdable {
  now(): number;
  hold(): void;
  release(): void;
}

export function holdable(read: () => number): Holdable {
  let held: number | null = null;
  return {
    now: () => held ?? read(),
    hold: () => {
      held = read();
    },
    release: () => {
      held = null;
    },
  };
}

/** A clock running in real time, showing the present. */
export function realTimeClock(wallMs: number): Clock {
  return { anchorWallMs: wallMs, anchorSimMs: wallMs, rate: 1 };
}

export function simTimeAt(clock: Clock, wallMs: number): number {
  return clock.anchorSimMs + (wallMs - clock.anchorWallMs) * clock.rate;
}

/** Changes the rate without moving simulated time. */
export function withRate(clock: Clock, wallMs: number, rate: number): Clock {
  return { anchorWallMs: wallMs, anchorSimMs: simTimeAt(clock, wallMs), rate };
}

/** Jumps simulated time, keeping the rate. */
export function withSimTime(clock: Clock, wallMs: number, simMs: number): Clock {
  return { anchorWallMs: wallMs, anchorSimMs: simMs, rate: clock.rate };
}
