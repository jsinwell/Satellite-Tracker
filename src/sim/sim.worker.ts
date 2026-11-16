import { createSimHandler } from './handler';
import type { SimRequest, SimResponse } from './protocol';

// The app compiles against the DOM library, which types `self` as a Window.
// This is the slice of the dedicated-worker global scope the worker relies on.
interface WorkerScope {
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
  postMessage(message: SimResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const handle = createSimHandler((response, transfer = []) => scope.postMessage(response, transfer));

scope.onmessage = (event) => handle(event.data);
