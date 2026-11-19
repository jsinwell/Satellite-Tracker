import { extrapolatePosition, hasState, isOccludedByEarth, type Vec3 } from './kinematics';

export interface PickQuery {
  /** State buffer, see `STATE_STRIDE`. */
  state: Float32Array;
  count: number;
  /** Seconds between the state buffer's instant and the instant being drawn. */
  dtSeconds: number;
  /** Non-zero where a satellite is currently drawn. */
  visible: Uint8Array;
  /**
   * Column-major 4×4 matrix taking TEME kilometers to clip space
   * (projection × view × model), as Three.js stores matrices.
   */
  clipFromTeme: ArrayLike<number>;
  /** Camera position in TEME kilometers. */
  eye: Vec3;
  /** Pointer position in CSS pixels, relative to the viewport's top-left. */
  pointer: { x: number; y: number };
  viewport: { width: number; height: number };
  /** Maximum distance from the pointer, in CSS pixels, that still counts as a hit. */
  radiusPx: number;
  /**
   * For when not every satellite is drawn where it is, as looking up at only
   * the ones that can be seen: whether the one at `index`, which is at
   * `position` (TEME km), is. Left out, they all are.
   */
  drawn?: (index: number, position: Vec3) => boolean;
}

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Returns the index of the drawn satellite nearest the pointer on screen, or
 * -1 if none is within `radiusPx`. Satellites hidden behind the Earth are
 * skipped, so the pick always matches what the user can see.
 *
 * A linear scan: projecting 20k points takes well under a millisecond, which
 * is cheaper than keeping any spatial index current while everything moves.
 */
export function pickSatellite(query: PickQuery): number {
  const { state, count, dtSeconds, visible, clipFromTeme: m, eye, pointer, viewport } = query;
  let best = -1;
  let bestDistanceSquared = query.radiusPx * query.radiusPx;

  for (let i = 0; i < count; i++) {
    if (visible[i] === 0 || !hasState(state, i)) continue;
    const p = extrapolatePosition(state, i, dtSeconds, scratch);

    const w = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (w <= 0) continue; // behind the camera
    const ndcX = (m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / w;
    const ndcY = (m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / w;

    const dx = (ndcX * 0.5 + 0.5) * viewport.width - pointer.x;
    const dy = (0.5 - ndcY * 0.5) * viewport.height - pointer.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared >= bestDistanceSquared) continue;
    // Checked last: they are the most expensive tests and rarely reached.
    if (isOccludedByEarth(eye, p)) continue;
    if (query.drawn && !query.drawn(i, p)) continue;

    best = i;
    bestDistanceSquared = distanceSquared;
  }
  return best;
}
