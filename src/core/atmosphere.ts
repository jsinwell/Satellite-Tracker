import { EARTH_RADIUS_KM } from './constants';
import type { Vec3 } from './kinematics';

/**
 * The color of the sky, worked out the way the real one comes about: sunlight
 * scattered toward the eye by the air along each line of sight.
 *
 * - Air molecules scatter blue light far more than red (Rayleigh scattering).
 *   That makes the sky blue, and the Sun yellow and then red as its light
 *   comes through more and more air toward the horizon.
 * - Haze scatters all colors alike and mostly forward (Mie scattering), which
 *   whitens the horizon and brightens the sky around the Sun.
 * - Ozone, high up, absorbs orange light. It matters little by day, but after
 *   sunset the light has crossed so much of it that the sky overhead turns a
 *   deep blue: the blue hour.
 * - Light scattered once is scattered again. Around sunset, and in the Earth's
 *   shadow after it, most of the sky's light has been scattered several times.
 *
 * This is the model of Hillaire, "A Scalable and Production Ready Sky and
 * Atmosphere Rendering Technique" (2020), with the tables laid out as in
 * Bruneton and Neyret, "Precomputed Atmospheric Scattering" (2008), and their
 * coefficients for a clear day. Two small tables are worked out once: how much
 * light gets through the atmosphere along any line, and how much light that
 * has been scattered more than once is about at any height. With those, the
 * light from any direction takes a couple of dozen steps along it.
 *
 * The same sums run on the GPU for every pixel of the sky, in
 * `scene/atmosphereGlsl.ts`; the two must be kept in step. Here they are
 * tested, build the tables, and meter the sky to set the exposure.
 *
 * Distances are in km, from the Earth's center. Light is relative to
 * sunlight: the Sun delivers 1 above the atmosphere, in each of red, green
 * and blue.
 */
export const ATMOSPHERE = {
  bottomKm: EARTH_RADIUS_KM,
  /** Above this there is too little air to matter. */
  topKm: EARTH_RADIUS_KM + 100,
  /** Scattering by air at sea level, per km, for red, green and blue light. */
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  /** Air thins by a factor of e every this many km up. */
  rayleighHeightKm: 8,
  /** Scattering and absorption by haze at sea level, per km. */
  mieScattering: 3.996e-3,
  mieAbsorption: 0.444e-3,
  mieHeightKm: 1.2,
  /** How strongly haze favors scattering forward, from 0 (evenly) toward 1. */
  mieForward: 0.8,
  /**
   * Absorption by ozone where it is densest, per km. The red is three times
   * the usual figure, which is for light of 680 nm: a screen's red is nearer
   * 610 nm, in the middle of the band ozone absorbs. By day it makes no
   * difference to speak of. In twilight it is what keeps the sky overhead
   * blue, where the lower figure turns it mauve.
   */
  ozone: [2.0e-3, 1.881e-3, 0.085e-3],
  /** Ozone is densest at this height, thinning evenly to nothing this far above and below. */
  ozoneCenterKm: 25,
  ozoneHalfWidthKm: 15,
  /** How much light the ground sends back up, on average. */
  groundAlbedo: 0.3,
} as const;

export type Rgb = [number, number, number];

/** Both tables hold red, green, blue and a spare, row by row, as a texture does. */
export const TRANSMITTANCE_SIZE = { width: 256, height: 64 } as const;
export const MULTISCATTER_SIZE = { width: 64, height: 32 } as const;
/**
 * The second table runs from the Sun this far below level (as the cosine of
 * its angle from straight up; about 24° down) to overhead. Any lower and the
 * whole atmosphere above a place is in the Earth's shadow.
 */
export const MULTISCATTER_MIN_SUN = -0.4;
/**
 * Steps along a line of sight. Enough that the sky comes out smooth with
 * every line sampled at the same places, with no need to shuffle them.
 */
export const SKY_STEPS = 24;
/**
 * And for the Moon's light in the sky at night, which is marched as well:
 * fewer. It is a few hundred thousand times fainter and has no sunset in
 * it, nothing bright and fine for coarse steps to get wrong, and each step
 * is paid for on every pixel of the sky's map, every frame.
 */
