import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { TYPE_COLORS } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import type { ObjectType } from '../core/catalog';
import { wallNow } from '../core/clock';
import type { Vec3 } from '../core/kinematics';
import { STATE_STRIDE } from '../core/propagator';
import { ORBIT_GLSL } from './orbitGlsl';

/** Relative point size by object type; debris is drawn smaller so payloads read first. */
const TYPE_SIZES: Record<ObjectType, number> = {
  payload: 1,
  'rocket-body': 1,
  debris: 0.7,
  unknown: 0.8,
};

const vertexShader = /* glsl */ `
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aVisible;

  uniform float uDt;
  uniform float uPixelRatio;
  uniform vec3 uSunDirection;

  varying vec3 vColor;

  ${ORBIT_GLSL}

  void main() {
    float r2 = dot(position, position);
    // An all-zero position means "no state"; see Propagator.propagate.
    if (aVisible < 0.5 || r2 == 0.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume
      gl_PointSize = 0.0;
      return;
    }

    vec3 p = extrapolate(position, aVelocity, uDt);

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // Shrink with distance (in Earth radii), but never below a visible dot.
    float size = clamp(aSize * 9.0 / -viewPosition.z, 1.6, 6.0);
    gl_PointSize = size * uPixelRatio;
    // Satellites dim as they pass into the Earth's shadow.
    vColor = aColor * sunlight(p, uSunDirection);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = 1.0 - smoothstep(0.3, 0.5, d);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, alpha * 0.9);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function buildPoints(world: World) {
  const { simulation, satellites } = world;
  const count = satellites.length;

  // The simulation's state buffer *is* the vertex buffer: position and
  // velocity interleaved, uploaded as-is whenever a new state arrives.
  const stateBuffer = new InterleavedBuffer(simulation.state, STATE_STRIDE);
  stateBuffer.setUsage(DynamicDrawUsage);

  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const color = new Color();
  satellites.forEach((satellite, i) => {
    color.set(TYPE_COLORS[satellite.objectType]).toArray(colors, i * 3);
    sizes[i] = TYPE_SIZES[satellite.objectType];
  });

  const visibility = new BufferAttribute(new Uint8Array(count), 1);
  visibility.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new InterleavedBufferAttribute(stateBuffer, 3, 0));
  geometry.setAttribute('aVelocity', new InterleavedBufferAttribute(stateBuffer, 3, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aVisible', visibility);

  const material = new ShaderMaterial({
    uniforms: {
      uDt: { value: 0 },
      uPixelRatio: { value: 1 },
      // In the TEME frame, like the positions it is compared with.
      uSunDirection: { value: new Vector3(1, 0, 0) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
  // Positions change on the GPU every frame, so a CPU bounding sphere would be wrong.
  points.frustumCulled = false;

  return { points, geometry, material, stateBuffer, visibility };
}

/**
 * Every satellite as one draw call. Also drives the simulation: each frame it
 * lets the simulation request a fresh state if needed, uploads the state when
 * one has arrived, and tells the shader how far to extrapolate from it.
 */
export function Satellites({ world }: { world: World }) {
  const { points, geometry, material, stateBuffer, visibility } = useMemo(
    () => buildPoints(world),
    [world],
  );
  const visible = useApp((state) => state.visible);

  useEffect(() => {
    (visibility.array as Uint8Array).set(visible);
    visibility.needsUpdate = true;
  }, [visibility, visible]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const uploadedVersion = useRef(-1);
  useFrame(({ gl }) => {
    const { simulation } = world;
    simulation.update(useApp.getState().clock, wallNow());
    if (uploadedVersion.current !== simulation.version) {
      uploadedVersion.current = simulation.version;
      stateBuffer.needsUpdate = true;
    }
    const simMs = currentSimTime();
    material.uniforms.uDt.value = simulation.dtSeconds(simMs);
    const sun = sunDirection(simMs, scratch);
    material.uniforms.uSunDirection.value.set(sun.x, sun.y, sun.z);
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <primitive object={points} />;
}
