import { Matrix3, type Texture, Vector2, Vector3 } from 'three';
import { CLOUD_COVER, CLOUD_LATITUDES } from '../core/clouds';
import {
  BARE_GROUND,
  EARTH_ECCENTRICITY_SQUARED,
  LAND_ALBEDO,
  MAP_WATER,
  MAP_WATER_WITHIN,
  SEA,
  SHORE,
} from '../core/landscape';

function createUniforms() {
  return {
    /** The Earth's map by day, once it has loaded. */
    uLandDay: { value: null as Texture | null },
    uLandMapped: { value: 0 },
    /** Turns a direction in the world to one fixed to the Earth: z north, x through 0° longitude. */
    uLandFromWorld: { value: new Matrix3() },
    /** East and north where the camera is, along the world's axes. */
    uLandEast: { value: new Vector3(1, 0, 0) },
    uLandNorth: { value: new Vector3(0, 0, -1) },
    /** `groundOrigin` for where the camera is. */
    uLandOrigin: { value: new Vector2() },
    /** Seconds, for the sea to move by. */
    uLandTime: { value: 0 },
    /** The picture of the Earth's clouds, and how much they are shown: both from `Earth`. */
    uLandClouds: { value: null as Texture | null },
    uLandClouded: { value: 0 },
  };
}

let uniforms: ReturnType<typeof createUniforms> | undefined;

/**
 * What the ground's shader needs to know: spread it into the material's own
 * uniforms. `Atmosphere` keeps the numbers up to date and `Earth` supplies
 * the maps. As with `atmosphereUniforms`, the material has to be made with
 * `new ShaderMaterial`.
 */
export function landscapeUniforms(): ReturnType<typeof createUniforms> {
  uniforms ??= createUniforms();
  return uniforms;
}

const float = (value: number) => value.toExponential(8);
const vec3 = (value: readonly number[]) => `vec3(${value.map(float).join(', ')})`;

/**
 * GLSL for the ground seen from just above it. Mirrors `core/landscape.ts`
 * where that has the same thing; the two must be kept in step. Goes after
 * `ATMOSPHERE_GLSL`, and needs `uSkyAmbient`: the light of the sky, averaged.
 *
 * The map says what is there, to about 10 km: sand, forest, ice or water.
 * Anything finer is made up, the same way each time for a given place:
 * rolling relief on land, and swell on water.
 */
