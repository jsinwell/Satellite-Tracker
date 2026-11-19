import type { Rgb } from './atmosphere';

/**
 * The ground as it is drawn looking up from it: what the Earth's maps say is
 * there, lit by the Sun and the sky. The drawing is done on the GPU, in
 * `scene/landscapeGlsl.ts`; what can be worked out and tested apart from it is
 * here, and the two must stay in step.
 *
 * Colors here are linear light, as a shader reads them from a map, not the
 * numbers stored in the map's file.
 */

const fromFile = (level: number) => {
  const c = level / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** A color as an image file stores it, 0 to 255 a channel, as linear light. */
export function colorFromFile(red: number, green: number, blue: number): Rgb {
  return [fromFile(red), fromFile(green), fromFile(blue)];
}

/**
 * The day map paints all water one flat blue, seas and lakes alike, which is
 * what tells water from land: there is no separate map of it.
 */
export const MAP_WATER: Rgb = colorFromFile(30, 59, 115);
/**
 * How far from that blue a color can be and still be water, and how far
 * before it is surely land, with a shore between. Measured between square
 * roots, where the map's levels are evenly spaced.
 */
export const MAP_WATER_WITHIN = [0.085, 0.115] as const;

/**
 * Along a shore the map blends land into that blue, over 10 km or so, which
 * leaves the land there a gray-blue no ground is. Within this far of the
 * water's color (measured the same way), land is taken for sand instead, the
 * more so the nearer.
 */
export const SHORE = { within: 0.3, sand: [0.26, 0.22, 0.155] as Rgb } as const;

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** How much of a place is water, 0 to 1, from the day map's color there. */
export function waterShare(day: Rgb): number {
  return 1 - smoothstep(MAP_WATER_WITHIN[0], MAP_WATER_WITHIN[1], offWater(day));
}

/**
 * The map is a picture, brighter and more contrasty than the ground is: its
 * deserts would send back four fifths of the light and its forests almost
 * none. Scaled to what sand does send back, with a floor under the forests.
 */
export const LAND_ALBEDO = { scale: 0.42, floor: 0.025 } as const;

/** How far a color on the day map is from its water's, between square roots. */
function offWater(day: Rgb): number {
  return Math.hypot(
    Math.sqrt(day[0]) - Math.sqrt(MAP_WATER[0]),
    Math.sqrt(day[1]) - Math.sqrt(MAP_WATER[1]),
    Math.sqrt(day[2]) - Math.sqrt(MAP_WATER[2]),
  );
}

/** What land sends back of the light that falls on it, from the day map's color. */
export function landAlbedo(day: Rgb, out: Rgb): Rgb {
  const inland = smoothstep(MAP_WATER_WITHIN[1], SHORE.within, offWater(day));
  for (let c = 0; c < 3; c++) {
    const mapped = LAND_ALBEDO.floor + LAND_ALBEDO.scale * day[c];
    out[c] = SHORE.sand[c] + (mapped - SHORE.sand[c]) * inland;
  }
  return out;
}

/** Bare earth, for before the maps have loaded. */
export const BARE_GROUND: Rgb = [0.16, 0.14, 0.11];

/**
 * The sea: how rough it is, as the spread of its waves' slopes (about that
 * of a moderate breeze), and what the water itself sends back from below the
 * surface.
 */
export const SEA = {
  roughness: 0.14,
  /** How wide the Sun's glitter on it is: the square of the slopes' spread, twice. */
  glint: 0.04,
  color: [0.006, 0.028, 0.055] as Rgb,
} as const;

/**
 * How much of the sky the sea mirrors, by the cosine of the angle it is
 * looked at from straight above. A mirror-flat sea would reflect everything at
 * a glancing angle; waves tilt toward the eye, so a real one stops short of
 * half. The fit is Bruneton, Neyret and Holzschuch's (2010).
 */
export function seaReflectance(cosView: number, roughness: number = SEA.roughness): number {
  const c = Math.min(1, Math.max(0, cosView));
  return (
    0.02 + (0.98 * (1 - c) ** (5 * Math.exp(-2.69 * roughness))) / (1 + 22.7 * roughness ** 1.5)
  );
}

/** How far the Earth is from round: the square of its eccentricity (WGS 84). */
export const EARTH_ECCENTRICITY_SQUARED = 0.00669438;

/**
 * The latitude a map gives a place, radians, from the sine of the angle its
 * direction from the Earth's center makes with the equator. The two differ by
 * up to a fifth of a degree, since the Earth is flattened and a map's
 * latitude is measured square to the ground: about 20 km, which from the
 * ground is the difference between the beach and well out to sea.
 */
export function mapLatitude(sine: number): number {
  const s = Math.min(1, Math.max(-1, sine));
  return Math.atan2(s, (1 - EARTH_ECCENTRICITY_SQUARED) * Math.sqrt(1 - s * s));
}

/** The pattern of the ground repeats this far apart, km: it keeps the numbers small. */
export const GROUND_PERIOD_KM = 512;
const KM_PER_DEGREE = 111.2;

/**
 * Where a place is in the pattern the ground is drawn with, km east and
 * north: different from place to place, and the same each time for one.
 */
export function groundOrigin(
  latitudeDeg: number,
  longitudeDeg: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  const wrap = (km: number) => ((km % GROUND_PERIOD_KM) + GROUND_PERIOD_KM) % GROUND_PERIOD_KM;
  out.x = wrap(longitudeDeg * Math.cos((latitudeDeg * Math.PI) / 180) * KM_PER_DEGREE);
  out.y = wrap(latitudeDeg * KM_PER_DEGREE);
  return out;
}
