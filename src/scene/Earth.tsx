import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BackSide,
  type Group,
  type Mesh,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { currentSimTime } from '../app/store';
import { gmst, moonPosition, sunDirection, sunPosition } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import type { Vec3 } from '../core/kinematics';
import { ECLIPSE_GLSL } from './eclipseGlsl';
import { directionToWorld, SPHERE_POLES_TO_Z } from './frame';
import { DOME_FADE } from './SkyDome';

const DAY_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_day_4096.jpg`;
const NIGHT_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_night_4096.jpg`;

/** The glow shell's radius relative to the Earth's. */
const ATMOSPHERE_SCALE = 1.15;

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
  // Where the Sun and Moon really are, for the Moon's shadow in an eclipse.
  uniform vec3 uSun;
  uniform vec3 uMoon;

  ${ECLIPSE_GLSL}

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 toCamera = normalize(cameraPosition - vWorldPosition);
    float sun = dot(normal, uSunDirection);
    // A soft terminator, roughly the width of civil twilight, and in an
    // eclipse only as much daylight as the Moon leaves: the shadow is dark
    // enough at its core to bring out the city lights.
    float daylight = smoothstep(-0.1, 0.15, sun) * (1.0 - sunHiddenByMoon(vWorldPosition, uSun, uMoon));

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
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

// Drawn on the shell's back faces, so only the part beyond the Earth's limb
// survives the depth test. The glow depends on how low each line of sight
// dips: brightest grazing the Earth's edge, gone where it only clips the top
// of the atmosphere. World units are Earth radii, so the Earth's edge is at 1.
//
// The shell is far deeper than the real atmosphere, which from a distance
// would be a hairline. Up close that depth would fill the sky, so the glow
// stops lower as the camera comes down: never above a third of the camera's own
// altitude. The camera is then always above it, looking at a band along the
// horizon, as from orbit.
const atmosphereFragmentShader = /* glsl */ `
  uniform vec3 uSunDirection;

  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  const float SHELL = ${ATMOSPHERE_SCALE.toFixed(4)};

  void main() {
    vec3 ray = normalize(vWorldPosition - cameraPosition);
    float height = length(cameraPosition);
    float top = 1.0 + clamp((height - 1.0) / 3.0, 0.001, SHELL - 1.0);
    // How far along the ray it passes closest to the Earth's center, and how
    // close that is. Looking upward, the camera is itself the lowest point.
    float along = -dot(cameraPosition, ray);
    float lowest = along > 0.0 ? length(cameraPosition + along * ray) : height;
    // From 1 for a ray grazing the Earth to 0 for one grazing the top.
    float facing = sqrt(clamp((1.0 - pow(lowest / top, 2.0)) / (1.0 - 1.0 / (top * top)), 0.0, 1.0));
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
  const atmosphere = useRef<Mesh>(null);

  const uniforms = useMemo(() => {
    for (const map of [dayMap, nightMap]) {
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
    }
    // One vector shared by both materials, updated in place every frame.
    const uSunDirection = { value: new Vector3(1, 0, 0) };
    return {
      surface: {
        uDayMap: { value: dayMap },
        uNightMap: { value: nightMap },
        uSunDirection,
        uSun: { value: new Vector3() },
        uMoon: { value: new Vector3() },
      },
      atmosphere: { uSunDirection },
    };
  }, [dayMap, nightMap]);

  useFrame(({ camera }) => {
    const simMs = currentSimTime();
    // Within a few kilometers of the ground the camera is inside the glow,
    // which would fill the whole sky; the sky dome draws the sky there instead.
    if (atmosphere.current) {
      atmosphere.current.visible = camera.position.length() - 1 > DOME_FADE.full;
    }
    if (spin.current) spin.current.rotation.z = gmst(simMs);
    directionToWorld(sunDirection(simMs, scratch), uniforms.surface.uSunDirection.value);
    const { uSun, uMoon } = uniforms.surface;
    directionToWorld(sunPosition(simMs, scratch), uSun.value).divideScalar(EARTH_RADIUS_KM);
    directionToWorld(moonPosition(simMs, scratch), uMoon.value).divideScalar(EARTH_RADIUS_KM);
  });

  return (
    <>
      <group ref={spin}>
        {/* Earth-fixed axes: z through the north pole, x through 0° longitude. */}
        <mesh rotation={[...SPHERE_POLES_TO_Z]}>
          <sphereGeometry args={[EARTH_RADIUS_KM, 128, 64]} />
          <shaderMaterial
            uniforms={uniforms.surface}
            vertexShader={surfaceVertexShader}
            fragmentShader={surfaceFragmentShader}
          />
        </mesh>
      </group>
      <mesh ref={atmosphere}>
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