export const MOON_SKY_STEPS = 8;
/** How far along each step the air is sampled: early, as it thins along most lines. */
export const SKY_STEP_OFFSET = 0.3;
/** The Sun's radius in the sky, radians: it sets over this far either side of the horizon. */
export const SUN_ANGULAR_RADIUS = 0.00465;

/**
 * Stepping along every line of sight on the screen is too much work for a
 * modest graphics card. The sky is smooth, so it is worked out along far
 * fewer lines, as a map of every direction from the camera, and the screen is
 * drawn from the map: `width` directions round the compass, by `below` rows
 * from straight down up to the horizon and `above` rows on from it.
 *
 * The rows are closest together at the horizon, where the sky changes
 * fastest, and none straddles it: a line that just clears the ground and one
 * that just meets it see quite different amounts of air. From out in space the
 * rows above the horizon stop where the air does, so that all of them fall
 * across the thin blue rim.
 */
export const SKY_VIEW = { width: 256, above: 96, below: 64 } as const;

/** The angle from straight up at which the ground's horizon is seen, `r` km from the center. */
export function skyViewHorizon(r: number): number {
  return Math.PI - Math.asin(Math.min(1, ATMOSPHERE.bottomKm / r));
}

/** How far above that horizon there is any air to look through, radians. */
export function skyViewReach(r: number): number {
  if (r < ATMOSPHERE.topKm) return skyViewHorizon(r);
  return Math.asin(ATMOSPHERE.topKm / r) - Math.asin(ATMOSPHERE.bottomKm / r);
}

/**
 * The row of the map for a line of sight `angle` radians from straight up,
 * which meets the ground or does not. Whole numbers are the rows themselves;
 * between them, the two either side are blended.
 */
export function skyViewRow(angle: number, ground: boolean, r: number): number {
  const horizon = skyViewHorizon(r);
  if (ground) {
    const past = clamp01((angle - horizon) / (Math.PI - horizon));
    return (SKY_VIEW.below - 1) * (1 - Math.sqrt(past));
  }
  const clear = clamp01((horizon - angle) / skyViewReach(r));
  return SKY_VIEW.below + (SKY_VIEW.above - 1) * Math.sqrt(clear);
}

/** The angle from straight up that a row of the map is for: `skyViewRow` backward. */
export function skyViewAngle(row: number, r: number): number {
  const horizon = skyViewHorizon(r);
  if (row < SKY_VIEW.below) {
    const past = 1 - row / (SKY_VIEW.below - 1);
    return horizon + past * past * (Math.PI - horizon);
  }
  const clear = (row - SKY_VIEW.below) / (SKY_VIEW.above - 1);
  return horizon - clear * clear * skyViewReach(r);
}
/**
 * In the Moon's shadow, light scattered more than once still arrives from the
 * sunlit air around it. This much of it, where the Sun is wholly hidden.
 */
export const ECLIPSE_SKYLIGHT = 0.006;

export interface AtmosphereTables {
  /**
   * How much light gets through from a point to the top of the atmosphere,
   * by height (rows) and direction (columns, from level with the horizon to
   * straight up).
   */
  transmittance: Float32Array;
  /**
   * Light that has been scattered more than once, arriving from all round at
   * a point, by height (rows) and the Sun's height in the sky (columns).
   */
  multiscatter: Float32Array;
}

const { bottomKm: BOTTOM, topKm: TOP } = ATMOSPHERE;
/** From the ground at the horizon to the top of the atmosphere. */
const HORIZON_REACH = Math.sqrt(TOP * TOP - BOTTOM * BOTTOM);
const MIE_EXTINCTION = ATMOSPHERE.mieScattering + ATMOSPHERE.mieAbsorption;
const LUMINANCE: Rgb = [0.2126, 0.7152, 0.0722];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How bright a color looks. */
export function luminance(color: Readonly<Rgb>): number {
  return color[0] * LUMINANCE[0] + color[1] * LUMINANCE[1] + color[2] * LUMINANCE[2];
}

