import { describe, expect, it } from 'vitest';
import { fixtures, iss } from '../core/__fixtures__/satellites';
import type { SatelliteRecord } from '../core/catalog';
import { realTimeClock, withRate, withSimTime } from '../core/clock';
import { hasState } from '../core/kinematics';
import { STATE_STRIDE } from '../core/propagator';
import { createSimHandler } from './handler';
import type { SimRequest, SimResponse } from './protocol';
import { Simulation, type SimWorker } from './Simulation';

const T0 = Date.parse(iss.elements.epoch);

/**
 * Runs the real worker handler in-process. Responses are held until `flush()`
 * so tests control exactly when the "worker" answers.
 */
class FakeWorker implements SimWorker {
  onmessage: ((event: MessageEvent<SimResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: SimRequest[] = [];
  terminated = false;

  private readonly pending: SimResponse[] = [];
  private readonly handle = createSimHandler((response) => this.pending.push(response));

  postMessage(message: SimRequest): void {
    this.requests.push(message);
    this.handle(message);
  }

  flush(): void {
    for (const response of this.pending.splice(0)) {
      this.onmessage?.({ data: response } as MessageEvent<SimResponse>);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  get propagateRequests() {
    return this.requests.filter((request) => request.type === 'propagate');
  }
}

async function start(satellites: SatelliteRecord[] = fixtures) {
  const worker = new FakeWorker();
  const starting = Simulation.start(satellites, worker);
  worker.flush();
  return { worker, simulation: await starting };
}

describe('Simulation', () => {
  it('starts once the worker has initialised every satellite', async () => {
    const { simulation } = await start();
    expect(simulation.count).toBe(fixtures.length);
    expect(simulation.invalid).toEqual([]);
    expect(simulation.state).toHaveLength(fixtures.length * STATE_STRIDE);
    expect(simulation.stateTimeMs).toBeNaN();
  });

  it('reports satellites whose elements were rejected', async () => {
    const broken = { ...iss, elements: { ...iss.elements, eccentricity: 1.5 } };
    const { simulation } = await start([iss, broken]);
    expect(simulation.invalid).toEqual([1]);
  });

  it('rejects if the worker fails to start', async () => {
    const worker = new FakeWorker();
    const starting = Simulation.start(fixtures, worker);
    worker.onerror?.({ message: 'boom' } as ErrorEvent);
    await expect(starting).rejects.toThrow('boom');
  });

  it('fills the state buffer from the first update', async () => {
    const { worker, simulation } = await start();
    simulation.update(realTimeClock(T0), T0);
    worker.flush();

    expect(simulation.version).toBe(1);
    expect(simulation.stats.propagated).toBe(fixtures.length);
    for (let i = 0; i < fixtures.length; i++) {
      expect(hasState(simulation.state, i)).toBe(true);
    }
  });

  it('never has more than one request in flight', async () => {
    const { worker, simulation } = await start();
    const clock = realTimeClock(T0);
    simulation.update(clock, T0);
    simulation.update(clock, T0 + 5000);
    simulation.update(clock, T0 + 10_000);
    expect(worker.propagateRequests).toHaveLength(1);
  });

  it('leaves a fresh state alone and refreshes a stale one', async () => {
    const { worker, simulation } = await start();
    const clock = realTimeClock(T0);
    simulation.update(clock, T0);
    worker.flush();

    simulation.update(clock, T0 + 100);
    expect(worker.propagateRequests).toHaveLength(1);

    simulation.update(clock, T0 + 2500);
    expect(worker.propagateRequests).toHaveLength(2);
  });

  it('refreshes more often as the time rate rises', async () => {
    const { worker, simulation } = await start();
    const clock = withRate(realTimeClock(T0), T0, 100);
    simulation.update(clock, T0);
    worker.flush();

    // 100 ms of real time is 10 s of simulated time: stale at 100×, fresh at 1×.
    simulation.update(clock, T0 + 100);
    expect(worker.propagateRequests).toHaveLength(2);
  });

  it('aims ahead of the clock so the state straddles the instants it is shown for', async () => {
    const { worker, simulation } = await start();
    const clock = withRate(realTimeClock(T0), T0, 10);
    simulation.update(clock, T0);

    const [request] = worker.propagateRequests;
    expect(request.timeMs).toBeGreaterThan(T0);
    // Within one refresh interval (200 ms real = 2 s simulated) plus latency.
    expect(request.timeMs).toBeLessThan(T0 + 3000);
  });

  it('aims behind the clock when time runs backwards', async () => {
    const { worker, simulation } = await start();
    simulation.update(withRate(realTimeClock(T0), T0, -10), T0);
    expect(worker.propagateRequests[0].timeMs).toBeLessThan(T0);
  });

  it('refreshes immediately when the clock is changed', async () => {
    const { worker, simulation } = await start();
    const clock = realTimeClock(T0);
    simulation.update(clock, T0);
    worker.flush();

    const jumped = withSimTime(clock, T0 + 10, T0 + 86_400_000);
    simulation.update(jumped, T0 + 10);
    worker.flush();

    expect(worker.propagateRequests).toHaveLength(2);
    expect(Math.abs(simulation.stateTimeMs - (T0 + 86_400_000))).toBeLessThan(5000);
  });

  it('settles on the exact instant when paused, then stops asking', async () => {
    const { worker, simulation } = await start();
    const running = realTimeClock(T0);
    simulation.update(running, T0);
    worker.flush();

    const paused = withRate(running, T0 + 400, 0);
    simulation.update(paused, T0 + 400);
    worker.flush();
    expect(simulation.stateTimeMs).toBe(T0 + 400);
    expect(simulation.dtSeconds(T0 + 400)).toBe(0);

    simulation.update(paused, T0 + 60_000);
    simulation.update(paused, T0 + 120_000);
    expect(worker.propagateRequests).toHaveLength(2);
  });

  it('reports how far to extrapolate, clamped after a large jump', async () => {
    const { worker, simulation } = await start();
    expect(simulation.dtSeconds(T0)).toBe(0); // no state yet

    simulation.update(withRate(realTimeClock(T0), T0, 0), T0);
    worker.flush();

    expect(simulation.dtSeconds(T0 + 1500)).toBeCloseTo(1.5);
    expect(simulation.dtSeconds(T0 - 1500)).toBeCloseTo(-1.5);
    expect(simulation.dtSeconds(T0 + 86_400_000)).toBe(120);
    expect(simulation.dtSeconds(T0 - 86_400_000)).toBe(-120);
  });

  it('surfaces worker errors', async () => {
    const { worker, simulation } = await start();
    const errors: string[] = [];
    simulation.onError = (message) => errors.push(message);

    worker.onmessage?.({ data: { type: 'error', message: 'bad' } } as MessageEvent<SimResponse>);
    worker.onerror?.({ message: 'crashed' } as ErrorEvent);

    expect(errors).toEqual(['bad', 'crashed']);
  });

  it('terminates the worker on dispose', async () => {
    const { worker, simulation } = await start();
    simulation.dispose();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
  });
});

describe('createSimHandler', () => {
  it('reports an error for a propagate request before init', () => {
    const responses: SimResponse[] = [];
    const handle = createSimHandler((response) => responses.push(response));

    handle({ type: 'propagate', requestId: 1, timeMs: T0, buffer: new Float32Array(6) });

    expect(responses).toEqual([{ type: 'error', message: expect.stringContaining('before init') }]);
  });

  it('hands the buffer back for transfer', () => {
    const transfers: Transferable[][] = [];
    const handle = createSimHandler((_response, transfer = []) => transfers.push(transfer));
    const buffer = new Float32Array(STATE_STRIDE);

    handle({ type: 'init', satellites: [iss] });
    handle({ type: 'propagate', requestId: 7, timeMs: T0, buffer });

    expect(transfers.at(-1)).toEqual([buffer.buffer]);
  });
});
