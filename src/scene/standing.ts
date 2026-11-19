import { Vector3 } from 'three';
import { createObserverFrame, type Observer, observerFrame } from '../core/observer';
import { directionToWorld } from './frame';

/** Eye height above the drawn Earth while looking up, in Earth radii: about 600 m. */
export const EYE_HEIGHT = 1e-4;

/**
 * Coming down, the view goes over from the one from space to the one from
 * the ground between these heights (Earth radii: about 60 km and 13 km).
 */
export const GROUND_FADE = { start: 0.01, full: 0.002 } as const;

/**
 * How far the view has gone over to the ground's, from 0 at or above the
 * first `GROUND_FADE` height to 1 at or below the second. `height` is above
 * the ground, in Earth radii.
 */
export function groundView(height: number): number {
  return (
    1 -
    Math.min(1, Math.max(0, (height - GROUND_FADE.full) / (GROUND_FADE.start - GROUND_FADE.full)))
  );
}

/** The field of view looking up, degrees: wide, as the sky is big. */
export const SKY_FOV = 70;
/** How far the wheel or a pinch can narrow or widen it. */
export const SKY_FOV_RANGE = [20, 100] as const;

/**
 * The field of view after zooming by `factor`: above 1 widens it, below 1
 * narrows it, within `SKY_FOV_RANGE`, or as narrow as `narrowest` if that is
 * given: with the view held on a planet there is something to close in on.
 * Multiplying rather than adding makes each step of the wheel, or each bit
 * of a pinch, feel the same at any zoom.
 */
export function zoomFov(fov: number, factor: number, narrowest: number = SKY_FOV_RANGE[0]): number {
  return Math.min(SKY_FOV_RANGE[1], Math.max(narrowest, fov * factor));
}

/**
 * A field of view part of the way from `from` to `to`, as it looks: halfway
 * is the view that is as many times narrower than one as it is wider than
 * the other. Going from the whole sky to a planet evenly in degrees would
 * spend the whole trip on the first hundredth of it.
 */
export function mixFov(from: number, to: number, share: number): number {
  return from * (to / from) ** share;
}

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
