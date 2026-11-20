import { MS_PER_DAY } from './constants';
import { goodForSpotting, type Observer, sunElevationAt, type ViewingWindow } from './observer';

/**
 * One night, whole: the 24 hours from one noon to the next where the observer
 * is, so that the afternoon, the night and the morning after are side by
 * side with the night in the middle, and not cut in two at midnight the way
 * a calendar day cuts it.
 */
export interface Night {
  startMs: number;
  endMs: number;
  /**
   * How high the Sun is, degrees, at instants `NIGHT_STEP_MS` apart from the
   * start to the end, both included.
   */
  sunElevations: Float32Array;
  /**
   * The stretches of it that are good for spotting satellites, earliest
   * first; see `goodForSpotting`. Usually two, after dusk and before dawn.
   */
  windows: ViewingWindow[];
}

/** How far apart the Sun's height is sampled: fine enough for twilight, which takes half an hour at its quickest. */
export const NIGHT_STEP_MS = 600_000;
/** The edges of the good stretches are found to within this. */
const EDGE_TOLERANCE_MS = 30_000;

/**
 * The noon that starts the night holding `timeMs`, at `longitudeDeg`. Noon by
 * the Sun there, on average, and not by any clock: it depends on nothing but
 * where the place is, so the night sits in the middle wherever that is and
 * whatever time zone the viewer keeps.
 */
export function nightStart(longitudeDeg: number, timeMs: number): number {
  // Solar time runs ahead of UTC by four minutes for every degree east. In
  // whole milliseconds, so that the start of a night is itself in that night
  // exactly, and not a rounding error short of it.
  const ahead = Math.round((longitudeDeg / 360) * MS_PER_DAY);
  const noon = MS_PER_DAY / 2;
  return Math.floor((timeMs + ahead - noon) / MS_PER_DAY) * MS_PER_DAY + noon - ahead;
}

/** The night that holds `timeMs`, for `observer`. */
export function nightOf(observer: Observer, timeMs: number): Night {
  const startMs = nightStart(observer.longitude, timeMs);
  const endMs = startMs + MS_PER_DAY;
  const count = MS_PER_DAY / NIGHT_STEP_MS + 1;
  const sunElevations = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    sunElevations[i] = sunElevationAt(observer, startMs + i * NIGHT_STEP_MS);
  }

  /** The instant between two samples where the sky turns good or stops being. */
  const edge = (before: number, after: number): number => {
    const wanted = goodForSpotting(sunElevationAt(observer, after));
    let low = before;
    let high = after;
    while (high - low > EDGE_TOLERANCE_MS) {
      const middle = (low + high) / 2;
      if (goodForSpotting(sunElevationAt(observer, middle)) === wanted) high = middle;
      else low = middle;
    }
    return high;
  };

  const windows: ViewingWindow[] = [];
  // One that is already under way at the start begins there, and one still
  // going at the end stops there: near the poles in winter the sky can be
  // good straight through noon.
  let from = goodForSpotting(sunElevations[0]) ? startMs : Number.NaN;
  for (let i = 1; i < count; i++) {
    const at = startMs + i * NIGHT_STEP_MS;
    const good = goodForSpotting(sunElevations[i]);
    if (Number.isNaN(from)) {
      if (good) from = edge(at - NIGHT_STEP_MS, at);
    } else if (!good) {
      windows.push({ startMs: from, endMs: edge(at - NIGHT_STEP_MS, at) });
      from = Number.NaN;
    }
  }
  if (!Number.isNaN(from)) windows.push({ startMs: from, endMs });

  return { startMs, endMs, sunElevations, windows };
}

/**
 * How light the sky is with the Sun at `sunElevationDeg`: 0 in full night, 1
 * in full day. For shading, so it follows how the sky looks and not how much
 * light there is, which changes a millionfold: most of the change is put in
 * twilight, where the eye sees most of it happen.
 */
export function daylight(sunElevationDeg: number): number {
  const points = [
    [-18, 0],
    [-6, 0.3],
    [0, 0.75],
    [8, 1],
  ] as const;
  if (sunElevationDeg <= points[0][0]) return 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (sunElevationDeg <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((sunElevationDeg - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}
