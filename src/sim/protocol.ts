import type { SatelliteRecord } from '../core/catalog';

/** Messages from the main thread to the simulation worker. */
export type SimRequest =
  | { type: 'init'; satellites: SatelliteRecord[] }
  | {
      type: 'propagate';
      requestId: number;
      timeMs: number;
      /** Transferred to the worker, filled, and transferred back. */
      buffer: Float32Array;
    };

/** Messages from the simulation worker to the main thread. */
export type SimResponse =
  | { type: 'ready'; count: number; invalid: number[] }
  | {
      type: 'state';
      requestId: number;
      timeMs: number;
      buffer: Float32Array;
      /** Number of satellites successfully propagated. */
      propagated: number;
      /** Time the worker spent in SGP4, for the performance readout. */
      computeMs: number;
    }
  | { type: 'error'; message: string };
