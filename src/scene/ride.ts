const MIN_ELEVATION = 0.1;
/** Short of straight down, where "ahead" stops meaning anything on screen. */
const MAX_ELEVATION = 1.45;

/**
 * Where to put the camera when it starts riding along with a satellite.
 *
 * The camera sits behind the satellite, `distance` from it, raised by the
 * angle this returns (radians above the satellite's local horizontal) and
 * looking at the satellite. The angle is chosen so that the Earth's limb
 * crosses the view `margin` radians above the satellite: the ground fills the
 * lower part of the picture with the horizon ahead, whatever the altitude.
 * Close to the Earth that is a shallow look forward; far out it is nearly
 * straight down, since nothing else would keep the Earth in the picture.
 *
 * `radius` is the satellite's distance from the Earth's center. Lengths are
 * in Earth radii.
 */
export function rideElevation(radius: number, distance: number, margin: number): number {
  /** How far below the limb the satellite appears from this elevation, less `margin`. */
  const excess = (elevation: number) => {
    const back = distance * Math.cos(elevation);
    const height = radius + distance * Math.sin(elevation);
    const cameraRadius = Math.hypot(back, height);
    // Angles at the camera, measured from straight down.
    const toSatellite = Math.acos((distance + radius * Math.sin(elevation)) / cameraRadius);
    const toLimb = Math.asin(1 / cameraRadius);
    return toLimb - toSatellite - margin;
  };

  let low = MIN_ELEVATION;
  let high = MAX_ELEVATION;
  if (excess(low) >= 0) return low;
  if (excess(high) <= 0) return high;
  // The satellite sinks below the limb steadily as the camera rises: bisect.
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (excess(middle) < 0) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
