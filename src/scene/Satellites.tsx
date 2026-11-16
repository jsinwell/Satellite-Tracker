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
} from 'three';
import { TYPE_COLORS } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import type { ObjectType } from '../core/catalog';
import { wallNow } from '../core/clock';
import { EARTH_MU } from '../core/constants';
import { STATE_STRIDE } from '../core/propagator';

/** Relative point size by object type; debris is drawn smaller so payloads read first. */
const TYPE_SIZES: Record<ObjectType, number> = {
  payload: 1,
  'rocket-body': 1,
  debris: 0.7,
  unknown: 0.8,
};

// The extrapolation here must match `extrapolatePosition` in core/kinematics.ts.
const vertexShader = /* glsl */ `
  attribute vec3 aVelocity;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aVisible;

  uniform float uDt;
  uniform float uPixelRatio;

  varying vec3 vColor;

  const float MU = ${EARTH_MU.toFixed(4)};

  void main() {
    float r2 = dot(position, position);
    // An all-zero position means "no state"; see Propagator.propagate.
    if (aVisible < 0.5 || r2 == 0.0) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume
      gl_PointSize = 0.0;
      return;
    }

    vec3 acceleration = -MU * position / (r2 * sqrt(r2));
    vec3 p = position + aVelocity * uDt + 0.5 * acceleration * uDt * uDt;

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    // Shrink with distance (in Earth radii), but never below a visible dot.
    float size = clamp(aSize * 9.0 / -viewPosition.z, 1.6, 6.0);
    gl_PointSize = size * uPixelRatio;
    vColor = aColor;
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
    uniforms: { uDt: { value: 0 }, uPixelRatio: { value: 1 } },
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
    material.uniforms.uDt.value = simulation.dtSeconds(currentSimTime());
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
  });

  return <primitive object={points} />;
}
