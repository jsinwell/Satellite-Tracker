import { Matrix4, type Vector3 } from 'three';
import { EARTH_RADIUS_KM } from '../core/constants';
import type { Vec3 } from '../core/kinematics';

/**
 * Two coordinate systems meet in the scene:
 *
 * - Physics works in TEME, the inertial frame SGP4 outputs: kilometers,
 *   z through the north pole, x toward the vernal equinox.
 * - Three.js is y-up, and the camera works in Earth radii so that its
 *   distances and clip planes are small, well-conditioned numbers.
 *
 * Everything physical is drawn inside one group carrying the transform below,
 * so satellite buffers, orbit lines and the Earth are all authored in TEME
 * kilometers and nothing downstream has to think about the conversion.
 */
const KM_TO_SCENE = 1 / EARTH_RADIUS_KM;

/** Rotation taking z-up to y-up: (x, y, z) → (x, z, −y). */
export const TEME_GROUP_ROTATION = [-Math.PI / 2, 0, 0] as const;
export const TEME_GROUP_SCALE = KM_TO_SCENE;

export const WORLD_FROM_TEME = new Matrix4()
  .makeRotationX(TEME_GROUP_ROTATION[0])
  .multiply(new Matrix4().makeScale(KM_TO_SCENE, KM_TO_SCENE, KM_TO_SCENE));

export const TEME_FROM_WORLD = WORLD_FROM_TEME.clone().invert();

/**
 * SphereGeometry puts its poles on ±y and the center column of its texture on
 * +x. This rotation tips the poles onto ±z, leaving the texture's center on +x
 * and its right-hand side toward +y: the layout of an equirectangular map in
 * any z-up frame, whether Earth-fixed (longitude) or celestial (right ascension).
 */
export const SPHERE_POLES_TO_Z = [Math.PI / 2, 0, 0] as const;

/** Converts a TEME direction to a world direction, without scaling. */
export function directionToWorld(direction: Vec3, out: Vector3): Vector3 {
  return out.set(direction.x, direction.z, -direction.y);
}