/**
 * How the eye sees light as faint as the Moon's: mostly with the cells that
 * tell no colors apart, and that answer best to blue-green. So a moonlit
 * night is silver-blue, though the light itself is a little warmer than the
 * Sun's, and a Moon on the horizon does not set the sky on fire as the Sun
 * does, though its light is reddened just the same. `colorless` is how much
 * of the color goes, and `tint` what is seen in its place: as bright, by
 * `luminance`, as the light was.
 */
export const NIGHT_VISION = { colorless: 0.85, tint: [0.62, 1.0, 2.12] } as const;

/** `light`, in place, as it looks by night: see `NIGHT_VISION`. */
export function seenByNight(light: Rgb): Rgb {
  const gray = luminance(light);
  for (let c = 0; c < 3; c++) {
    light[c] += NIGHT_VISION.colorless * (gray * NIGHT_VISION.tint[c] - light[c]);
  }
  return light;
}

const ozoneDensity = (height: number) =>
  Math.max(0, 1 - Math.abs(height - ATMOSPHERE.ozoneCenterKm) / ATMOSPHERE.ozoneHalfWidthKm);

/** How far it is to the top of the atmosphere from `r` in the direction `mu` (cosine from straight up). */
function distanceToTop(r: number, mu: number): number {
  return Math.max(0, -r * mu + Math.sqrt(Math.max(0, r * r * (mu * mu - 1) + TOP * TOP)));
}

/** The cosine, from straight up, of the direction of the horizon at `r`. */
function horizonCosine(r: number): number {
  return -Math.sqrt(Math.max(0, 1 - (BOTTOM * BOTTOM) / (r * r)));
}

/** Reads a table between its entries; `x` and `y` run from 0 to 1 across it. */
function sample(
  table: Float32Array,
  size: { width: number; height: number },
  x: number,
  y: number,
  out: Rgb,
): Rgb {
  const fx = clamp01(x) * (size.width - 1);
  const fy = clamp01(y) * (size.height - 1);
  const x0 = Math.min(size.width - 2, Math.floor(fx));
  const y0 = Math.min(size.height - 2, Math.floor(fy));
  const tx = fx - x0;
  const ty = fy - y0;
  const a = (y0 * size.width + x0) * 4;
  const b = a + size.width * 4;
  for (let c = 0; c < 3; c++) {
    const top = table[a + c] + (table[a + 4 + c] - table[a + c]) * tx;
    const bottom = table[b + c] + (table[b + 4 + c] - table[b + c]) * tx;
    out[c] = top + (bottom - top) * ty;
  }
  return out;
}

/**
 * How much light gets through from height `r` to the top of the atmosphere
 * along the direction `mu` (cosine from straight up), which must not run into
 * the ground. Integrated directly: what the first table is filled with.
 */
export function integrateTransmittance(r: number, mu: number, out: Rgb): Rgb {
  // Simpson's rule: the air thins smoothly along the line.
  const intervals = 64;
  const step = distanceToTop(r, mu) / intervals;
  let air = 0;
  let haze = 0;
  let ozone = 0;
  for (let i = 0; i <= intervals; i++) {
    const t = i * step;
    const height = Math.max(0, Math.sqrt(r * r + t * t + 2 * r * mu * t) - BOTTOM);
    const weight = i === 0 || i === intervals ? 1 : i % 2 === 1 ? 4 : 2;
    air += weight * Math.exp(-height / ATMOSPHERE.rayleighHeightKm);
    haze += weight * Math.exp(-height / ATMOSPHERE.mieHeightKm);
    ozone += weight * ozoneDensity(height);
  }
  for (let c = 0; c < 3; c++) {
    const depth =
      (ATMOSPHERE.rayleigh[c] * air + MIE_EXTINCTION * haze + ATMOSPHERE.ozone[c] * ozone) *
      (step / 3);
    out[c] = Math.exp(-depth);
  }
  return out;
}

