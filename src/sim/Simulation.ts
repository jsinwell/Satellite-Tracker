import type { SatelliteRecord } from '../core/catalog';
import { type Clock, simTimeAt } from '../core/clock';
import { STATE_STRIDE } from '../core/propagator';
import type { SimRequest, SimResponse } from './protocol';

/** The slice of `Worker` the simulation uses, so tests can supply a fake. */
export interface SimWorker {
  onmessage: ((event: MessageEvent<SimResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: SimRequest, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface SimulationStats {
  /** Time the worker spent in SGP4 for the latest state. */
  computeMs: number;
  /** Request-to-response time for the latest state, smoothed. */
  roundTripMs: number;
  /** Satellites with a valid position in the latest state. */
  propagated: number;
}

/**
 * The state on screen is allowed to be this far (in simulated time) from the
 * clock before a fresh one is requested. See `core/kinematics.ts` for why a
 * couple of seconds of extrapolation is visually exact.
 */
const MAX_STALENESS_SIM_MS = 2000;

/**
 * Extrapolation is clamped to this span. It is only reached transiently —
 * after a time jump, until the next state lands — where freezing briefly is
 * better than flinging satellites along a diverging Taylor series.
 */
const MAX_EXTRAPOLATION_S = 120;

const ROUND_TRIP_SMOOTHING = 0.2;

function spawnWorker(): SimWorker {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Main-thread handle on the simulation worker.
 *
 * Owns `state`, the buffer the renderer draws from, and keeps it close to the
 * simulation clock by asking the worker for fresh states as needed. At most
 * one request is in flight, and a single scratch buffer shuttles back and
 * forth by transfer, so the steady state allocates nothing.
 */
export class Simulation {
  readonly count: number;
  /** Catalog indices of satellites whose elements SGP4 rejected. */
  readonly invalid: readonly number[];
  /** Position and velocity of every satellite at `stateTimeMs`; see `STATE_STRIDE`. */
  readonly state: Float32Array;
  /** Simulated instant `state` is valid for. NaN until the first state arrives. */
  stateTimeMs = Number.NaN;
  /** Incremented whenever `state` is rewritten. */
  version = 0;
  readonly stats: SimulationStats = { computeMs: 0, roundTripMs: 30, propagated: 0 };

  onError: (message: string) => void = () => {};

  private readonly worker: SimWorker;
  /** The transfer buffer; null while it is with the worker. */
  private scratch: Float32Array | null;
  private requestId = 0;
  /** When the latest request was made, on the caller's wall clock. */
  private requestedAtWallMs = Number.NEGATIVE_INFINITY;
  /** The same moment on the local monotonic clock, for measuring latency. */
  private requestSentAt = 0;
  private lastClock: Clock | null = null;

  /** Starts a worker, initializes SGP4 for every satellite, and resolves once it is ready. */
  static start(
    satellites: SatelliteRecord[],
    worker: SimWorker = spawnWorker(),
  ): Promise<Simulation> {
    return new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          resolve(new Simulation(worker, data.count, data.invalid));
        } else if (data.type === 'error') {
          reject(new Error(data.message));
        }
      };
      worker.onerror = (event) => {
        reject(new Error(event.message || 'The simulation worker failed to start.'));
      };
      worker.postMessage({ type: 'init', satellites });
    });
  }

  private constructor(worker: SimWorker, count: number, invalid: readonly number[]) {
    this.worker = worker;
    this.count = count;
    this.invalid = invalid;
    this.state = new Float32Array(count * STATE_STRIDE);
    this.scratch = new Float32Array(count * STATE_STRIDE);
    worker.onmessage = ({ data }) => this.receive(data);
    worker.onerror = (event) => this.onError(event.message || 'The simulation worker crashed.');
  }

  /**
   * Call once per frame. Requests a new state from the worker when the current
   * one has gone stale or the clock has been changed.
   */
  update(clock: Clock, wallMs: number): void {
    if (this.scratch === null) return; // a request is already in flight

    const simMs = simTimeAt(clock, wallMs);
    const clockChanged = clock !== this.lastClock;
    if (!clockChanged && !this.isStale(clock.rate, simMs, wallMs)) return;
    this.lastClock = clock;

    // Aim for the middle of the window the state will be on screen for, so the
    // extrapolation runs from −half to +half instead of 0 to +full. The error
    // grows with dt³, so this is worth nearly an order of magnitude.
    const { roundTripMs } = this.stats;
    const onScreenMs =
      clock.rate === 0 ? 0 : Math.max(this.refreshIntervalMs(clock.rate), roundTripMs);
    const targetMs = simMs + clock.rate * (roundTripMs + onScreenMs / 2);

    const buffer = this.scratch;
    this.scratch = null;
    this.requestedAtWallMs = wallMs;
    this.requestSentAt = performance.now();
    this.worker.postMessage(
      { type: 'propagate', requestId: ++this.requestId, timeMs: targetMs, buffer },
      [buffer.buffer],
    );
  }

  /**
   * Seconds from `state`'s instant to `simMs`: the `dt` to extrapolate by.
   * Zero until the first state arrives.
   */
  dtSeconds(simMs: number): number {
    if (Number.isNaN(this.stateTimeMs)) return 0;
    const dt = (simMs - this.stateTimeMs) / 1000;
    return Math.min(MAX_EXTRAPOLATION_S, Math.max(-MAX_EXTRAPOLATION_S, dt));
  }

  dispose(): void {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
  }

  /** Real milliseconds between refreshes needed to honor the staleness budget. */
  private refreshIntervalMs(rate: number): number {
    return MAX_STALENESS_SIM_MS / Math.abs(rate);
  }

  private isStale(rate: number, simMs: number, wallMs: number): boolean {
    if (Number.isNaN(this.stateTimeMs)) return true;
    // Paused: the state is either exactly right or it is not.
    if (rate === 0) return Math.abs(simMs - this.stateTimeMs) > 0.5;
    return wallMs - this.requestedAtWallMs >= this.refreshIntervalMs(rate);
  }

  private receive(response: SimResponse): void {
    switch (response.type) {
      case 'state': {
        this.state.set(response.buffer);
        this.scratch = response.buffer;
        this.stateTimeMs = response.timeMs;
        this.version++;

        const roundTripMs = performance.now() - this.requestSentAt;
        this.stats.roundTripMs += ROUND_TRIP_SMOOTHING * (roundTripMs - this.stats.roundTripMs);
        this.stats.computeMs = response.computeMs;
        this.stats.propagated = response.propagated;
        return;
      }
      case 'error':
        this.onError(response.message);
        return;
      case 'ready':
        return;
    }
  }
}
