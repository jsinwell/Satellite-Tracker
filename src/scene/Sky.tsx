import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  BackSide,
  Color,
  MathUtils,
  Matrix4,
  type MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  TextureLoader,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { currentSimTime } from '../app/store';
import { EARTH_RADIUS_KM } from '../core/constants';
import { j2000ToDate } from '../core/planets';
import { atmosphereUniforms } from './atmosphereGlsl';
import { SPHERE_POLES_TO_Z } from './frame';
import { configureSkyMap } from './skyMap';

const MAPS = {
  large: `${import.meta.env.BASE_URL}textures/starmap_8k.webp`,
  small: `${import.meta.env.BASE_URL}textures/starmap_4k.webp`,
};

/** Far beyond any orbit, inside the camera's far plane (both in Earth radii). */
const SKY_RADIUS_KM = 900 * EARTH_RADIUS_KM;
/** Dimmed so the satellites stay the brightest things on screen. */
const SKY_BRIGHTNESS = new Color('#c8c8c8').r;
/**
 * The map is a photograph of the whole sky, a twentieth of a degree to the
 * pixel. Zoomed in on a planet there is nothing in it to see but its pixels,
 * so it fades out as the view narrows from the second of these to the first,
 * degrees.
 */
const SKY_FADES = [2, 12] as const;

/**
 * Under a bright Moon the faint stars are not dimmer, they are gone: lost in
 * the light of the sky, where the bright ones still stand out of it. So
 * what the Moon takes is taken off the map's light, not a share of it, and
 * whatever was fainter than that is black. `Atmosphere` says how much.
 */
function loseFaintStars(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uSkyStarVeil = atmosphereUniforms().uSkyStarVeil;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', 'uniform float uSkyStarVeil;\n#include <common>')
    .replace(
      '#include <map_fragment>',
      '#include <map_fragment>\ndiffuseColor.rgb = max(diffuseColor.rgb - uSkyStarVeil, 0.0);',
    );
}

/**
 * The real night sky: NASA's Deep Star Maps, drawn on a sphere around the
 * scene, so the Milky Way and constellations sit where they actually are
 * behind each orbit.
 *
 * The map is drawn for the equator and equinox of 2000, and the scene works in
 * those of the date, which the Earth's wobble has carried about a third of a
 * degree away since. The sphere is turned to match, once: the difference
 * grows by under a hundredth of a degree a year.
 */
export function Sky() {
  const maxTextureSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  // The 8k map is 134 MB on the GPU, so phones and tablets get the 4k one.
  // Going by the device rather than the window size matters: on a desktop, a
  // narrow window still shows the sky at full pixel density, and the 4k map
  // stretched that far turns its faint stars into a visible grid of blobs.
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;
  const canUseLarge = maxTextureSize >= 8192 && !isTouchDevice;
  const map = useLoader(TextureLoader, canUseLarge ? MAPS.large : MAPS.small);
  useMemo(() => configureSkyMap(map), [map]);
  const toDate = useMemo(() => {
    const [a, b, c, d, e, f, g, h, i] = j2000ToDate(currentSimTime());
    return new Quaternion().setFromRotationMatrix(
      new Matrix4().set(a, b, c, 0, d, e, f, 0, g, h, i, 0, 0, 0, 0, 1),
    );
  }, []);

  const material = useRef<MeshBasicMaterial>(null);
  useFrame(({ camera }) => {
    if (!material.current || !(camera instanceof PerspectiveCamera)) return;
    const shown = MathUtils.smoothstep(camera.fov, SKY_FADES[0], SKY_FADES[1]);
    material.current.color.setScalar(SKY_BRIGHTNESS * shown);
  });

  return (
    <group quaternion={toDate}>
      <mesh rotation={[...SPHERE_POLES_TO_Z]} frustumCulled={false} renderOrder={-1}>
        <sphereGeometry args={[SKY_RADIUS_KM, 64, 32]} />
        <meshBasicMaterial
          ref={material}
          map={map}
          side={BackSide}
          depthWrite={false}
          onBeforeCompile={loseFaintStars}
        />
      </mesh>
    </group>
  );
}
