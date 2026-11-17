import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { currentSimTime } from '../app/store';
import { sunDirection } from '../core/astro';
import type { Vec3 } from '../core/kinematics';
import { directionToWorld, OVERLAY_ORDER } from './frame';

/**
 * The dome fades in from the first of these heights above the ground (Earth
 * radii: about 60 km and 13 km) to the second, where the atmosphere shell is
 * switched off for it.
 */
export const DOME_FADE = { start: 0.01, full: 0.002 } as const;

/**
 * How far the view has gone over to the ground's, from 0 at or above the
 * first `DOME_FADE` height to 1 at or below the second. `height` is above the
 * ground, in Earth radii.
 */
export function groundView(height: number): number {
  return (
    1 - Math.min(1, Math.max(0, (height - DOME_FADE.full) / (DOME_FADE.start - DOME_FADE.full)))
  );
}

const vertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Colors are linear; the output is converted to sRGB, which lightens them.
const fragmentShader = /* glsl */ `
  uniform vec3 uUp;
  uniform vec3 uSun;
  uniform float uOpacity;

  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float height = dot(direction, uUp);
    float sunHeight = dot(uSun, uUp);
    // Full day with the Sun up; night once it is 12° down; twilight between.
    float day = smoothstep(-0.10, 0.05, sunHeight);
    float twilight = smoothstep(-0.21, -0.03, sunHeight) * (1.0 - day);
    float up = max(height, 0.0);
    float low = pow(1.0 - up, 4.0);

    // Night: black, with a faint haze along the horizon.
    vec3 color = vec3(0.012, 0.016, 0.03);
    float alpha = 0.35 * pow(1.0 - up, 10.0);

    // Twilight: deep blue overhead, warm low down on the Sun's side.
    vec3 level = normalize(uSun - sunHeight * uUp + 1e-6 * uUp);
    float sunward = pow(max(dot(normalize(direction - height * uUp + 1e-6 * uUp), level), 0.0), 3.0);
    vec3 dusk = mix(vec3(0.01, 0.02, 0.07), vec3(0.45, 0.17, 0.05), sunward * low);
    color = mix(color, dusk, twilight);
    alpha = mix(alpha, 0.55 + 0.3 * low, twilight);

    // Day: blue, paler toward the horizon. Not quite opaque: the stars and
    // satellites still show faintly, since this is a map of them, not a photo.
    vec3 blue = mix(vec3(0.07, 0.2, 0.6), vec3(0.4, 0.55, 0.8), low);
    color = mix(color, blue, day);
    alpha = mix(alpha, 0.82, day);

    // The ground, dark, with the horizon softened over a fraction of a degree.
    float ground = 1.0 - smoothstep(-0.006, 0.0, height);
    #ifdef GROUND
      color = mix(vec3(0.004, 0.005, 0.007), vec3(0.03, 0.035, 0.03), day);
      alpha = ground;
    #else
      alpha *= 1.0 - ground;
    #endif

    gl_FragColor = vec4(color, alpha * uOpacity);
    #include <colorspace_fragment>
  }
`;

const sun: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The sky and ground as seen from the ground: a sphere around the camera,
 * drawn when it is close to the Earth's surface. Everything below the horizon
 * is hidden behind dark ground, rather than the Earth's map blown up past
 * recognition, and the sky takes the color the Sun's height gives it.
 *
 * It is drawn twice. The sky goes behind the satellites, Sun and Moon; the
 * ground goes in front of everything. The Earth itself cannot be trusted to
 * hide what is below the horizon from this close: it is drawn as a polygon,
 * whose flat faces sag up to 2 km inside the true sphere, more than the eye's
 * height, and that lowers the horizon by a degree or two.
 */
export function SkyDome() {
  const { sky, ground, uniforms } = useMemo(() => {
    const uniforms = {
      uUp: { value: new Vector3(0, 1, 0) },
      uSun: { value: new Vector3(1, 0, 0) },
      uOpacity: { value: 0 },
    };
    // Inside the closest satellite, outside the near clipping plane.
    const geometry = new SphereGeometry(0.005, 64, 32);
    const part = (defines: Record<string, string>, renderOrder: number) => {
      const mesh = new Mesh(
        geometry,
        new ShaderMaterial({
          uniforms,
          defines,
          vertexShader,
          fragmentShader,
          side: BackSide,
          transparent: true,
          depthWrite: false,
          // It surrounds the camera, so it is in front of everything.
          depthTest: false,
        }),
      );
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      mesh.visible = false;
      return mesh;
    };
    return {
      // After the star map and the Earth, before the satellites, Sun and Moon.
      sky: part({}, -0.5),
      // After everything, the selection ring included.
      ground: part({ GROUND: '' }, OVERLAY_ORDER.marker + 1),
      uniforms,
    };
  }, []);

  useEffect(
    () => () => {
      sky.geometry.dispose();
      sky.material.dispose();
      ground.material.dispose();
    },
    [sky, ground],
  );

  useFrame(({ camera }) => {
    const opacity = groundView(camera.position.length() - 1);
    sky.visible = opacity > 0;
    ground.visible = sky.visible;
    if (!sky.visible) return;
    sky.position.copy(camera.position);
    ground.position.copy(camera.position);
    uniforms.uOpacity.value = opacity;
    uniforms.uUp.value.copy(camera.position).normalize();
    directionToWorld(sunDirection(currentSimTime(), sun), uniforms.uSun.value);
  });

  return (
    <>
      <primitive object={sky} />
      <primitive object={ground} />
    </>
  );
}