function buildTransmittance(): Float32Array {
  const { width, height } = TRANSMITTANCE_SIZE;
  const table = new Float32Array(width * height * 4);
  const through: Rgb = [0, 0, 0];
  for (let j = 0; j < height; j++) {
    // Rows by how far the horizon is, which spaces them closer near the ground.
    const rho = (HORIZON_REACH * j) / (height - 1);
    const r = Math.sqrt(rho * rho + BOTTOM * BOTTOM);
    const nearest = TOP - r;
    const farthest = rho + HORIZON_REACH;
    for (let i = 0; i < width; i++) {
      // Columns by the distance to the top, from straight up to the horizon.
      const d = nearest + ((farthest - nearest) * i) / (width - 1);
      const mu =
        d === 0
          ? 1
          : Math.min(
              1,
              Math.max(-1, (HORIZON_REACH * HORIZON_REACH - rho * rho - d * d) / (2 * r * d)),
            );
      integrateTransmittance(r, mu, through);
      table.set(through, (j * width + i) * 4);
      table[(j * width + i) * 4 + 3] = 1;
    }
  }
  return table;
}

/**
 * How much light gets through from height `r` to the top of the atmosphere
 * along the direction `mu`, read from the table. For directions below the
 * horizon it gives the horizon's.
 */
export function transmittanceToTop(tables: AtmosphereTables, r: number, mu: number, out: Rgb): Rgb {
  const radius = Math.min(TOP, Math.max(BOTTOM, r));
  const rho = Math.sqrt(Math.max(0, radius * radius - BOTTOM * BOTTOM));
  const nearest = TOP - radius;
  const farthest = rho + HORIZON_REACH;
  return sample(
    tables.transmittance,
    TRANSMITTANCE_SIZE,
    (distanceToTop(radius, mu) - nearest) / (farthest - nearest),
    rho / HORIZON_REACH,
    out,
  );
}

/**
 * How much of the Sun's light reaches height `r`, where the Sun stands at
 * `mu`. None behind the Earth, and a share while the Earth's edge crosses it.
 */
