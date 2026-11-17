import type { Camera, Vector3 } from 'three';

/**
 * The scene's few text labels are HTML rather than text drawn in WebGL, which
 * would be blurry at small sizes. They live in a layer the app lays over the
 * canvas and registers here; the scene places them itself every frame, as it
 * draws, without going through React.
 */
let layer: HTMLElement | null = null;

/** Called by the app with the layer element, and with null when it goes. */
export function setLabelLayer(element: HTMLElement | null): void {
  layer = element;
}

export function labelLayer(): HTMLElement | null {
  return layer;
}

/**
 * Where a point on the globe (world coordinates) is on the screen, in CSS
 * pixels from the top left, or null if the Earth hides it or it is off
 * screen. Moves `point` to normalized device coordinates in the process.
 * The camera's world matrices must be up to date.
 */
export function screenPosition(
  point: Vector3,
  camera: Camera,
  width: number,
  height: number,
): { x: number; y: number } | null {
  // On the far side of the Earth if the camera is below its local horizon:
  // the line of sight from the point to the camera heads into the ground.
  const { x, y, z } = camera.position;
  if ((x - point.x) * point.x + (y - point.y) * point.y + (z - point.z) * point.z <= 0) {
    return null;
  }
  point.project(camera);
  if (point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
}
