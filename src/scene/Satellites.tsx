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
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { satelliteColor } from '../app/palette';
import { type ColorBy, currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import type { ObjectType } from '../core/catalog';
import { wallNow } from '../core/clock';
import { type ConstellationId, soleEnabled } from '../core/constellation';
import { trailSeconds, type Vec3 } from '../core/kinematics';
import { STATE_STRIDE } from '../core/propagator';
import { ORBIT_GLSL, SHADOW_BRIGHTNESS } from './orbitGlsl';
import { groundView } from './SkyDome';

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
/**
 * Looking up, every satellite trails where it was this many simulated seconds
 * ago, even at real speed or paused: the motion is what gives a satellite
 * away among the stars. Three seconds is a few degrees for one passing over.
 */
const GROUND_TRAIL_SECONDS = 3;

// Both shaders read the same per-satellite attributes; see `buildSatellites`.
const SHARED_GLSL = /* glsl */ `
  attribute vec3 aPosition;
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aVisible;

  uniform float uDt;
  uniform vec3 uSunDirection;
  uniform float uShadowBrightness;

  ${ORBIT_GLSL}

  // An all-zero position means "no state"; see Propagator.propagate.
  bool isHidden() {
    return aVisible < 0.5 || dot(aPosition, aPosition) == 0.0;
  }

  const vec4 OUTSIDE_CLIP_VOLUME = vec4(0.0, 0.0, 2.0, 1.0);
`;

const pointVertexShader = /* glsl */ `
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uMinSize;
  /** 1 looking up from the ground, 0 out in space; see \`groundView\`. */
  uniform float uGround;
  /** The view's width over its height, to turn clip space into screen directions. */
  uniform float uAspect;
  varying vec3 vColor;
  varying float vSize;
  varying vec2 vHeading;

  ${SHARED_GLSL}

  void main() {
    if (isHidden()) {
      gl_Position = OUTSIDE_CLIP_VOLUME;
      gl_PointSize = 0.0;
      return;
    }

    vec3 p = extrapolate(aPosition, aVelocity, uDt);
    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // From space, a dot that shrinks with distance (in Earth radii) but never
    // below a visible size. From the ground, big enough to show a satellite's
    // shape: largest for those passing close overhead.
    float distance = -viewPosition.z;
    float size = uGround > 0.5
      ? clamp(aSize * 1.6 / distance, ${GLYPH_SIZE.min.toFixed(1)}, ${GLYPH_SIZE.max.toFixed(1)})
      : clamp(aSize * 9.0 / distance, uMinSize, 6.0);
    vSize = size * uPixelRatio;
    gl_PointSize = vSize;
    // Satellites dim as they pass into the Earth's shadow.
    vColor = aColor * sunlight(p, uSunDirection, uShadowBrightness);

    // Which way it is crossing the screen: where it will be a second from now.
    vec4 ahead = projectionMatrix * modelViewMatrix * vec4(extrapolate(aPosition, aVelocity, uDt + 1.0), 1.0);
    vec2 travel = (ahead.xy / ahead.w - gl_Position.xy / gl_Position.w) * vec2(uAspect, 1.0);
    vHeading = dot(travel, travel) > 0.0 ? normalize(travel) : vec2(1.0, 0.0);
  }
`;

const pointFragmentShader = /* glsl */ `
  uniform float uGround;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vSize;
  varying vec2 vHeading;

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

    // Looking up, a satellite is drawn as one: a body pointed the way it is
    // going, with a solar panel out to either side; too far off for that, a
    // diamond. Stars are round, so the shape, and the trail behind it, are
    // what set a satellite apart from them.
    c.y = -c.y; // point coordinates run downward; the heading is upward
    vec2 q = 2.0 * vec2(dot(c, vHeading), dot(c, vec2(-vHeading.y, vHeading.x)));
    float pixel = 2.0 / vSize;
    float shape;
    vec3 fill = vColor;
    if (vSize < ${GLYPH_SIZE.outline.toFixed(1)} * uPixelRatio) {
      shape = (abs(q.x) + abs(q.y) - 0.8) * 0.7071;
    } else {
      float body = box(q, vec2(0.26, 0.2));
      float panels = min(box(q - vec2(0.0, 0.58), vec2(0.17, 0.34)), box(q + vec2(0.0, 0.58), vec2(0.17, 0.34)));
      float strut = box(q, vec2(0.04, 0.3));
      shape = min(min(body, panels), strut);
      if (panels < min(body, strut)) fill *= vec3(0.62, 0.72, 0.95);
    }
    // A thin, soft dark rim keeps it readable against a bright sky as well as
    // a dark one without swallowing the small ones.
    float alpha = 1.0 - smoothstep(0.0, pixel, shape - 0.6 * pixel);
    if (alpha <= 0.0) discard;
    float inside = 1.0 - smoothstep(-pixel, 0.0, shape);
    gl_FragColor = vec4(mix(vec3(0.02, 0.03, 0.06), fill, inside), alpha * mix(0.6, 1.0, inside));
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

  // Filled in by the component, since both change while the app runs.
  const colors = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const visibility = new InstancedBufferAttribute(new Uint8Array(count), 1);
  visibility.setUsage(DynamicDrawUsage);

  const perSatellite = {
    aPosition: new InterleavedBufferAttribute(stateBuffer, 3, 0),
    aVelocity: new InterleavedBufferAttribute(stateBuffer, 3, 3),
    aColor: colors,
    aVisible: visibility,
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
  };

  const pointGeometry = instanced([0, 0, 0]);
  pointGeometry.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
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
    const { clock } = useApp.getState();
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
