import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, ShaderMaterial, SRGBColorSpace, TextureLoader } from 'three';
import { currentSimTime } from '../app/store';
import { gmst } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphereGlsl';
import { SPHERE_POLES_TO_Z } from './frame';
import { landscapeUniforms } from './landscapeGlsl';

const DAY_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_day_4096.jpg`;
const NIGHT_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_night_4096.jpg`;

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

  ${ATMOSPHERE_GLSL}

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    float sun = dot(normal, uSkySun);
    // In an eclipse, only as much daylight as the Moon leaves: the shadow is
    // dark enough at its core to bring out the city lights.
    float left = 1.0 - sunHiddenByMoon(vWorldPosition, uSkySunPosition, uSkyMoonPosition);

    vec3 day = texture2D(uDayMap, vUv).rgb;
    vec3 night = texture2D(uNightMap, vUv).rgb;

    // Sunlight as it reaches the ground: through more air the lower the Sun,
    // so warmer toward the edge of night. Not as red as the Sun itself gets,
    // since about half of what the air takes out of the beam still comes
    // down, from the rest of the sky. And the light of the sky after sunset,
    // which lasts a little way into twilight. Both relative to noon, which
    // is what the map is painted for.
    vec3 overhead = skyTransmittanceToTop(SKY_BOTTOM, 1.0);
    vec3 direct = (skySunlight(SKY_BOTTOM, sun) + smoothstep(-0.02, 0.05, sun)) / (overhead + 1.0);
    vec3 skylight = skyMultiscatter(SKY_BOTTOM, sun) / skyMultiscatter(SKY_BOTTOM, 1.0);
    vec3 lit = day * (0.8 * direct * max(sun, 0.0) + 0.3 * skylight) * left;
    // Keep a trace of the surface at night so satellites there have context.
    vec3 unlit = day * 0.04 + night * 0.9;
    vec3 color = lit + unlit * (1.0 - smoothstep(-0.1, 0.15, sun) * left);

    // The air between here and the camera: it dims what is behind it and
    // adds its own light, the blue haze over the day side.
    vec3 direction = normalize(vWorldPosition - cameraPosition);
    float start;
    float end;
    bool ground;
    if (skySpan(direction, start, end, ground)) {
      vec3 air;
      vec3 through;
      skyView(direction, ground, air, through);
      color = skyAdd(air, color * through);
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The Earth, lit by the real Sun position and turned to the real sidereal
 * angle, so the day/night line and the ground under each satellite are right
 * for the simulated instant, and seen through the air over it. The air
 * beyond its edge, the blue rim, is drawn by `Atmosphere`. Lives inside the
 * TEME group; see `frame.ts`.
 */
export function Earth() {
  const [dayMap, nightMap] = useLoader(TextureLoader, [DAY_MAP_URL, NIGHT_MAP_URL]);
  const spin = useRef<Group>(null);

  const material = useMemo(() => {
    for (const map of [dayMap, nightMap]) {
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
    }
    // Made here, not as an element: see `atmosphereUniforms`.
    return new ShaderMaterial({
      uniforms: {
        ...atmosphereUniforms(),
        uDayMap: { value: dayMap },
        uNightMap: { value: nightMap },
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
    });
  }, [dayMap, nightMap]);
  useEffect(() => () => material.dispose(), [material]);

  // The same maps say what the ground is like, looking up from it.
  useEffect(() => {
    const landscape = landscapeUniforms();
    landscape.uLandDay.value = dayMap;
    landscape.uLandNight.value = nightMap;
    landscape.uLandMapped.value = 1;
    return () => {
      landscape.uLandMapped.value = 0;
      landscape.uLandDay.value = null;
      landscape.uLandNight.value = null;
    };
  }, [dayMap, nightMap]);

  useFrame(() => {
    if (spin.current) spin.current.rotation.z = gmst(currentSimTime());
  });

  return (
    <group ref={spin}>
      {/* Earth-fixed axes: z through the north pole, x through 0° longitude. */}
      <mesh rotation={[...SPHERE_POLES_TO_Z]}>
        <sphereGeometry args={[EARTH_RADIUS_KM, 128, 64]} />
        <primitive object={material} attach="material" />
      </mesh>
    </group>
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
