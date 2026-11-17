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
