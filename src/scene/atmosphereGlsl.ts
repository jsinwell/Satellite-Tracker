import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import {
  ATMOSPHERE,
  atmosphereTables,
  ECLIPSE_SKYLIGHT,
  MULTISCATTER_MIN_SUN,
  MULTISCATTER_SIZE,
  SKY_STEP_OFFSET,
  SKY_STEPS,
  SKY_VIEW,
  SUN_ANGULAR_RADIUS,
  TRANSMITTANCE_SIZE,
} from '../core/atmosphere';
import { ECLIPSE_GLSL } from './eclipseGlsl';

/**
 * The second table's numbers are small, and a texture of half-precision
 * floats is coarse below a ten-thousandth. Stored this many times larger.
 */
const MULTISCATTER_SCALE = 1e4;

function tableTexture(
  table: Float32Array,
  size: { width: number; height: number },
  scale: number,
): DataTexture {
  const data = new Uint16Array(table.length);
  for (let i = 0; i < table.length; i++) data[i] = DataUtils.toHalfFloat(table[i] * scale);
  const texture = new DataTexture(data, size.width, size.height, RGBAFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * The map of the sky the screen is drawn from: see `SKY_VIEW` for its layout
 * and `skyView.ts` for the drawing of it. Twice as many rows as the layout
 * has: the light of the air along each line of sight, then how much of what
 * is behind the air gets through it.
 *
 * Eight bits a channel is enough, as what is kept is close to what goes on
 * the screen, and every graphics card can draw to that. `skyView.ts` asks for
 * more where there is more to be had.
 */
function createSkyView(): WebGLRenderTarget {
  const target = new WebGLRenderTarget(SKY_VIEW.width, 2 * (SKY_VIEW.above + SKY_VIEW.below), {
    type: UnsignedByteType,
    format: RGBAFormat,
    colorSpace: NoColorSpace,
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    // Round the compass and back to the start.
    wrapS: RepeatWrapping,
    wrapT: ClampToEdgeWrapping,
  });
  return target;
}

let skyView: WebGLRenderTarget | undefined;

export function skyViewTarget(): WebGLRenderTarget {
  skyView ??= createSkyView();
  return skyView;
}

function createUniforms() {
  const tables = atmosphereTables();
  return {
    uSkyView: { value: skyViewTarget().texture },
    /** Two level directions square to each other, which the map's compass is measured from. */
    uSkyViewAhead: { value: new Vector3(1, 0, 0) },
    uSkyViewSide: { value: new Vector3(0, 0, 1) },
    /** `skyViewHorizon` and `skyViewReach` for where the camera is. */
    uSkyViewHorizon: { value: Math.PI / 2 },
    uSkyViewReach: { value: Math.PI / 2 },
    uSkyTransmittance: {
      value: tableTexture(tables.transmittance, TRANSMITTANCE_SIZE, 1),
    },
    uSkyMultiscatter: {
      value: tableTexture(tables.multiscatter, MULTISCATTER_SIZE, MULTISCATTER_SCALE),
    },
    /** The camera, km from the Earth's center, along the world's axes. */
    uSkyEye: { value: new Vector3(0, ATMOSPHERE.topKm * 3, 0) },
    /** Its height above the ground, km: kept apart, as the difference of two large numbers. */
    uSkyEyeHeight: { value: ATMOSPHERE.topKm * 2 },
    /** Toward the Sun from the Earth's center. */
    uSkySun: { value: new Vector3(1, 0, 0) },
    /** Where the Sun and Moon are, in Earth radii, for the Moon's shadow. */
    uSkySunPosition: { value: new Vector3(23000, 0, 0) },
    uSkyMoonPosition: { value: new Vector3(0, 60, 0) },
    /** 1 while the Moon's shadow is on or near the Earth; it is not looked for otherwise. */
    uSkyEclipse: { value: 0 },
    /** Toward the Moon from the camera. */
    uSkyMoon: { value: new Vector3(0, 1, 0) },
    /**
     * Its light, by color, as a share of the Sun's: see `moonlight`. Nothing
     * while the Sun is up, when it makes no difference and is not worked out.
     */
    uSkyMoonlight: { value: new Vector3() },
    uSkyExposure: { value: 1 },
    /** 1 looking up from the ground, 0 out in space; see `groundView`. */
    uSkyGround: { value: 0 },
  };
}

let uniforms: ReturnType<typeof createUniforms> | undefined;

/**
 * What every shader that draws through the atmosphere needs to know, shared
 * between them: spread it into a material's own uniforms. `Atmosphere` keeps
 * it up to date.
 *
 * The material has to be made with `new ShaderMaterial`, not as a
 * `<shaderMaterial>` element: react-three-fiber copies each uniform it is
 * handed as a prop, and a copy of a number is not kept up to date.
 */
export function atmosphereUniforms(): ReturnType<typeof createUniforms> {
  uniforms ??= createUniforms();
  return uniforms;
}

const float = (value: number) => value.toExponential(8);
const vec3 = (value: readonly number[]) => `vec3(${value.map(float).join(', ')})`;

/**
 * What both of the pieces below are built on. Mirrors `core/atmosphere.ts`,
 * where the model is explained and tested; the two must be kept in step.
 * Distances are in km from the Earth's center, along the world's axes.
 */
const SHARED_GLSL = /* glsl */ `
  uniform sampler2D uSkyTransmittance;
  uniform sampler2D uSkyMultiscatter;
  uniform vec3 uSkyEye;
  uniform float uSkyEyeHeight;
  uniform vec3 uSkySun;
  uniform vec3 uSkySunPosition;
  uniform vec3 uSkyMoonPosition;
  uniform float uSkyEclipse;
  uniform vec3 uSkyMoon;
  uniform vec3 uSkyMoonlight;
  uniform float uSkyExposure;
  uniform float uSkyGround;
  uniform vec3 uSkyViewAhead;
  uniform vec3 uSkyViewSide;
  uniform float uSkyViewHorizon;
  uniform float uSkyViewReach;

  ${ECLIPSE_GLSL}

  const float SKY_BOTTOM = ${float(ATMOSPHERE.bottomKm)};
  const float SKY_TOP = ${float(ATMOSPHERE.topKm)};
  const float SKY_REACH = ${float(Math.sqrt(ATMOSPHERE.topKm ** 2 - ATMOSPHERE.bottomKm ** 2))};
  const vec3 SKY_RAYLEIGH = ${vec3(ATMOSPHERE.rayleigh)};
  const float SKY_RAYLEIGH_HEIGHT = ${float(ATMOSPHERE.rayleighHeightKm)};
  const float SKY_MIE = ${float(ATMOSPHERE.mieScattering)};
  const float SKY_MIE_EXTINCTION = ${float(ATMOSPHERE.mieScattering + ATMOSPHERE.mieAbsorption)};
  const float SKY_MIE_HEIGHT = ${float(ATMOSPHERE.mieHeightKm)};
  const float SKY_MIE_FORWARD = ${float(ATMOSPHERE.mieForward)};
  const vec3 SKY_OZONE = ${vec3(ATMOSPHERE.ozone)};
  const float SKY_OZONE_CENTER = ${float(ATMOSPHERE.ozoneCenterKm)};
  const float SKY_OZONE_HALF_WIDTH = ${float(ATMOSPHERE.ozoneHalfWidthKm)};
  const vec2 SKY_TRANSMITTANCE_SIZE = vec2(${float(TRANSMITTANCE_SIZE.width)}, ${float(TRANSMITTANCE_SIZE.height)});
  const vec2 SKY_MULTISCATTER_SIZE = vec2(${float(MULTISCATTER_SIZE.width)}, ${float(MULTISCATTER_SIZE.height)});
  const float SKY_MULTISCATTER_MIN_SUN = ${float(MULTISCATTER_MIN_SUN)};
  const float SKY_MULTISCATTER_SCALE = ${float(MULTISCATTER_SCALE)};
  const float SKY_SUN_RADIUS = ${float(SUN_ANGULAR_RADIUS)};
  const float SKY_ECLIPSE_SKYLIGHT = ${float(ECLIPSE_SKYLIGHT)};
  const int SKY_STEPS = ${SKY_STEPS};
  const float SKY_STEP_OFFSET = ${float(SKY_STEP_OFFSET)};
  const float SKY_VIEW_WIDTH = ${float(SKY_VIEW.width)};
  const float SKY_VIEW_ABOVE = ${float(SKY_VIEW.above)};
  const float SKY_VIEW_BELOW = ${float(SKY_VIEW.below)};
  const float SKY_PI = 3.14159265;

  float skyLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  // None of the tables has smaller copies of itself, and saying so when
  // reading them (textureLod) lets them be read from inside a branch or a loop.

  // Where along a table's side to read it, for a place from 0 to 1 across its entries.
  vec2 skyTableUv(vec2 place, vec2 size) {
    return (clamp(place, 0.0, 1.0) * (size - 1.0) + 0.5) / size;
  }

  // Mirrors transmittanceToTop.
  vec3 skyTransmittanceToTop(float r, float mu) {
    float radius = clamp(r, SKY_BOTTOM, SKY_TOP);
    float rho = sqrt(max(0.0, (radius - SKY_BOTTOM) * (radius + SKY_BOTTOM)));
    float nearest = SKY_TOP - radius;
    float farthest = rho + SKY_REACH;
    float toTop = max(0.0, -radius * mu + sqrt(max(0.0, radius * radius * (mu * mu - 1.0) + SKY_TOP * SKY_TOP)));
    vec2 place = vec2((toTop - nearest) / (farthest - nearest), rho / SKY_REACH);
    return textureLod(uSkyTransmittance, skyTableUv(place, SKY_TRANSMITTANCE_SIZE), 0.0).rgb;
  }

  // Mirrors sunlightAt.
  vec3 skySunlight(float r, float mu) {
    float horizon = -sqrt(max(0.0, (r - SKY_BOTTOM) * (r + SKY_BOTTOM))) / r;
    float clear = smoothstep(-SKY_SUN_RADIUS, SKY_SUN_RADIUS, mu - horizon);
    return skyTransmittanceToTop(r, max(mu, horizon)) * clear;
  }

  // Mirrors multiscatterAt.
  vec3 skyMultiscatter(float r, float mu) {
    vec2 place = vec2(
      (mu - SKY_MULTISCATTER_MIN_SUN) / (1.0 - SKY_MULTISCATTER_MIN_SUN),
      (r - SKY_BOTTOM) / (SKY_TOP - SKY_BOTTOM)
    );
    return textureLod(uSkyMultiscatter, skyTableUv(place, SKY_MULTISCATTER_SIZE), 0.0).rgb / SKY_MULTISCATTER_SCALE;
  }

  // Mirrors spanOf, for a line of sight from the camera: the part of it in
  // the atmosphere, and whether it ends on the ground.
  bool skySpan(vec3 direction, out float start, out float end, out bool ground) {
    float r = SKY_BOTTOM + uSkyEyeHeight;
    float b = dot(uSkyEye, direction);
    float top = b * b - (r - SKY_TOP) * (r + SKY_TOP);
    start = 0.0;
    end = 0.0;
    ground = false;
    if (top <= 0.0) return false;
    end = -b + sqrt(top);
    if (end <= 0.0) return false;
    start = max(0.0, -b - sqrt(top));
    float low = b * b - uSkyEyeHeight * (r + SKY_BOTTOM);
    ground = low > 0.0 && b < 0.0;
    if (ground) end = max(start, -b - sqrt(low));
    return true;
  }

  // Light as it is shown: exposed, then eased toward white as film is,
  // rather than cut off at it.
  vec3 skyTone(vec3 light) {
    return 1.0 - exp(-light * uSkyExposure);
  }
`;

/**
 * GLSL for stepping along a line of sight through the atmosphere. Too slow to
 * do for every pixel: only the map of the sky is made this way.
 */
export const ATMOSPHERE_MARCH_GLSL = /* glsl */ `
  ${SHARED_GLSL}

  // Mirrors skyViewAngle.
  float skyViewAngle(float row) {
    if (row < SKY_VIEW_BELOW) {
      float past = 1.0 - row / (SKY_VIEW_BELOW - 1.0);
      return uSkyViewHorizon + past * past * (SKY_PI - uSkyViewHorizon);
    }
    float clear = (row - SKY_VIEW_BELOW) / (SKY_VIEW_ABOVE - 1.0);
    return uSkyViewHorizon - clear * clear * uSkyViewReach;
  }

  // Mirrors march: the light scattered toward the camera from the air between
  // "start" and "end" along a line of sight, and how much of what lies beyond
  // gets through. The light is from "toLight", as much of it as the Sun
  // gives: the Sun itself, which the Moon can eclipse, or the Moon.
  void skyMarch(vec3 direction, float start, float end, vec3 toLight, bool eclipsed, out vec3 light, out vec3 through) {
    light = vec3(0.0);
    through = vec3(1.0);
    float span = end - start;
    float bunching = clamp(1.0 - uSkyEyeHeight / (SKY_TOP - SKY_BOTTOM), 0.0, 1.0);
    float b = dot(uSkyEye, direction);
    float eyeSun = dot(uSkyEye, toLight);
    float cosine = dot(direction, toLight);
    // The square of the camera's distance from the center, less the ground's.
    float above = uSkyEyeHeight * (2.0 * SKY_BOTTOM + uSkyEyeHeight);

    float g = SKY_MIE_FORWARD;
    float airPhase = 3.0 / (16.0 * SKY_PI) * (1.0 + cosine * cosine);
    float hazePhase = 3.0 / (8.0 * SKY_PI) * ((1.0 - g * g) * (1.0 + cosine * cosine))
      / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosine, 1.5));

    float from = 0.0;
    for (int i = 0; i < SKY_STEPS; i++) {
      float x = float(i + 1) / float(SKY_STEPS);
      float to = span * (x + bunching * (x * x - x));
      float stride = to - from;
      float t = start + from + SKY_STEP_OFFSET * stride;
      from = to;

      float over = max(0.0, above + t * t + 2.0 * b * t);
      float r = sqrt(over + SKY_BOTTOM * SKY_BOTTOM);
      float height = over / (r + SKY_BOTTOM);
      float air = exp(-height / SKY_RAYLEIGH_HEIGHT);
      float haze = exp(-height / SKY_MIE_HEIGHT);
      float ozone = max(0.0, 1.0 - abs(height - SKY_OZONE_CENTER) / SKY_OZONE_HALF_WIDTH);

      float sunHeight = (eyeSun + t * cosine) / r;
      float left = 1.0;
      if (eclipsed && uSkyEclipse > 0.5) {
        left -= sunHiddenByMoon((uSkyEye + direction * t) / SKY_BOTTOM, uSkySunPosition, uSkyMoonPosition);
      }
      float skylight = SKY_ECLIPSE_SKYLIGHT + (1.0 - SKY_ECLIPSE_SKYLIGHT) * left;

      vec3 airScatter = SKY_RAYLEIGH * air;
      float hazeScatter = SKY_MIE * haze;
      vec3 extinction = airScatter + SKY_MIE_EXTINCTION * haze + SKY_OZONE * ozone;
      vec3 kept = exp(-extinction * stride);
      vec3 sent = through * (1.0 - kept) / max(extinction, 1e-12);
      vec3 source = (airScatter * airPhase + hazeScatter * hazePhase) * skySunlight(r, sunHeight) * left
        + (airScatter + hazeScatter) * skyMultiscatter(r, sunHeight) * skylight;
      light += source * sent;
      through *= kept;
    }
  }
`;

/**
 * GLSL for anything seen through the atmosphere: what the air adds along a
 * line of sight from the camera and what it lets through, read from the map
 * of the sky. Includes `ECLIPSE_GLSL`.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
  ${SHARED_GLSL}

  uniform sampler2D uSkyView;

  // Mirrors skyViewRow.
  float skyViewRow(float angle, bool ground) {
    if (ground) {
      float past = clamp((angle - uSkyViewHorizon) / (SKY_PI - uSkyViewHorizon), 0.0, 1.0);
      return (SKY_VIEW_BELOW - 1.0) * (1.0 - sqrt(past));
    }
    float clear = clamp((uSkyViewHorizon - angle) / uSkyViewReach, 0.0, 1.0);
    return SKY_VIEW_BELOW + (SKY_VIEW_ABOVE - 1.0) * sqrt(clear);
  }

  // The air along a line of sight from the camera, which ends on the ground
  // or does not: its light, already as skyTone would give it, and how much of
  // what is behind it gets through.
  void skyView(vec3 direction, bool ground, out vec3 air, out vec3 through) {
    float r = SKY_BOTTOM + uSkyEyeHeight;
    float angle = acos(clamp(dot(uSkyEye, direction) / r, -1.0, 1.0));
    float ahead = dot(direction, uSkyViewAhead);
    float side = dot(direction, uSkyViewSide);
    // Straight up and straight down have no compass bearing, and need none.
    float turn = abs(ahead) + abs(side) > 1e-7 ? atan(side, ahead) / (2.0 * SKY_PI) : 0.0;
    float rows = SKY_VIEW_ABOVE + SKY_VIEW_BELOW;
    vec2 place = vec2(turn + 0.5, (skyViewRow(angle, ground) + 0.5) / (2.0 * rows));
    // Kept as square roots: see skyView.ts.
    vec3 a = textureLod(uSkyView, place, 0.0).rgb;
    vec3 b = textureLod(uSkyView, place + vec2(0.0, 0.5), 0.0).rgb;
    air = a * a;
    through = b * b;
  }

  // Two lights on one spot of the screen, without going past white.
  vec3 skyAdd(vec3 a, vec3 b) {
    return 1.0 - (1.0 - a) * (1.0 - b);
  }

  // A different number for every pixel, evenly spread: to turn the steps
  // between the screen's 256 levels into grain too fine to see.
  float skyNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
  }
`;