export const LANDSCAPE_GLSL = /* glsl */ `
  uniform sampler2D uLandDay;
  uniform float uLandMapped;
  uniform mat3 uLandFromWorld;
  uniform vec3 uLandEast;
  uniform vec3 uLandNorth;
  uniform vec2 uLandOrigin;
  uniform float uLandTime;
  uniform sampler2D uLandClouds;
  uniform float uLandClouded;

  const vec3 LAND_MAP_WATER = ${vec3(MAP_WATER.map(Math.sqrt))};
  const vec2 LAND_MAP_WATER_WITHIN = vec2(${float(MAP_WATER_WITHIN[0])}, ${float(MAP_WATER_WITHIN[1])});
  const float LAND_ALBEDO_SCALE = ${float(LAND_ALBEDO.scale)};
  const float LAND_ALBEDO_FLOOR = ${float(LAND_ALBEDO.floor)};
  const vec3 LAND_BARE = ${vec3(BARE_GROUND)};
  const float SHORE_WITHIN = ${float(SHORE.within)};
  const vec3 SHORE_SAND = ${vec3(SHORE.sand)};
  const float SEA_ROUGHNESS = ${float(SEA.roughness)};
  const float SEA_GLINT = ${float(SEA.glint)};
  const vec3 SEA_COLOR = ${vec3(SEA.color)};
  const float LAND_FLATTENING = ${float(1 - EARTH_ECCENTRICITY_SQUARED)};
  // A turn, and a fifth again: no two layers of the pattern line up.
  const mat2 LAND_TURN = mat2(0.8, 0.6, -0.6, 0.8);

  // A number from 0 to 1 for each point of a grid, with no pattern to it.
  float landHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  // A slope for each point of a grid, likewise.
  vec2 landHash2(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy) * 2.0 - 1.0;
  }

  // Smooth noise, from about -0.5 to 0.5, with its slope east and north: a
  // rise or a hollow to each square of a grid, leaning the way its corners
  // say. Leaning rather than stepping keeps the grid from showing.
  vec3 landNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = p - cell;
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
    vec2 ga = landHash2(cell);
    vec2 gb = landHash2(cell + vec2(1.0, 0.0));
    vec2 gc = landHash2(cell + vec2(0.0, 1.0));
    vec2 gd = landHash2(cell + vec2(1.0, 1.0));
    float a = dot(ga, f);
    float b = dot(gb, f - vec2(1.0, 0.0));
    float c = dot(gc, f - vec2(0.0, 1.0));
    float d = dot(gd, f - vec2(1.0, 1.0));
    float k = a - b - c + d;
    return vec3(
      a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
      ga + (gb - ga) * u.x + (gc - ga) * u.y + (ga - gb - gc + gd) * u.x * u.y
        + du * (vec2(b - a, c - a) + k * u.yx)
    );
  }

  // Noise from about -0.5 to 0.5 in three sizes, the largest "across" km, each
  // dropped where it is too fine for the screen.
  float landRough(vec2 p, float across, float footprint) {
    float sum = 0.0;
    float weight = 0.5;
    for (int i = 0; i < 3; i++) {
      float keep = 1.0 - smoothstep(0.12, 0.45, footprint / across);
      sum += keep * weight * landNoise(p / across).x;
      p = LAND_TURN * p + 5.3;
      across *= 0.38;
      weight *= 0.55;
    }
    return sum;
  }

  // Mirrors seaReflectance.
  float seaReflectance(float cosView) {
    return 0.02 + 0.98 * pow(1.0 - cosView, 5.0 * exp(-2.69 * SEA_ROUGHNESS))
      / (1.0 + 22.7 * pow(SEA_ROUGHNESS, 1.5));
  }

  // Dry land: hills and hollows from 6 km across down to 15 m, each layer
  // dropped where it is too fine for the screen to show without flickering.
  // Only their slopes are used, to light them by: the ground stays flat.
  vec3 landDry(vec3 albedo, vec2 at, float footprint, vec3 up, vec3 sunlight) {
    vec2 slope = vec2(0.0);
    float mottle = 0.0;
    float across = 6.0;
    float tall = 0.3;
    float weight = 1.0;
    mat2 back = mat2(1.0);
    vec2 p = at;
    for (int i = 0; i < 8; i++) {
      float keep = 1.0 - smoothstep(0.12, 0.45, footprint / across);
      // Finer layers come after, and are dropped sooner.
      if (keep <= 0.0) break;
      vec3 n = landNoise(p / across);
      // The middle sizes are ridges and gullies, folded along their tops,
      // which is what tells ground from cloud. The fold is rounded: a ridge
      // is not a knife.
      if (i > 0 && i < 6) {
        float fold = 2.4 * n.x;
        float round = sqrt(fold * fold + 0.03);
        n = vec3(0.5 - round, -2.4 * fold / round * n.yz);
      }
      slope += keep * tall / across * (back * n.yz);
      mottle += keep * weight * n.x;
      p = LAND_TURN * p + 31.7;
      back = back * transpose(LAND_TURN);
      across *= 0.42;
      tall *= 0.45;
      weight *= 0.62;
    }
    vec3 normal = normalize(up - uLandEast * slope.x - uLandNorth * slope.y);
    float facing = max(dot(normal, uSkySun), 0.0);
    // Slopes that face the sky less see less of it.
    float open = 0.5 + 0.5 * dot(normal, up);
    vec3 color = albedo * (1.0 + 0.8 * mottle);
    return color * (sunlight * facing / SKY_PI + uSkyAmbient * open);
  }

  // Water: the sky mirrored in it, more the lower it is looked at, the Sun's
  // glitter, and the blue of the water itself. Swell tilts the surface where
  // it is near enough to make out.
  vec3 landSea(vec3 direction, vec2 at, float footprint, vec3 up, vec3 sunlight, float sunHeight) {
    vec2 slope = vec2(0.0);
    float crest = 0.24;
    float steep = 0.05;
    vec2 p = at;
    mat2 back = mat2(1.0);
    for (int i = 0; i < 3; i++) {
      float keep = 1.0 - smoothstep(0.12, 0.45, footprint / crest);
      // Swell travels as fast as the square root of its length, and its
      // crests are longer than they are far apart.
      float speed = 0.0395 * sqrt(crest);
      vec3 n = landNoise(vec2((p.x + speed * uLandTime) / crest, p.y / (3.0 * crest)));
      slope += keep * steep * (back * vec2(n.y, n.z / 3.0));
      p = LAND_TURN * p + 11.3;
      back = back * transpose(LAND_TURN);
      crest *= 0.42;
      steep *= 1.15;
    }
    vec3 normal = normalize(up - uLandEast * slope.x - uLandNorth * slope.y);
    float cosView = clamp(dot(-direction, normal), 0.0, 1.0);

    // A rough sea shows sky from higher up than a mirror would.
    vec3 toSky = reflect(direction, normal) + up * SEA_ROUGHNESS;
    toSky = normalize(toSky + up * max(0.0, 0.03 - dot(toSky, up)));
    vec3 air;
    vec3 through;
    skyView(toSky, false, air, through);
    // The map keeps the sky as it is shown; this is what it was before that.
    vec3 sky = -log(max(1.0 - air, 1e-4)) / uSkyExposure;

    vec3 body = SEA_COLOR * (sunlight * max(sunHeight, 0.0) / SKY_PI + uSkyAmbient);

    // The glitter: waves too small to see, some of which face just the way
    // to catch the Sun, more of them the nearer that way is to the surface's own.
    vec3 halfway = normalize(uSkySun - direction);
    float nh = max(dot(normal, halfway), 1e-3);
    float tilt = (1.0 - nh * nh) / (nh * nh);
    float facets = exp(-tilt / SEA_GLINT) / (SKY_PI * SEA_GLINT * nh * nh * nh * nh);
    float nv = max(cosView, 1e-3);
    float nl = max(dot(normal, uSkySun), 0.0);
    float vh = max(dot(-direction, halfway), 1e-3);
    float seen = min(1.0, min(2.0 * nh * nv / vh, 2.0 * nh * nl / vh));
    float shine = 0.02 + 0.98 * pow(1.0 - vh, 5.0);
    vec3 glitter = sunlight * (shine * facets * seen / (4.0 * nv));

    return mix(body, sky, seaReflectance(cosView)) + glitter;
  }

  // The light the ground sends toward the camera from where a line of sight
  // meets it, "reach" km along "direction", before the air between dims it.
  // "at" is where that is, km east and north of the camera, and "footprint"
  // how much ground a pixel takes in there, km.
  vec3 landLight(vec3 direction, float reach, vec2 at, float footprint) {
    vec3 up = normalize(uSkyEye + direction * reach);
    float sunHeight = dot(up, uSkySun);
    float left = 1.0;
    if (uSkyEclipse > 0.5) left -= sunHiddenByMoon(up, uSkySunPosition, uSkyMoonPosition);
    vec3 sunlight = skySunlight(SKY_BOTTOM, sunHeight) * left;

    vec2 pattern = at + uLandOrigin;
    vec3 albedo = LAND_BARE;
    float water = 0.0;
    if (uLandMapped > 0.5) {
      vec3 earth = uLandFromWorld * up;
      // Mirrors mapLatitude: the Earth is flattened, and the maps go by the
      // latitude that makes of it.
      float latitude = atan(earth.z, LAND_FLATTENING * sqrt(max(0.0, 1.0 - earth.z * earth.z)));
      vec2 place = vec2(atan(earth.y, earth.x) / (2.0 * SKY_PI) + 0.5, latitude / SKY_PI + 0.5);
      // The maps' squares are 10 km across, and between them everything
      // runs in straight lines: shores especially. Reading the map a few km
      // off, differently from place to place, bends them.
      vec2 bend = 8.0 * vec2(landRough(pattern, 9.0, footprint), landRough(pattern + 71.7, 9.0, footprint));
      place += bend / vec2(40075.0 * max(cos(latitude), 0.05), 20004.0);
      // Under cloud the ground is in its shade. Mirrors cloudCover and cloudsDrawnAt.
      float cloud = uLandClouded
        * smoothstep(${float(CLOUD_COVER.from)}, ${float(CLOUD_COVER.to)}, textureLod(uLandClouds, place, 0.0).r)
        * (1.0 - smoothstep(${float(CLOUD_LATITUDES.full / 90)}, ${float(CLOUD_LATITUDES.none / 90)}, abs(latitude) / (0.5 * SKY_PI)));
      sunlight *= 1.0 - 0.7 * cloud;
      // The maps are far coarser than the screen here: no need of their smaller copies.
      vec3 day = textureLod(uLandDay, place, 0.0).rgb;
      // Mirrors waterShare and landAlbedo, but for the shore being
      // roughened: no shore is smooth, at any size.
      float off = length(sqrt(day) - LAND_MAP_WATER);
      float shore = off + 0.08 * landRough(pattern + 23.1, 1.6, footprint);
      water = 1.0 - smoothstep(LAND_MAP_WATER_WITHIN.x, LAND_MAP_WATER_WITHIN.y, shore);
      albedo = mix(SHORE_SAND, LAND_ALBEDO_FLOOR + LAND_ALBEDO_SCALE * day,
        smoothstep(LAND_MAP_WATER_WITHIN.y, SHORE_WITHIN, off));
    }
    vec3 light = vec3(0.0);
    if (water < 1.0) {
      light += (1.0 - water) * landDry(albedo, pattern, footprint, up, sunlight);
    }
    if (water > 0.0) {
      light += water * landSea(direction, pattern, footprint, up, sunlight, sunHeight);
    }
    return light;
  }
`;
