import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  type Group,
  NoColorSpace,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';
import { currentSimTime, useApp } from '../app/store';
import { gmst } from '../core/astro';
import { CLOUD_COVER, CLOUD_LATITUDES, CLOUD_MAPS } from '../core/clouds';
import { EARTH_RADIUS_KM } from '../core/constants';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphereGlsl';
import { SPHERE_POLES_TO_Z } from './frame';
import { landscapeUniforms } from './landscapeGlsl';

const DAY_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_day_4096.jpg`;
const NIGHT_MAP_URL = `${import.meta.env.BASE_URL}textures/earth_night_4096.jpg`;
const CLOUD_MAP_URL = (file: string) => `${import.meta.env.BASE_URL}data/${file}`;
/** How fast the clouds come and go when they are switched on or off, per second. */
const CLOUDS_FADE_RATE = 3;

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
  // The clouds, white on black, and how much they are shown: none of them
  // until the picture has loaded, or with them switched off.
  uniform sampler2D uCloudMap;
  uniform float uClouds;

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
    // Mirrors cloudCover and cloudsDrawnAt.
    float cloud = uClouds
      * (1.0 - smoothstep(${(CLOUD_LATITUDES.full / 90).toFixed(4)}, ${(CLOUD_LATITUDES.none / 90).toFixed(4)}, abs(2.0 * vUv.y - 1.0)))
      * smoothstep(${CLOUD_COVER.from.toFixed(2)}, ${CLOUD_COVER.to.toFixed(2)}, texture2D(uCloudMap, vUv).r);

    // Sunlight as it reaches the ground: through more air the lower the Sun,
    // so warmer toward the edge of night. Not as red as the Sun itself gets,
    // since about half of what the air takes out of the beam still comes
    // down, from the rest of the sky. And the light of the sky after sunset,
    // which lasts a little way into twilight. Both relative to noon, which
    // is what the map is painted for.
    vec3 overhead = skyTransmittanceToTop(SKY_BOTTOM, 1.0);
    vec3 direct = (skySunlight(SKY_BOTTOM, sun) + smoothstep(-0.02, 0.05, sun)) / (overhead + 1.0);
    vec3 skylight = skyMultiscatter(SKY_BOTTOM, sun) / skyMultiscatter(SKY_BOTTOM, 1.0);
    vec3 falling = (0.8 * direct * max(sun, 0.0) + 0.3 * skylight) * left;
    // Under cloud the ground is in its shade, and its lights are hidden.
    vec3 lit = day * falling * (1.0 - 0.5 * cloud);
    // Keep a trace of the surface at night so satellites there have context.
    vec3 unlit = (day * 0.04 + night * 0.9) * (1.0 - 0.8 * cloud);
    vec3 color = lit + unlit * (1.0 - smoothstep(-0.1, 0.15, sun) * left);
    // The clouds themselves: white, lit as the ground is, so they redden
    // toward the edge of night, and by night all but dark.
    color = mix(color, vec3(0.98) * falling + vec3(0.005, 0.007, 0.011), 0.92 * cloud);

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
        uCloudMap: { value: null as Texture | null },
        uClouds: { value: 0 },
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: surfaceFragmentShader,
    });
  }, [dayMap, nightMap]);
  useEffect(() => () => material.dispose(), [material]);

  // The same map says what the ground is like, looking up from it.
  useEffect(() => {
    const landscape = landscapeUniforms();
    landscape.uLandDay.value = dayMap;
    landscape.uLandMapped.value = 1;
    return () => {
      landscape.uLandMapped.value = 0;
      landscape.uLandDay.value = null;
    };
  }, [dayMap]);

  // The clouds are a picture fetched when the site was built, which a build
  // may be without, and are not worth holding the Earth up for: they are
  // loaded once it is known there are any, and drawn when they arrive.
  const haveClouds = useApp((state) => state.cloudsAtMs !== null);
  const cloudMap = useRef<Texture | null>(null);
  useEffect(() => {
    if (!haveClouds) return;
    // Phones get the smaller picture, as they do of the stars: see `Sky`.
    const small = window.matchMedia('(pointer: coarse)').matches;
    let stale = false;
    new TextureLoader().load(
      CLOUD_MAP_URL(small ? CLOUD_MAPS.small : CLOUD_MAPS.large),
      (map) => {
        if (stale) {
          map.dispose();
          return;
        }
        map.colorSpace = NoColorSpace;
        map.anisotropy = 8;
        cloudMap.current = map;
        material.uniforms.uCloudMap.value = map;
      },
      undefined,
      // No clouds, then.
      () => {},
    );
    return () => {
      stale = true;
      material.uniforms.uCloudMap.value = null;
      material.uniforms.uClouds.value = 0;
      cloudMap.current?.dispose();
      cloudMap.current = null;
    };
  }, [haveClouds, material]);

  useFrame((_, deltaSeconds) => {
    if (spin.current) spin.current.rotation.z = gmst(currentSimTime());
    const wanted = cloudMap.current && useApp.getState().showClouds ? 1 : 0;
    const clouds = material.uniforms.uClouds;
    const step = CLOUDS_FADE_RATE * deltaSeconds;
    clouds.value = Math.min(1, Math.max(0, clouds.value + (wanted > clouds.value ? step : -step)));
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
