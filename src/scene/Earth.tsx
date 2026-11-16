import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BackSide,
  type Group,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { currentSimTime } from '../app/store';
import { gmst, sunDirection } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import type { Vec3 } from '../core/kinematics';
import { directionToWorld } from './frame';

const DAY_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_day_4096.jpg`;
const NIGHT_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_night_4096.jpg`;

/** The glow shell's radius relative to the Earth's. */
const ATMOSPHERE_SCALE = 1.15;

/**
 * SphereGeometry puts its poles on ±y and the texture's center column
 * (the Greenwich meridian) on +x. Tipping it onto +z gives Earth-fixed axes:
 * z through the north pole, x through 0° longitude, y through 90° east.
 */
const SPHERE_TO_EARTH_FIXED = [Math.PI / 2, 0, 0] as const;

const surfaceVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const surfaceFragmentShader = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform vec3 uSunDirection;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 toCamera = normalize(cameraPosition - vWorldPosition);
    float sun = dot(normal, uSunDirection);
    // A soft terminator, roughly the width of civil twilight.
    float daylight = smoothstep(-0.1, 0.15, sun);

    vec3 day = texture2D(uDayMap, vUv).rgb;
    vec3 night = texture2D(uNightMap, vUv).rgb;

    vec3 lit = day * (0.3 + 0.8 * max(sun, 0.0));
    // Keep a trace of the surface at night so satellites there have context.
    vec3 unlit = day * 0.04 + night * 0.9;
    vec3 color = mix(unlit, lit, daylight);

    float rim = pow(1.0 - max(dot(normal, toCamera), 0.0), 3.5);
    color += vec3(0.3, 0.55, 1.0) * rim * (0.08 + 0.5 * daylight);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const atmosphereVertexShader = /* glsl */ `
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;

  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Drawn on the shell's back faces, so only the part beyond the Earth's limb
// survives the depth test. Facing-ness runs from 0 at the shell's silhouette
// to LIMB at the Earth's edge; the glow fades across that band.
const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uSunDirection;

  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;

  const float LIMB = ${Math.sqrt(1 - 1 / ATMOSPHERE_SCALE ** 2).toFixed(4)};

  void main() {
    float facing = clamp(-normalize(vViewNormal).z / LIMB, 0.0, 1.0);
    float glow = pow(facing, 3.0);
    float sunward = smoothstep(-0.4, 0.5, dot(normalize(vWorldNormal), uSunDirection));
    gl_FragColor = vec4(vec3(0.3, 0.55, 1.0) * glow * (0.12 + 0.7 * sunward), 1.0);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The Earth, lit by the real Sun position and turned to the real sidereal
 * angle, so the day/night line and the ground under each satellite are right
 * for the simulated instant. Lives inside the TEME group; see `frame.ts`.
 */
export function Earth() {
  const [dayMap, nightMap] = useLoader(TextureLoader, [DAY_MAP_URL, NIGHT_MAP_URL]);
  const spin = useRef<Group>(null);

  const uniforms = useMemo(() => {
    for (const map of [dayMap, nightMap]) {
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
    }
    // One vector shared by both materials, updated in place every frame.
    const uSunDirection = { value: new Vector3(1, 0, 0) };
    return {
      surface: { uDayMap: { value: dayMap }, uNightMap: { value: nightMap }, uSunDirection },
      atmosphere: { uSunDirection },
    };
  }, [dayMap, nightMap]);

  useFrame(() => {
    const simMs = currentSimTime();
    if (spin.current) spin.current.rotation.z = gmst(simMs);
    directionToWorld(sunDirection(simMs, scratch), uniforms.surface.uSunDirection.value);
  });

  return (
    <>
      <group ref={spin}>
        <mesh rotation={SPHERE_TO_EARTH_FIXED}>
          <sphereGeometry args={[EARTH_RADIUS_KM, 128, 64]} />
          <shaderMaterial
            uniforms={uniforms.surface}
            vertexShader={surfaceVertexShader}
            fragmentShader={surfaceFragmentShader}
          />
        </mesh>
      </group>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS_KM * ATMOSPHERE_SCALE, 64, 32]} />
        <shaderMaterial
          uniforms={uniforms.atmosphere}
          vertexShader={atmosphereVertexShader}
          fragmentShader={atmosphereFragmentShader}
          side={BackSide}
          blending={AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/** Stands in while the textures load, so satellites are occluded from the first frame. */
export function EarthPlaceholder() {
  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS_KM, 64, 32]} />
      <meshBasicMaterial color="#0b1626" />
    </mesh>
  );
}