function sunlightAt(tables: AtmosphereTables, r: number, mu: number, out: Rgb): Rgb {
  const horizon = horizonCosine(r);
  // Near the horizon a cosine changes as fast as the angle does.
  const x = clamp01((mu - horizon) / (2 * SUN_ANGULAR_RADIUS) + 0.5);
  const clear = x * x * (3 - 2 * x);
  if (clear === 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  transmittanceToTop(tables, r, Math.max(mu, horizon), out);
  out[0] *= clear;
  out[1] *= clear;
  out[2] *= clear;
  return out;
}

function multiscatterAt(tables: AtmosphereTables, r: number, mu: number, out: Rgb): Rgb {
  return sample(
    tables.multiscatter,
    MULTISCATTER_SIZE,
    (mu - MULTISCATTER_MIN_SUN) / (1 - MULTISCATTER_MIN_SUN),
    (r - BOTTOM) / (TOP - BOTTOM),
    out,
  );
}

interface Span {
  /** Where along the line the atmosphere starts and ends, km. */
  start: number;
  end: number;
  /** Whether it ends on the ground rather than out the top. */
  ground: boolean;
}

/** The part of the line from `origin` along `direction` that is in the atmosphere, if any. */
function spanOf(origin: Vec3, direction: Vec3, out: Span): boolean {
  const r = Math.hypot(origin.x, origin.y, origin.z);
  const b = origin.x * direction.x + origin.y * direction.y + origin.z * direction.z;
  const top = b * b - (r - TOP) * (r + TOP);
  if (top <= 0) return false;
  out.end = -b + Math.sqrt(top);
  if (out.end <= 0) return false;
  out.start = Math.max(0, -b - Math.sqrt(top));
  const ground = b * b - (r - BOTTOM) * (r + BOTTOM);
  out.ground = ground > 0 && b < 0;
  if (out.ground) out.end = Math.max(out.start, -b - Math.sqrt(ground));
  return true;
}

/** How much of the Sun is left showing at a point: 1 normally, less in the Moon's shadow. */
export type SunLeft = (point: Vec3) => number;

interface Marched {
  /** The light scattered toward the start of the line. */
  light: Rgb;
  /** How much of what lies beyond the end of the line gets through. */
  through: Rgb;
  /** For the second table: how much light the line would gather from air glowing evenly. */
  gathered: Rgb;
}

const marched: Marched = { light: [0, 0, 0], through: [1, 1, 1], gathered: [0, 0, 0] };
const sunlight: Rgb = [0, 0, 0];
const again: Rgb = [0, 0, 0];
const point: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Adds up the light scattered toward `origin` from the air between `start`
 * and `end` along `direction`. With no second table yet (`tables.multiscatter`
 * empty) it counts light scattered once only, evenly in all directions: what
 * the second table is built from.
 */
function march(
  tables: AtmosphereTables,
  origin: Vec3,
  direction: Vec3,
  sun: Vec3,
  start: number,
  end: number,
  steps: number,
  sunLeft: SunLeft | undefined,
): Marched {
  const { light, through, gathered } = marched;
  light.fill(0);
  gathered.fill(0);
  through.fill(1);
  const building = tables.multiscatter.length === 0;
  const span = end - start;
  // Near the ground the air is thickest close by, so the steps start short.
  // From space a line crosses the atmosphere evenly.
  const r0 = Math.hypot(origin.x, origin.y, origin.z);
  const bunching = building ? 0 : clamp01(1 - (r0 - BOTTOM) / (TOP - BOTTOM));
  const place = (x: number) => x + bunching * (x * x - x);

  const cosine = direction.x * sun.x + direction.y * sun.y + direction.z * sun.z;
  const g = ATMOSPHERE.mieForward;
  const even = 1 / (4 * Math.PI);
  const airPhase = building ? even : (3 / (16 * Math.PI)) * (1 + cosine * cosine);
  const hazePhase = building
    ? even
    : ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + cosine * cosine))) /
      ((2 + g * g) * (1 + g * g - 2 * g * cosine) ** 1.5);

  for (let i = 0; i < steps; i++) {
    const from = span * place(i / steps);
    const length = span * place((i + 1) / steps) - from;
    const t = start + from + SKY_STEP_OFFSET * length;
    point.x = origin.x + direction.x * t;
    point.y = origin.y + direction.y * t;
    point.z = origin.z + direction.z * t;
    const r = Math.max(BOTTOM, Math.hypot(point.x, point.y, point.z));
    const height = r - BOTTOM;
    const air = Math.exp(-height / ATMOSPHERE.rayleighHeightKm);
    const haze = Math.exp(-height / ATMOSPHERE.mieHeightKm);
    const ozone = ozoneDensity(height);
    const sunHeight = (point.x * sun.x + point.y * sun.y + point.z * sun.z) / r;
    const left = sunLeft ? sunLeft(point) : 1;
    sunlightAt(tables, r, sunHeight, sunlight);
    if (!building) multiscatterAt(tables, r, sunHeight, again);
    const skylight = ECLIPSE_SKYLIGHT + (1 - ECLIPSE_SKYLIGHT) * left;
    for (let c = 0; c < 3; c++) {
      const airScatter = ATMOSPHERE.rayleigh[c] * air;
      const hazeScatter = ATMOSPHERE.mieScattering * haze;
      const extinction = airScatter + MIE_EXTINCTION * haze + ATMOSPHERE.ozone[c] * ozone;
      const kept = Math.exp(-extinction * length);
      // The light a stretch of air sends on, given how it dims along the stretch.
      const sent = (through[c] * (1 - kept)) / Math.max(extinction, 1e-12);
      let source = (airScatter * airPhase + hazeScatter * hazePhase) * sunlight[c] * left;
      if (!building) source += (airScatter + hazeScatter) * again[c] * skylight;
      light[c] += source * sent;
      gathered[c] += (airScatter + hazeScatter) * sent;
      through[c] *= kept;
    }
  }
  return marched;
}

