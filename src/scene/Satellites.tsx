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
import { ORBIT_GLSL } from './orbitGlsl';

/** Relative point size by object type; debris is drawn smaller so payloads read first. */
const TYPE_SIZES: Record<ObjectType, number> = {
  payload: 1,
  'rocket-body': 1,
  debris: 0.7,
  unknown: 0.8,
};

// Both shaders read the same per-satellite attributes; see `buildSatellites`.
const SHARED_GLSL = /* glsl */ `
  attribute vec3 aPosition;
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aVisible;

  uniform float uDt;
  uniform vec3 uSunDirection;

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
  varying vec3 vColor;

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

    // Shrink with distance (in Earth radii), but never below a visible dot.
    float size = clamp(aSize * 9.0 / -viewPosition.z, 1.6, 6.0);
    gl_PointSize = size * uPixelRatio;
    // Satellites dim as they pass into the Earth's shadow.
    vColor = aColor * sunlight(p, uSunDirection);
  }
`;

const pointFragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.3, 0.5, d);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, alpha * 0.9);
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
    vColor = vec4(aColor * sunlight(p, uSunDirection), (1.0 - tail) * 0.4);
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
  useFrame(({ gl }) => {
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

    uniforms.uTrailSeconds.value = trailSeconds(clock.rate);
    trails.visible = uniforms.uTrailSeconds.value !== 0;
  });

  return (
    <>
      <primitive object={trails} />
      <primitive object={points} />
    </>
  );
}
