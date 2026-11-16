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