function buildMultiscatter(tables: AtmosphereTables): Float32Array {
  const { width, height } = MULTISCATTER_SIZE;
  const table = new Float32Array(width * height * 4);
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const direction: Vec3 = { x: 0, y: 0, z: 0 };
  const sun: Vec3 = { x: 0, y: 0, z: 0 };
  const span: Span = { start: 0, end: 0, ground: false };
  const second: Rgb = [0, 0, 0];
  const share: Rgb = [0, 0, 0];
  const onGround: Rgb = [0, 0, 0];
  // Directions spread evenly over the sphere. The Sun is in the plane y = 0,
  // so the half with y > 0 mirrors the other and stands for both.
  const rings = 8;
  const perRing = 4;
  const steps = 20;

  for (let j = 0; j < height; j++) {
    origin.z = BOTTOM + ((TOP - BOTTOM) * j) / (height - 1);
    for (let i = 0; i < width; i++) {
      const sunHeight = MULTISCATTER_MIN_SUN + ((1 - MULTISCATTER_MIN_SUN) * i) / (width - 1);
      sun.x = Math.sqrt(1 - sunHeight * sunHeight);
      sun.z = sunHeight;
      second.fill(0);
      share.fill(0);
      for (let a = 0; a < rings; a++) {
        const up = 1 - (2 * (a + 0.5)) / rings;
        const level = Math.sqrt(1 - up * up);
        for (let b = 0; b < perRing; b++) {
          const turn = (Math.PI * (b + 0.5)) / perRing;
          direction.x = level * Math.cos(turn);
          direction.y = level * Math.sin(turn);
          direction.z = up;
          if (!spanOf(origin, direction, span)) continue;
          const { light, through, gathered } = march(
            tables,
            origin,
            direction,
            sun,
            span.start,
            span.end,
            steps,
            undefined,
          );
          for (let c = 0; c < 3; c++) {
            second[c] += light[c];
            share[c] += gathered[c];
          }
          if (span.ground) {
            // Sunlight the ground sends back up the line.
            const x = origin.x + direction.x * span.end;
            const z = origin.z + direction.z * span.end;
            const facing = Math.max(0, (x * sun.x + z * sun.z) / BOTTOM);
            sunlightAt(tables, BOTTOM, facing, onGround);
            for (let c = 0; c < 3; c++) {
              second[c] += (through[c] * onGround[c] * facing * ATMOSPHERE.groundAlbedo) / Math.PI;
            }
          }
        }
      }
      const directions = rings * perRing;
      for (let c = 0; c < 3; c++) {
        // Light scattered twice, and the share of it scattered on each further
        // time: a series that sums to this.
        table[(j * width + i) * 4 + c] = second[c] / directions / (1 - share[c] / directions);
      }
      table[(j * width + i) * 4 + 3] = 1;
    }
  }
  return table;
}

let built: AtmosphereTables | undefined;

/** The two tables, worked out the first time they are asked for: about a tenth of a second. */
export function atmosphereTables(): AtmosphereTables {
  if (!built) {
    const tables: AtmosphereTables = {
      transmittance: buildTransmittance(),
      multiscatter: new Float32Array(0),
    };
    tables.multiscatter = buildMultiscatter(tables);
    built = tables;
  }
  return built;
}

const span: Span = { start: 0, end: 0, ground: false };

/**
 * The light of the sky arriving at `eye` from `direction` (a unit vector),
 * with the Sun in the direction `sun`, into `out`. If the line of sight ends
 * on the ground, this is the light of the air in front of it. In `steps`
 * steps along the line of sight: `SKY_STEPS` unless told otherwise.
 */
export function skyLight(
  tables: AtmosphereTables,
  eye: Vec3,
  direction: Vec3,
  sun: Vec3,
  out: Rgb,
  sunLeft?: SunLeft,
  steps: number = SKY_STEPS,
): Rgb {
  if (!spanOf(eye, direction, span)) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const { light } = march(tables, eye, direction, sun, span.start, span.end, steps, sunLeft);
  out[0] = light[0];
  out[1] = light[1];
  out[2] = light[2];
  return out;
}

const entry: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * How much light from beyond the atmosphere reaches `eye` along `direction`:
 * 1 in space looking away from the Earth, less through air, none through the
 * ground.
 */
