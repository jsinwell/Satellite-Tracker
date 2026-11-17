import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { extrapolatePosition, hasState, type Vec3 } from '../core/kinematics';
import { OVERLAY_ORDER } from './frame';

const vertexShader = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.66, 0.76, d) * (1.0 - smoothstep(0.9, 1.0, d));
    if (ring <= 0.0) discard;
    gl_FragColor = vec4(uColor, ring);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

interface MarkerProps {
  world: World;
  /** Which satellite to follow. */
  target: 'selected' | 'hovered';
  color: string;
  /** Ring diameter in CSS pixels. */
  size: number;
}

/** A screen-space ring that follows one satellite. */
export function Marker({ world, target, color, size }: MarkerProps) {
  const { points, position, material } = useMemo(() => {
    const position = new BufferAttribute(new Float32Array(3), 3);
    const geometry = new BufferGeometry().setAttribute('position', position);
    const material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(color) },
        uSize: { value: size },
        uPixelRatio: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = OVERLAY_ORDER.marker;
    points.visible = false;
    return { points, position, material };
  }, [color, size]);

  useEffect(
    () => () => {
      points.geometry.dispose();
      material.dispose();
    },
    [points, material],
  );

  useFrame(({ gl }) => {
    const index = useApp.getState()[target];
    const { simulation } = world;
    if (index === null || !hasState(simulation.state, index)) {
      points.visible = false;
      return;
    }
    const dt = simulation.dtSeconds(currentSimTime());
    const p = extrapolatePosition(simulation.state, index, dt, scratch);
    position.setXYZ(0, p.x, p.y, p.z);
    position.needsUpdate = true;
    material.uniforms.uPixelRatio.value = gl.getPixelRatio();
    points.visible = true;
  });

  return <primitive object={points} />;
}
