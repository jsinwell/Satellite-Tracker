import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LineSegments,
  MathUtils,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { satelliteColor } from '../app/palette';
import { type ColorBy, currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { faintestSeen } from '../core/brightness';
import type { ObjectType } from '../core/catalog';
import { wallNow } from '../core/clock';
import { type ConstellationId, soleEnabled } from '../core/constellation';
import { trailSeconds, type Vec3 } from '../core/kinematics';
import { STATE_STRIDE } from '../core/propagator';
import { TEME_FROM_WORLD } from './frame';
import { ORBIT_GLSL, SHADOW_BRIGHTNESS } from './orbitGlsl';
import { groundView, SKY_FOV } from './standing';

/**
 * The smallest a satellite is drawn, CSS px. From the ground the far ones,
 * navigation and geostationary satellites, would otherwise be specks.
 */
const MIN_POINT_SIZE = { space: 1.6, ground: 2.6 } as const;

/** Relative point size by object type; debris is drawn smaller so payloads read first. */
const TYPE_SIZES: Record<ObjectType, number> = {
  payload: 1,
  'rocket-body': 1,
  debris: 0.7,
  unknown: 0.8,
};

/**
 * How big a satellite is drawn looking up, CSS px: close ones larger. From
 * `outline` up it is drawn as a satellite; below, there are too few pixels
 * for that, and it is a diamond.
 */
const GLYPH_SIZE = { min: 6, outline: 10.5, max: 16 } as const;
/** How many flat faces each satellite has to flash in the Sun. */
const GLINT_FACES = 4;
/** How far a flare's spikes reach from its center, CSS px. */
const FLARE_REACH_PX = 26;
/** Looking up, each point is this many times wider than the satellite in it, for its glow and glint. */
const GLYPH_SPREAD = 2.6;
/**
 * Looking up, every satellite trails where it was this many simulated seconds
 * ago, even at real speed or paused: the motion is what gives a satellite
 * away among the stars. Three seconds is a few degrees for one passing over.
 */
const GROUND_TRAIL_SECONDS = 3;
/**
 * Drawn as the light it is, a satellite is a point this wide, CSS px: `min`
 * for one only just seen, and `perMagnitude` more for each magnitude
 * brighter than that, up to `max`. The space station at its best is ten
 * magnitudes past what the eye can make out.
 */
const LIGHT_SIZE = { min: 2.4, perMagnitude: 0.65, max: 9 } as const;
/** The point drawn is this many times wider than that, for its glow. */
const LIGHT_SPREAD = 2.6;
/** A solar panel catching the Sun makes a satellite this many magnitudes brighter, at most. */
const GLINT_MAGNITUDES = 5;

// Both shaders read the same per-satellite attributes; see `buildSatellites`.
const SHARED_GLSL = /* glsl */ `
  attribute vec3 aPosition;
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aVisible;
  /** Its standard magnitude: see core/brightness.ts. */
  attribute float aMagnitude;

  uniform float uDt;
  uniform vec3 uSunDirection;
  uniform float uShadowBrightness;
  /** Where the camera is, km, in the same frame as the satellites. */
  uniform vec3 uEye;
  /**
   * 1 where the satellites are drawn as the lights they are, and only the
   * ones bright enough to see: looking up, unless everything is asked for.
   */
  uniform float uLight;
  /** The faintest magnitude that shows then. */
  uniform float uFaintest;
  /** The selected satellite, which is always drawn, and as a satellite; -1 for none. */
  uniform float uSelected;

  ${ORBIT_GLSL}

  const float PI = 3.14159265;
  const float LN10 = 2.302585;

  // Mirrors phaseShare in core/brightness.ts.
  float phaseShare(float cosPhase) {
    float phase = acos(clamp(cosPhase, -1.0, 1.0));
    return (sin(phase) + (PI - phase) * cosPhase) / PI;
  }

  // Mirrors magnitudeFrom: how bright it is from the camera, if the Sun is on it.
  float magnitudeAt(vec3 p) {
    vec3 toEye = uEye - p;
    float range = length(toEye);
    float share = max(PI * phaseShare(dot(uSunDirection, toEye) / range), 1e-6);
    return aMagnitude + (5.0 * log(range / 1000.0) - 2.5 * log(share)) / LN10;
  }

  // How much of a satellite "over" magnitudes brighter than the faintest
  // seen shows: it comes in over a magnitude, and is dim for a while after.
  float lightShown(float over) {
    return smoothstep(-0.5, 0.5, over) * clamp(0.7 + 0.15 * over, 0.0, 1.0);
  }

  // A sunlit satellite is white; passing into the Earth's shadow the last
  // light on it has come through the air, and is red.
  vec3 lightColor(float lit) {
    return mix(vec3(1.0, 0.42, 0.22), vec3(1.0, 0.98, 0.94), smoothstep(0.0, 0.85, lit));
  }

  bool isChosen() {
    return float(gl_InstanceID) == uSelected;
  }

  // An all-zero position means "no state"; see Propagator.propagate.
  bool isHidden() {
    return aVisible < 0.5 || dot(aPosition, aPosition) == 0.0;
  }

  const vec4 OUTSIDE_CLIP_VOLUME = vec4(0.0, 0.0, 2.0, 1.0);
`;

const pointVertexShader = /* glsl */ `
  attribute float aSize;
  /** Fixed per satellite, in [0, 1); negative for objects with no solar panels to glint. */
  attribute float aSeed;
  uniform float uPixelRatio;
  uniform float uMinSize;
  /** 1 looking up from the ground, 0 out in space; see \`groundView\`. */
  uniform float uGround;
  /** The view's width over its height, to turn clip space into screen directions. */
  uniform float uAspect;
  /** How far the view of the sky is zoomed in: 1 at its usual width. */
  uniform float uZoom;
  varying vec3 vColor;
  varying float vSize;
  varying vec2 vHeading;
  /** 1 in sunlight, 0 in the Earth's shadow. */
  varying float vLit;
  /** How much of its sunlit side faces the viewer, from 1 (Sun behind the viewer) to 0. */
  varying float vPhase;
  /** Toward the Sun, in the outline's frame: x along the heading, y across it, z toward the viewer. */
  varying vec3 vSun;
  /** How strongly a solar panel is mirroring the Sun at the viewer, 0 to 1. */
  varying float vGlint;
  /** The size of the point the satellite itself needs, px; \`vSize\` may be larger for a flare. */
  varying float vGlyphSize;
  /** How much of it shows, drawn as a light, 0 to 1; negative where it is drawn as a satellite. */
  varying float vShown;

  ${SHARED_GLSL}

  /** The direction on screen, aspect corrected, from one point to another. */
  vec2 screenDirection(vec4 fromClip, vec3 to) {
    vec4 toClip = projectionMatrix * modelViewMatrix * vec4(to, 1.0);
    vec2 d = (toClip.xy / toClip.w - fromClip.xy / fromClip.w) * vec2(uAspect, 1.0);
    return dot(d, d) > 0.0 ? normalize(d) : vec2(1.0, 0.0);
  }

  void main() {
    vLit = 1.0;
    vPhase = 1.0;
    vSun = vec3(0.0, 0.0, 1.0);
    vGlint = 0.0;
    vGlyphSize = 0.0;
    vShown = -1.0;
    vHeading = vec2(1.0, 0.0);
    if (isHidden()) {
      gl_Position = OUTSIDE_CLIP_VOLUME;
      gl_PointSize = 0.0;
      return;
    }

    vec3 p = extrapolate(aPosition, aVelocity, uDt);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    float distance = -viewPosition.z;

    if (uGround < 0.5) {
      // From space, a dot that shrinks with distance (in Earth radii) but
      // never below a visible size, dimmed in the Earth's shadow.
      vSize = clamp(aSize * 9.0 / distance, uMinSize, 6.0) * uPixelRatio;
      gl_PointSize = vSize;
      vColor = aColor * sunlight(p, uSunDirection, uShadowBrightness);
      return;
    }

    // From the ground. First what goes for it however it is drawn: whether
    // the Sun is on it, and how much of its sunlit side faces the viewer,
    // by the angle between the Sun and the viewer seen from the satellite.
    // Brightness follows a diffuse sphere's, like the Moon's phases.
    vLit = sunlight(p, uSunDirection, 0.0);
    vec3 toEye = normalize(uEye - p);
    float cosPhase = clamp(dot(uSunDirection, toEye), -1.0, 1.0);
    float phase = acos(cosPhase);
    vPhase = phaseShare(cosPhase);

    // Glints. Most satellites keep one side toward the Earth, so the flat
    // faces of their bodies and panels turn once an orbit. When one sits
    // halfway between the Sun and the viewer, it mirrors the Sun at them and
    // the satellite flares for a few seconds, as Iridium and Starlink
    // satellites famously do. The orientation is real; the faces are not:
    // the catalog does not say what each satellite looks like, so each gets
    // a few flat faces turned at random. Panels are not perfect mirrors, so
    // a face catches the Sun over a few degrees.
    if (aSeed >= 0.0 && vLit > 0.5) {
      vec3 up = normalize(p);
      vec3 along = normalize(aVelocity - dot(aVelocity, up) * up);
      vec3 side = cross(up, along);
      vec3 halfway = normalize(uSunDirection + toEye);
      for (int k = 0; k < ${GLINT_FACES}; k++) {
        float azimuth = fract(aSeed * (13.7 + 7.1 * float(k))) * 6.2832;
        float lift = fract(aSeed * (29.3 + 3.7 * float(k))) * 2.0 - 1.0;
        vec3 face = up * lift + (along * cos(azimuth) + side * sin(azimuth)) * sqrt(1.0 - lift * lift);
        vGlint = max(vGlint, smoothstep(0.9965, 0.99985, dot(face, halfway)));
      }
      vGlint *= vLit;
    }

    if (uLight > 0.5 && !isChosen()) {
      // As the light it is, and only if it is bright enough to see: a point
      // the size of its brightness, like a star or a planet. A glint can
      // bring one into sight for the few seconds it lasts.
      float over = uFaintest - (magnitudeAt(p) - ${GLINT_MAGNITUDES.toFixed(1)} * vGlint);
      vShown = lightShown(over) * vLit;
      if (vShown <= 0.0) {
        gl_Position = OUTSIDE_CLIP_VOLUME;
        gl_PointSize = 0.0;
        return;
      }
      float width = clamp(
        ${LIGHT_SIZE.min.toFixed(1)} + ${LIGHT_SIZE.perMagnitude.toFixed(2)} * over,
        ${LIGHT_SIZE.min.toFixed(1)},
        ${LIGHT_SIZE.max.toFixed(1)});
      vGlyphSize = width * ${LIGHT_SPREAD.toFixed(1)} * uPixelRatio;
      vColor = lightColor(vLit);
      // Only a glint from something already in plain sight has spikes to it.
      vGlint *= smoothstep(1.0, 3.0, over);
    } else {
      // As a satellite: big enough to show its shape, largest for those
      // passing close overhead, with room around it for its glow. Zooming
      // in enlarges them too, so their shape and shading can be seen.
      float size = clamp(aSize * 1.6 / distance, ${GLYPH_SIZE.min.toFixed(1)}, ${GLYPH_SIZE.max.toFixed(1)}) * uZoom;
      vGlyphSize = size * ${GLYPH_SPREAD.toFixed(1)} * uPixelRatio;
      vColor = aColor;
      // Which way it is crossing the screen: where it will be a second from now.
      vHeading = screenDirection(gl_Position, extrapolate(aPosition, aVelocity, uDt + 1.0));
      vec2 sunward = screenDirection(gl_Position, p + uSunDirection * 100.0);
      vec2 across = vec2(-vHeading.y, vHeading.x);
      vSun = vec3(vec2(dot(sunward, vHeading), dot(sunward, across)) * sin(phase), cosPhase);
    }
    vSize = vGlyphSize;
    // A flare is as big on screen however far off the satellite is: grow
    // the point to fit it, leaving the satellite drawn at its own size.
    if (vGlint > 0.0) vSize = max(vGlyphSize, ${(2 * FLARE_REACH_PX).toFixed(1)} * uPixelRatio);
    gl_PointSize = vSize;
  }
`;

const pointFragmentShader = /* glsl */ `
  uniform float uGround;
  uniform float uPixelRatio;
  /** 1 under a dark sky, 0 in daylight: how much the sunlit ones glow. */
  uniform float uSkyDark;
  varying vec3 vColor;
  varying float vSize;
  varying vec2 vHeading;
  varying float vLit;
  varying float vPhase;
  varying vec3 vSun;
  varying float vGlint;
  varying float vGlyphSize;
  varying float vShown;

  // A flare is a flash of white with spikes, as a bright point of light
  // looks to the eye, measured in screen pixels so it is the same size for
  // a satellite near or far.
  float flareAt(vec2 px) {
    return min(1.0, vGlint * (
      exp(-dot(px, px) / 10.0) +
      0.3 * exp(-dot(px, px) / 90.0) +
      0.85 * exp(-abs(px.y) / 0.8) * exp(-abs(px.x) / 8.0) +
      0.85 * exp(-abs(px.x) / 0.8) * exp(-abs(px.y) / 8.0)));
  }

  // Signed distance from a box of half-size \`extent\` centered at the origin.
  // (Not \`half\`, which GLSL reserves.)
  float box(vec2 q, vec2 extent) {
    vec2 d = abs(q) - extent;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (uGround < 0.5) {
      float alpha = 1.0 - smoothstep(0.3, 0.5, length(c));
      if (alpha <= 0.0) discard;
      gl_FragColor = vec4(vColor, alpha * 0.9);
      #include <colorspace_fragment>
      return;
    }

    vec2 px = c * vSize / uPixelRatio;
    if (vShown >= 0.0) {
      // As a light: a bright core in a soft glow, like a planet's.
      float d = 2.0 * length(c) * vSize / vGlyphSize;
      float core = 1.0 - smoothstep(${(0.7 / LIGHT_SPREAD).toFixed(3)}, ${(1 / LIGHT_SPREAD).toFixed(3)}, d);
      float glow = 0.3 * pow(max(1.0 - d, 0.0), 2.0);
      float flare = flareAt(px);
      float alpha = max(max(core, glow) * vShown, flare);
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(mix(vColor, vec3(1.0), flare), alpha);
      #include <colorspace_fragment>
      return;
    }

    // Asked for as one, a satellite is drawn as one: a body pointed the way it is
    // going, with a solar panel out to either side; too far off for that, a
    // diamond. It sits in the middle of a larger point, which leaves room for
    // its glow and glint.
    c.y = -c.y; // point coordinates run downward; the screen's y runs up
    // In units where the satellite spans about -1 to 1, however big the point.
    vec2 screen = c * ${(2 * GLYPH_SPREAD).toFixed(1)} * (vSize / vGlyphSize);
    vec2 q = vec2(dot(screen, vHeading), dot(screen, vec2(-vHeading.y, vHeading.x)));
    float pixel = ${(2 * GLYPH_SPREAD).toFixed(1)} / vGlyphSize;
    vec3 sun = normalize(vSun);
    float shape;
    float light;
    if (vGlyphSize < ${GLYPH_SIZE.outline.toFixed(1)} * ${GLYPH_SPREAD.toFixed(1)} * uPixelRatio) {
      shape = (abs(q.x) + abs(q.y) - 0.8) * 0.7071;
      light = vPhase;
    } else {
      float body = box(q, vec2(0.26, 0.2));
      float panels = min(box(q - vec2(0.0, 0.58), vec2(0.17, 0.34)), box(q + vec2(0.0, 0.58), vec2(0.17, 0.34)));
      float strut = box(q, vec2(0.04, 0.3));
      shape = min(min(body, panels), strut);
      if (panels < min(body, strut)) {
        // The panels face the Sun: their lit face shows as far as the Sun is
        // on the viewer's side of them.
        light = 0.12 + 0.88 * max(sun.z, 0.0);
      } else {
        // The body is lit from the Sun's side, rounded like a small sphere.
        vec3 normal = normalize(vec3(q.x * 3.0, q.y * 4.0, 1.0));
        light = max(dot(normal, sun), 0.0);
      }
    }
    // Lit faces go toward white where the light is strongest, as a bright
    // surface does.
    vec3 sunlit = vColor * (0.2 + 1.2 * light) + vec3(0.35) * light * light;
    // In the Earth's shadow, a dull silhouette, lit only by the faint glow of
    // the night sky and the Earth.
    vec3 shadowed = vColor * 0.3;
    vec3 fill = mix(shadowed, sunlit, vLit);

    float inside = 1.0 - smoothstep(-pixel, 0.0, shape);
    float outline = 1.0 - smoothstep(0.0, pixel, shape - 0.6 * pixel);
    // A thin dark rim keeps it readable against a bright sky.
    vec3 color = mix(vec3(0.02, 0.03, 0.06), fill, inside);
    float alpha = outline * mix(0.6, 1.0, inside);

    // A sunlit satellite glows against a dark sky, the more of its lit side
    // faces the viewer the brighter.
    float r2 = dot(q, q);
    float halo = uSkyDark * vLit * (0.18 + 0.5 * vPhase) * exp(-r2 * 0.9);
    color = mix(vColor * 1.3, color, alpha);
    alpha = alpha + halo * (1.0 - alpha);

    float flare = flareAt(px);
    color = mix(color, vec3(1.0), flare);
    alpha = max(alpha, flare);

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(min(color, vec3(1.0)), alpha);
    #include <colorspace_fragment>
  }
`;

// Each trail is one line segment whose two ends are the same satellite at two
// instants: now, and uTrailSeconds ago. `position.x` says which end this is.
const trailVertexShader = /* glsl */ `
  uniform float uTrailSeconds;
  varying vec4 vColor;

  ${SHARED_GLSL}

  void main() {
    if (isHidden()) {
      gl_Position = OUTSIDE_CLIP_VOLUME;
      return;
    }

    float tail = position.x; // 0 at the satellite, 1 at the far end of its trail
    vec3 p = extrapolate(aPosition, aVelocity, uDt - tail * uTrailSeconds);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vColor = vec4(aColor * sunlight(p, uSunDirection, uShadowBrightness), (1.0 - tail) * 0.4);
    if (uLight > 0.5 && !isChosen()) {
      // The streak of a light: only where the light itself shows.
      float lit = sunlight(p, uSunDirection, 0.0);
      float shown = lightShown(uFaintest - magnitudeAt(p)) * lit;
      vColor = vec4(lightColor(lit), (1.0 - tail) * 0.3 * shown);
    }
  }
`;

const trailFragmentShader = /* glsl */ `
  varying vec4 vColor;

  void main() {
    gl_FragColor = vColor;
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function buildSatellites(world: World) {
  const { simulation, satellites } = world;
  const count = satellites.length;

  // The simulation's state buffer *is* the vertex data: position and velocity
  // interleaved, uploaded as-is whenever a new state arrives. It is instanced,
  // one entry per satellite, so the points (one vertex each) and the trails
  // (two vertices each) read the same GPU buffer.
  const stateBuffer = new InstancedInterleavedBuffer(simulation.state, STATE_STRIDE);
  stateBuffer.setUsage(DynamicDrawUsage);

  const sizes = Float32Array.from(satellites, (satellite) => TYPE_SIZES[satellite.objectType]);
  // Only working satellites have solar panels to glint; the seed tells each
  // one's panels apart. Debris and rocket bodies get none.
  const seeds = Float32Array.from(satellites, (satellite, i) =>
    satellite.objectType === 'payload' ? Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1 : -1,
  );

  // Filled in by the component, since both change while the app runs.
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const visibility = new InstancedBufferAttribute(new Uint8Array(count), 1);
  visibility.setUsage(DynamicDrawUsage);

  const perSatellite = {
    aPosition: new InterleavedBufferAttribute(stateBuffer, 3, 0),
    aVelocity: new InterleavedBufferAttribute(stateBuffer, 3, 3),
    aColor: colors,
    aVisible: visibility,
    aMagnitude: new InstancedBufferAttribute(world.standardMagnitudes, 1),
  };
  const instanced = (vertices: number[]) => {
    const geometry = new InstancedBufferGeometry();
    geometry.instanceCount = count;
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
    for (const [name, attribute] of Object.entries(perSatellite)) {
      geometry.setAttribute(name, attribute);
    }
    return geometry;
  };

  // Shared, so one assignment per frame updates both materials.
  const uniforms = {
    uDt: { value: 0 },
    // In the TEME frame, like the positions it is compared with.
    uSunDirection: { value: new Vector3(1, 0, 0) },
    uPixelRatio: { value: 1 },
    uTrailSeconds: { value: 0 },
    uShadowBrightness: { value: SHADOW_BRIGHTNESS.space as number },
    uMinSize: { value: MIN_POINT_SIZE.space as number },
    uGround: { value: 0 },
    uAspect: { value: 1 },
    uEye: { value: new Vector3() },
    uSkyDark: { value: 0 },
    uZoom: { value: 1 },
    uLight: { value: 0 },
    uFaintest: { value: 6 },
    uSelected: { value: -1 },
  };

  const pointGeometry = instanced([0, 0, 0]);
  pointGeometry.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
  pointGeometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  const points = new Points(
    pointGeometry,
    new ShaderMaterial({
      uniforms,
      vertexShader: pointVertexShader,
      fragmentShader: pointFragmentShader,
      transparent: true,
      depthWrite: false,
    }),
  );

  const trails = new LineSegments(
    instanced([0, 0, 0, 1, 0, 0]),
    new ShaderMaterial({
      uniforms,
      vertexShader: trailVertexShader,
      fragmentShader: trailFragmentShader,
      transparent: true,
      depthWrite: false,
    }),
  );
  trails.visible = false;

  // Positions change on the GPU every frame, so CPU bounding volumes would be wrong.
  points.frustumCulled = false;
  trails.frustumCulled = false;

  return { points, trails, uniforms, stateBuffer, colors, visibility };
}

/** The color of each satellite under the current color scheme, as packed RGB. */
function paint(
  world: World,
  colorBy: ColorBy,
  alone: ConstellationId | null,
  out: Float32Array,
): void {
  const color = new Color();
  for (let i = 0; i < world.satellites.length; i++) {
    color.set(satelliteColor(world, i, colorBy, alone)).toArray(out, i * 3);
  }
}

/**
 * Every satellite in one draw call, plus one more for their trails when time
 * is running fast. Also drives the simulation: each frame it lets the
 * simulation request a fresh state if needed, uploads the state when one has
 * arrived, and tells the shaders how far to extrapolate from it.
 */
export function Satellites({ world }: { world: World }) {
  const { points, trails, uniforms, stateBuffer, colors, visibility } = useMemo(
    () => buildSatellites(world),
    [world],
  );
  const visible = useApp((state) => state.visible);
  const colorBy = useApp((state) => state.colorBy);
  const alone = useApp((state) => soleEnabled(state.filters.constellations));

  useEffect(() => {
    paint(world, colorBy, alone, colors.array as Float32Array);
    colors.needsUpdate = true;
  }, [world, colorBy, alone, colors]);

  useEffect(() => {
    (visibility.array as Uint8Array).set(visible);
    visibility.needsUpdate = true;
  }, [visibility, visible]);

  useEffect(
    () => () => {
      for (const object of [points, trails]) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
    [points, trails],
  );

  const uploadedVersion = useRef(-1);
  useFrame(({ gl, camera, size }) => {
    const { simulation } = world;
    const { clock, skyShows, selected } = useApp.getState();
    simulation.update(clock, wallNow());
    if (uploadedVersion.current !== simulation.version) {
      uploadedVersion.current = simulation.version;
      stateBuffer.needsUpdate = true;
    }

    const simMs = currentSimTime();
    uniforms.uDt.value = simulation.dtSeconds(simMs);
    const sun = sunDirection(simMs, scratch);
    uniforms.uSunDirection.value.set(sun.x, sun.y, sun.z);
    uniforms.uPixelRatio.value = gl.getPixelRatio();
    // Brighter and bigger from the ground, eased in on the way down.
    const ground = groundView(camera.position.length() - 1);
    uniforms.uShadowBrightness.value = MathUtils.lerp(
      SHADOW_BRIGHTNESS.space,
      SHADOW_BRIGHTNESS.ground,
      ground,
    );
    uniforms.uMinSize.value = MathUtils.lerp(MIN_POINT_SIZE.space, MIN_POINT_SIZE.ground, ground);

    uniforms.uGround.value = ground;
    // Lighting from the ground: where the camera is, how dark its sky is.
    const eyeTeme = uniforms.uEye.value.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    const sunHeight =
      (sun.x * eyeTeme.x + sun.y * eyeTeme.y + sun.z * eyeTeme.z) / Math.max(1, eyeTeme.length());
    uniforms.uSkyDark.value = 1 - MathUtils.smoothstep(sunHeight, -0.17, -0.03);
    // Looking up, the satellites are the lights they are, unless all of
    // them are asked for.
    uniforms.uLight.value = ground > 0.5 && skyShows !== 'all' ? 1 : 0;
    if (skyShows !== 'all') {
      uniforms.uFaintest.value = faintestSeen(
        skyShows,
        MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunHeight, -1, 1))),
      );
    }
    uniforms.uSelected.value = selected ?? -1;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : SKY_FOV;
    uniforms.uZoom.value = MathUtils.clamp(
      Math.tan(MathUtils.degToRad(SKY_FOV) / 2) / Math.tan(MathUtils.degToRad(fov) / 2),
      1,
      4,
    );
    uniforms.uAspect.value = size.width / Math.max(1, size.height);
    // From the ground, always a short trail, behind the way time is running.
    const groundTrail = ground > 0.5 ? (clock.rate < 0 ? -1 : 1) * GROUND_TRAIL_SECONDS : 0;
    const fastTrail = trailSeconds(clock.rate);
    uniforms.uTrailSeconds.value =
      Math.abs(fastTrail) > Math.abs(groundTrail) ? fastTrail : groundTrail;
    trails.visible = uniforms.uTrailSeconds.value !== 0;
  });

  return (
    <>
      <primitive object={trails} />
      <primitive object={points} />
    </>
  );
}