export function transmittanceToSpace(
  tables: AtmosphereTables,
  eye: Vec3,
  direction: Vec3,
  out: Rgb,
): Rgb {
  if (!spanOf(eye, direction, span)) {
    out[0] = out[1] = out[2] = 1;
    return out;
  }
  if (span.ground) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  // From where the line enters the atmosphere, or from the eye if inside it.
  entry.x = eye.x + direction.x * span.start;
  entry.y = eye.y + direction.y * span.start;
  entry.z = eye.z + direction.z * span.start;
  const r = Math.hypot(entry.x, entry.y, entry.z);
  const mu = (entry.x * direction.x + entry.y * direction.y + entry.z * direction.z) / r;
  return transmittanceToTop(tables, r, mu, out);
}

const side: Vec3 = { x: 0, y: 0, z: 0 };
const over: Vec3 = { x: 0, y: 0, z: 0 };
const toward: Vec3 = { x: 0, y: 0, z: 0 };
const part: Rgb = [0, 0, 0];

/** Fills `side` and `over` with two unit vectors square to `axis` and to each other. */
function squareTo(axis: Vec3): void {
  // Start from whichever axis is least along it.
  const ax = Math.abs(axis.x);
  const ay = Math.abs(axis.y);
  const az = Math.abs(axis.z);
  const ex = ax <= ay && ax <= az ? 1 : 0;
  const ey = ex === 0 && ay <= az ? 1 : 0;
  const ez = ex === 0 && ey === 0 ? 1 : 0;
  side.x = axis.y * ez - axis.z * ey;
  side.y = axis.z * ex - axis.x * ez;
  side.z = axis.x * ey - axis.y * ex;
  const length = Math.hypot(side.x, side.y, side.z);
  side.x /= length;
  side.y /= length;
  side.z /= length;
  over.x = axis.y * side.z - axis.z * side.y;
  over.y = axis.z * side.x - axis.x * side.z;
  over.z = axis.x * side.y - axis.y * side.x;
}

/** Points on a disc of radius 1: its center and six around it, each standing for an equal share. */
const DISC_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  ...Array.from({ length: 6 }, (_, i): [number, number] => {
    const angle = (i * Math.PI) / 3;
    return [0.67 * Math.cos(angle), 0.67 * Math.sin(angle)];
  }),
];

/**
 * How much of the Sun's light reaches `eye`, averaged over its disc (of
 * angular radius `radius`, radians, around the unit direction `sun`): its
 * color through the air, and nothing once the Earth is in the way.
 */
export function sunlightReaching(
  tables: AtmosphereTables,
  eye: Vec3,
  sun: Vec3,
  radius: number,
  out: Rgb,
): Rgb {
  squareTo(sun);
  out[0] = out[1] = out[2] = 0;
  for (const [u, v] of DISC_POINTS) {
    toward.x = sun.x + radius * (u * side.x + v * over.x);
    toward.y = sun.y + radius * (u * side.y + v * over.y);
    toward.z = sun.z + radius * (u * side.z + v * over.z);
    const length = Math.hypot(toward.x, toward.y, toward.z);
    toward.x /= length;
    toward.y /= length;
    toward.z /= length;
    transmittanceToSpace(tables, eye, toward, part);
    for (let c = 0; c < 3; c++) out[c] += part[c] / DISC_POINTS.length;
  }
  return out;
}

const up: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The light of the sky at `eye`, averaged over it: straight up and four ways
 * round at 45°. It is what the ground is lit by when the Sun is not on it,
 * and its brightness is what an eye there would be used to.
 */
export function meterSky(
  tables: AtmosphereTables,
  eye: Vec3,
  sun: Vec3,
  out: Rgb,
  sunLeft?: SunLeft,
): Rgb {
  const r = Math.hypot(eye.x, eye.y, eye.z);
  up.x = eye.x / r;
  up.y = eye.y / r;
  up.z = eye.z / r;
  squareTo(up);
  out[0] = out[1] = out[2] = 0;
  const slant = Math.SQRT1_2;
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI) / 2;
    const across = i === 4 ? 0 : slant;
    const rise = i === 4 ? 1 : slant;
    toward.x = rise * up.x + across * (Math.cos(angle) * side.x + Math.sin(angle) * over.x);
    toward.y = rise * up.y + across * (Math.cos(angle) * side.y + Math.sin(angle) * over.y);
    toward.z = rise * up.z + across * (Math.cos(angle) * side.z + Math.sin(angle) * over.z);
    skyLight(tables, eye, toward, sun, part, sunLeft);
    for (let c = 0; c < 3; c++) out[c] += part[c] / 5;
  }
  return out;
}

