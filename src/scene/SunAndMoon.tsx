import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  type Group,
  Matrix4,
  type Sprite,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { currentSimTime } from '../app/store';
import { moonPosition, obliquity, sunDirection } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import type { Vec3 } from '../core/kinematics';
import { directionToWorld, SPHERE_POLES_TO_Z } from './frame';

const MOON_MAP_URL = `${import.meta.env.BASE_URL}textures/moon_1024.jpg`;
const MOON_RADIUS_KM = 1737.4;

/**
 * The Sun is drawn at a stand-in distance, inside the sky sphere; only its
 * direction is real. At that distance its true half-degree disc would be this
 * wide, and the sprite is larger to carry the glow around it.
 */
const SUN_DISTANCE_KM = 700 * EARTH_RADIUS_KM;
const SUN_DISC_KM = 2 * SUN_DISTANCE_KM * Math.tan((0.533 / 2) * (Math.PI / 180));
const SUN_GLOW_SCALE = 26;

/** A white-hot disc fading into a warm halo, as a sprite texture. */
function createSunTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const half = size / 2;
    const disc = 1 / SUN_GLOW_SCALE;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(disc, 'rgba(255, 252, 240, 1)');
    gradient.addColorStop(disc * 1.6, 'rgba(255, 236, 190, 0.45)');
    gradient.addColorStop(disc * 5, 'rgba(255, 214, 150, 0.12)');
    gradient.addColorStop(0.5, 'rgba(255, 200, 130, 0.03)');
    gradient.addColorStop(1, 'rgba(255, 200, 130, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The Moon is drawn at its true size, which from here is a disc about a
 * dozen pixels across: accurate, and nearly impossible to find among the
 * stars. A small name tag beside it keeps it honest and findable.
 *
 * The tag is a sprite that ignores perspective, so these are its width and
 * height as angles (in radians) rather than distances.
 */
const MOON_LABEL_HEIGHT = 0.013;
/** How far below the Moon the tag hangs, in tag heights. */
const MOON_LABEL_DROP = 2.6;

function createLabelTexture(text: string): { texture: CanvasTexture; aspect: number } {
  const fontPx = 44;
  const font = `500 ${fontPx}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context) context.font = font;
  canvas.width = Math.ceil((context?.measureText(text).width ?? fontPx * text.length) + 16);
  canvas.height = Math.ceil(fontPx * 1.4);
  if (context) {
    // Resizing a canvas resets its state, so the font is set again.
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(226, 232, 240, 0.85)';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

const moonVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Plain diffuse lighting from the Sun is all it takes to get the right phase.
const moonFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirection;

  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    float light = max(dot(normalize(vWorldNormal), uSunDirection), 0.0);
    gl_FragColor = vec4(texture2D(uMap, vUv).rgb * (0.02 + 1.3 * light), 1.0);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };
const towardEarth = new Vector3();
const north = new Vector3();
const east = new Vector3();
const basis = new Matrix4();

/**
 * The Sun and Moon where they actually are for the simulated instant. The Sun
 * hides behind the Earth when it should, and the Moon shows its true phase
 * with the near side facing us. Lives inside the TEME group; see `frame.ts`.
 */
export function SunAndMoon() {
  const moonMap = useLoader(TextureLoader, MOON_MAP_URL);
  const sun = useRef<Sprite>(null);
  const moon = useRef<Group>(null);

  const sunTexture = useMemo(createSunTexture, []);
  const moonLabel = useMemo(() => createLabelTexture('Moon'), []);
  const moonUniforms = useMemo(() => {
    moonMap.colorSpace = SRGBColorSpace;
    return { uMap: { value: moonMap }, uSunDirection: { value: new Vector3(1, 0, 0) } };
  }, [moonMap]);

  useFrame(() => {
    const simMs = currentSimTime();
    const sunward = sunDirection(simMs, scratch);
    sun.current?.position.set(
      sunward.x * SUN_DISTANCE_KM,
      sunward.y * SUN_DISTANCE_KM,
      sunward.z * SUN_DISTANCE_KM,
    );
    directionToWorld(sunward, moonUniforms.uSunDirection.value);

    if (moon.current) {
      const position = moonPosition(simMs, scratch);
      moon.current.position.set(position.x, position.y, position.z);
      // The Moon is tidally locked: its prime meridian (local +x) faces the
      // Earth, and its pole (local +z) is close to the pole of the ecliptic.
      const tilt = (obliquity(simMs) * Math.PI) / 180;
      towardEarth.set(-position.x, -position.y, -position.z).normalize();
      north.set(0, -Math.sin(tilt), Math.cos(tilt));
      east.crossVectors(north, towardEarth).normalize();
      north.crossVectors(towardEarth, east);
      moon.current.quaternion.setFromRotationMatrix(basis.makeBasis(towardEarth, east, north));
    }
  });

  return (
    <>
      <sprite ref={sun} scale={SUN_DISC_KM * SUN_GLOW_SCALE}>
        <spriteMaterial
          map={sunTexture}
          blending={AdditiveBlending}
          depthWrite={false}
          transparent
        />
      </sprite>
      <group ref={moon}>
        <mesh rotation={[...SPHERE_POLES_TO_Z]}>
          <sphereGeometry args={[MOON_RADIUS_KM, 48, 24]} />
          <shaderMaterial
            uniforms={moonUniforms}
            vertexShader={moonVertexShader}
            fragmentShader={moonFragmentShader}
          />
        </mesh>
        {/*
          Scaled up by the Earth's radius to cancel the enclosing group's
          kilometers-to-scene scale, which a perspective-free sprite inherits.
        */}
        <sprite
          center={[0.5, MOON_LABEL_DROP]}
          scale={[
            MOON_LABEL_HEIGHT * moonLabel.aspect * EARTH_RADIUS_KM,
            MOON_LABEL_HEIGHT * EARTH_RADIUS_KM,
            1,
          ]}
        >
          <spriteMaterial
            map={moonLabel.texture}
            sizeAttenuation={false}
            depthWrite={false}
            transparent
          />
        </sprite>
      </group>
    </>
  );
}
