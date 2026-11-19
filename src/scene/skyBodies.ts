import { angularDiameter, BODY_SHAPES, type PlanetDisc, type SkyBody } from '../core/bodies';
import type { Vec3 } from '../core/kinematics';

/**
 * Where the Moon and the planets are this frame, written by whatever draws
 * them and read by what needs to find them again: the camera, to keep one in
 * view, and the pointer, to tell which one was clicked. It saves working the
 * positions out twice, and keeps the two in step with what is on screen.
 */
const positions = new Map<SkyBody, Vec3>();
let discs: readonly PlanetDisc[] = [];
let discsDrawn = false;

/** Records where `body` is: km from the Earth's center, in the TEME frame. */
export function placeBody(body: SkyBody, x: number, y: number, z: number): void {
  const at = positions.get(body);
  if (at) {
    at.x = x;
    at.y = y;
    at.z = z;
  } else {
    positions.set(body, { x, y, z });
  }
}

/** Where `body` was last recorded, or null if nothing has drawn it yet. */
export function bodyPosition(body: SkyBody): Vec3 | null {
  return positions.get(body) ?? null;
}

export interface BodySight {
  /** Unit vector toward it from the eye, TEME axes. */
  direction: Vec3;
  distanceKm: number;
  /** How wide it looks from there, radians. */
  diameter: number;
}

/**
 * How `body` looks from `eye` (km, TEME): which way, how far and how wide.
 * Null if nothing has drawn it yet.
 */
export function sightOf(body: SkyBody, eye: Vec3, out: BodySight): BodySight | null {
  const at = positions.get(body);
  if (!at) return null;
  const x = at.x - eye.x;
  const y = at.y - eye.y;
  const z = at.z - eye.z;
  const distance = Math.hypot(x, y, z);
  out.direction.x = x / distance;
  out.direction.y = y / distance;
  out.direction.z = z / distance;
  out.distanceKm = distance;
  out.diameter = angularDiameter(BODY_SHAPES[body].radiusKm, distance);
  return out;
}

export function createBodySight(): BodySight {
  return { direction: { x: 0, y: 0, z: 0 }, distanceKm: 0, diameter: 0 };
}

/** The planets as last worked out, for whatever draws their discs. */
export function latestDiscs(): readonly PlanetDisc[] {
  return discs;
}

export function setLatestDiscs(latest: readonly PlanetDisc[]): void {
  discs = latest;
}

/**
 * Whether the planets' discs are being drawn. Until their maps have loaded
 * they are not, and the points of light that stand for them stay, however
 * far in the view goes.
 */
export function areDiscsDrawn(): boolean {
  return discsDrawn;
}

export function setDiscsDrawn(drawn: boolean): void {
  discsDrawn = drawn;
}
