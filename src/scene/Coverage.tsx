import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { COVERAGE_COLOR, GROUND_TRACK_COLOR } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { horizonAngle } from '../core/ground';
import { extrapolatePosition, hasState, type Vec3 } from '../core/kinematics';
import { GROUND_LINE_RADIUS_KM, OVERLAY_ORDER } from './frame';
import { GroundDots } from './GroundDots';
import { ScreenLine } from './ScreenLine';

const vertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Everything within an angle of the point beneath the satellite, as measured
// from the Earth's center, has it above the horizon. Drawn on a shell just
// above the ground, as a faint fill that deepens toward a sharp edge. The edge
// is measured in screen pixels, so it stays a crisp line at any distance.
const fragmentShader = /* glsl */ `
  uniform vec3 uCenter;
  uniform float uCosRadius;
  uniform vec3 uColor;

  varying vec3 vDirection;

  void main() {
    float d = dot(normalize(vDirection), uCenter);
    float inward = (d - uCosRadius) / fwidth(d);
    float edge = 1.0 - smoothstep(0.75, 1.75, abs(inward));
    float inside = clamp(inward + 0.5, 0.0, 1.0);
    float outward = clamp((1.0 - d) / max(1.0 - uCosRadius, 1e-6), 0.0, 1.0);
    float fill = inside * (0.05 + 0.13 * outward * outward * outward);
    float alpha = max(0.9 * edge, fill);
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Where the selected satellite is over the ground right now: its coverage,
 * the region that has it above the horizon, and a line dropped from it to the
 * point directly beneath it, where its ground track starts.
 */
export function Coverage({ world }: { world: World }) {
  const { shell, material, drop, beneath } = useMemo(() => {
    const material = new ShaderMaterial({
      uniforms: {
        uCenter: { value: new Vector3(1, 0, 0) },
        uCosRadius: { value: 1 },
        uColor: { value: new Color(COVERAGE_COLOR) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const shell = new Mesh(new SphereGeometry(GROUND_LINE_RADIUS_KM, 160, 80), material);
    shell.renderOrder = OVERLAY_ORDER.coverage;

    const drop = new ScreenLine({ capacity: 2, width: 1.25, color: GROUND_TRACK_COLOR });
    // Faint at the satellite, firmer where it meets the ground.
    drop.alphas.set([0.15, 0.6]);
    drop.renderOrder = OVERLAY_ORDER.groundTrack;

    const beneath = new GroundDots(1, GROUND_TRACK_COLOR);
    beneath.sizes[0] = 9;
    beneath.renderOrder = OVERLAY_ORDER.marks;

    for (const object of [shell, drop, beneath]) object.visible = false;
    return { shell, material, drop, beneath };
  }, []);

  useEffect(
    () => () => {
      shell.geometry.dispose();
      material.dispose();
      drop.dispose();
      beneath.dispose();
    },
    [shell, material, drop, beneath],
  );

  useFrame(() => {
    const { selected, overlays, lookingUp } = useApp.getState();
    const { simulation } = world;
    // Drawn just above the ground, which from the ground is overhead.
    const present = selected !== null && hasState(simulation.state, selected) && !lookingUp;
    shell.visible = present && overlays.coverage;
    drop.visible = present && (overlays.coverage || overlays.groundTrack);
    beneath.visible = drop.visible;
    if (selected === null || !(shell.visible || drop.visible)) return;

    const dt = simulation.dtSeconds(currentSimTime());
    const p = extrapolatePosition(simulation.state, selected, dt, scratch);
    const distance = Math.hypot(p.x, p.y, p.z);

    material.uniforms.uCenter.value.set(p.x, p.y, p.z).divideScalar(distance);
    material.uniforms.uCosRadius.value = Math.cos(horizonAngle(distance));

    const toGround = GROUND_LINE_RADIUS_KM / distance;
    drop.positions.set([p.x, p.y, p.z, p.x * toGround, p.y * toGround, p.z * toGround]);
    drop.update(2);
    beneath.positions.set(drop.positions.subarray(3, 6));
    beneath.update(1);
  });

  return (
    <>
      <primitive object={shell} />
      <primitive object={drop} />
      <primitive object={beneath} />
    </>
  );
}