/** How far round the middle of the view its brightness is taken, radians. */
const VIEW_SPREAD = 25 * (Math.PI / 180);
/** Lines of sight are kept this far above level, as a sine: the ground is not the sky. */
const VIEW_FLOOR = Math.sin(2 * (Math.PI / 180));

/**
 * How bright the sky is where the eye is looking: along `direction` (a unit
 * vector) and six ways round it, averaged by ratio, as brightness is judged.
 * Lower toward the zenith, higher toward the horizon, and far higher toward a
 * low Sun.
 */
export function meterView(
  tables: AtmosphereTables,
  eye: Vec3,
  sun: Vec3,
  direction: Vec3,
  sunLeft?: SunLeft,
): number {
  const r = Math.hypot(eye.x, eye.y, eye.z);
  up.x = eye.x / r;
  up.y = eye.y / r;
  up.z = eye.z / r;
  squareTo(direction);
  const along = Math.cos(VIEW_SPREAD);
  const across = Math.sin(VIEW_SPREAD);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const angle = (i * Math.PI) / 3;
    const a = i === 6 ? 1 : along;
    const b = i === 6 ? 0 : across;
    toward.x = a * direction.x + b * (Math.cos(angle) * side.x + Math.sin(angle) * over.x);
    toward.y = a * direction.y + b * (Math.cos(angle) * side.y + Math.sin(angle) * over.y);
    toward.z = a * direction.z + b * (Math.cos(angle) * side.z + Math.sin(angle) * over.z);
    const rise = toward.x * up.x + toward.y * up.y + toward.z * up.z;
    if (rise < VIEW_FLOOR) {
      const lift = VIEW_FLOOR - rise;
      toward.x += lift * up.x;
      toward.y += lift * up.y;
      toward.z += lift * up.z;
      const length = Math.hypot(toward.x, toward.y, toward.z);
      toward.x /= length;
      toward.y /= length;
      toward.z /= length;
    }
    sum += Math.log(Math.max(luminance(skyLight(tables, eye, toward, sun, part, sunLeft)), 1e-12));
  }
  return Math.exp(sum / 7);
}

/**
 * How the picture is exposed. An eye or a camera adapts to the light there
 * is: the sky at dusk is a thousand times dimmer than at noon and does not
 * look it. But adaptation is partial, and stops: night is dark.
 */
export const EXPOSURE = {
  /**
   * Out in space, fixed: set for the sunlit Earth, so that ground which
   * sends back all the light that falls on it comes out about as bright as
   * the map of it is drawn.
   */
  space: 3.5,
  /** By day on the ground, with the sky as bright as `daySky`. */
  day: 14,
  daySky: 0.018,
  /**
   * How much of a change in the light is made up for: 1 would show every
   * sky equally bright, 0 would leave dusk black.
   */
  adaptation: 0.72,
  /**
   * The part of the sky looked at can be this many times brighter than the
   * sky as a whole and make no difference: it is brighter toward the horizon
   * anyway. Past that, as facing a low Sun, the eye is used to what it is
   * looking at instead, which is why a sunset keeps its color.
   */
  brightView: 2,
  /** Below this the sky is as dark as the eye gets used to, and goes black. */
  darkestSky: 1e-7,
} as const;

/**
 * What to multiply light by before showing it, standing under a sky of
 * brightness `sky` and looking at a part of it of brightness `view`.
 */
export function skyExposure(sky: number, view: number = sky): number {
  const adaptedTo = Math.max(sky, view / EXPOSURE.brightView, EXPOSURE.darkestSky);
  return EXPOSURE.day * (adaptedTo / EXPOSURE.daySky) ** -EXPOSURE.adaptation;
}

/** The most the exposure gets to: that of a dark night. */
export const NIGHT_EXPOSURE = skyExposure(0);
