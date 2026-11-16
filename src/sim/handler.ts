import { Propagator } from '../core/propagator';
import type { SimRequest, SimResponse } from './protocol';

export type PostResponse = (response: SimResponse, transfer?: Transferable[]) => void;

/**
 * The worker's message handler, kept free of worker globals so it can be
 * exercised directly in tests.
 */
export function createSimHandler(post: PostResponse): (request: SimRequest) => void {
  let propagator: Propagator | null = null;

  return (request) => {
    try {
      switch (request.type) {
        case 'init': {
          propagator = new Propagator(request.satellites);
          post({ type: 'ready', count: propagator.count, invalid: [...propagator.invalid] });
          return;
        }
        case 'propagate': {
          if (!propagator) {
            throw new Error('Simulation received a propagate request before init.');
          }
          const startedAt = performance.now();
          const propagated = propagator.propagate(request.timeMs, request.buffer);
          post(
            {
              type: 'state',
              requestId: request.requestId,
              timeMs: request.timeMs,
              buffer: request.buffer,
              propagated,
              computeMs: performance.now() - startedAt,
            },
            [request.buffer.buffer],
          );
          return;
        }
      }
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
}
