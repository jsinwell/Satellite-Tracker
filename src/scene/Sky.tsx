import { useLoader, useThree } from '@react-three/fiber';
import { useMemo } from 'react';
import { BackSide, TextureLoader } from 'three';
import { EARTH_RADIUS_KM } from '../core/constants';
import { SPHERE_POLES_TO_Z } from './frame';
import { configureSkyMap } from './skyMap';

const MAPS = {
  large: `${import.meta.env.BASE_URL}textures/starmap_8k.webp`,
  small: `${import.meta.env.BASE_URL}textures/starmap_4k.webp`,
};

/** Far beyond any orbit, inside the camera's far plane (both in Earth radii). */
const SKY_RADIUS_KM = 900 * EARTH_RADIUS_KM;
/** Dimmed so the satellites stay the brightest things on screen. */
const SKY_BRIGHTNESS = '#c8c8c8';

/**
 * The real night sky: NASA's Deep Star Maps, drawn on a sphere around the
 * scene. The scene works in the same star-fixed frame the map does, so the
 * Milky Way and constellations sit where they actually are behind each orbit.
 */
export function Sky() {
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  // The 8k map is 134 MB on the GPU; keep it for screens that can show the detail.
  const canUseLarge = maxTextureSize >= 8192 && window.innerWidth >= 1280;
  const map = useLoader(TextureLoader, canUseLarge ? MAPS.large : MAPS.small);
  useMemo(() => configureSkyMap(map), [map]);

  return (
    <mesh rotation={[...SPHERE_POLES_TO_Z]} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[SKY_RADIUS_KM, 64, 32]} />
      <meshBasicMaterial map={map} color={SKY_BRIGHTNESS} side={BackSide} depthWrite={false} />
    </mesh>
  );
}
