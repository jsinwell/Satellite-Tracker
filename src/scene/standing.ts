import { Vector3 } from 'three';
import { createObserverFrame, type Observer, observerFrame } from '../core/observer';
import { directionToWorld } from './frame';

/** Eye height above the drawn Earth while looking up, in Earth radii: about 600 m. */
export const EYE_HEIGHT = 1e-4;

/** An observer's eye and local axes, in world coordinates (Earth radii). */
export interface Stance {
  eye: Vector3;
  east: Vector3;
  up: Vector3;
  north: Vector3;
}

export function createStance(): Stance {
  return { eye: new Vector3(), east: new Vector3(), up: new Vector3(), north: new Vector3() };
}

const POLE = new Vector3(0, 1, 0);
const frame = createObserverFrame();

/**
 * Where the observer's eye is at `timeMs`, and which ways are east, up and
 * north for them. Up is straight away from the Earth's center, square to the
 * sphere the Earth is drawn as rather than to the real, flattened Earth, so
 * the drawn horizon is level.
 */
export function stand(observer: Observer, timeMs: number, out: Stance): Stance {
  const { eye, east, up, north } = out;
  directionToWorld(observerFrame(observer, timeMs, frame).position, up).normalize();
  eye.copy(up).multiplyScalar(1 + EYE_HEIGHT);
  east.crossVectors(POLE, up);
  // At a pole every way is south, or north; any will do.
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(up, east);
  return out;
}
