import { useFrame, useLoader } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  CanvasTexture,
  type Group,
  MathUtils,
  Matrix4,
  PerspectiveCamera,
  type Sprite,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
} from 'three';
import { currentSimTime } from '../app/store';
import { moonPosition, obliquity, sunDirection, sunPosition } from '../core/astro';
import { EARTH_RADIUS_KM } from '../core/constants';
import { MOON_RADIUS_KM, SUN_RADIUS_KM, sunHiddenByMoon } from '../core/eclipse';
import type { Vec3 } from '../core/kinematics';
import { ECLIPSE_GLSL } from './eclipseGlsl';
import { CAMERA_FOV, directionToWorld, SPHERE_POLES_TO_Z, TEME_FROM_WORLD } from './frame';

const MOON_MAP_URL = `${import.meta.env.BASE_URL}textures/moon_1024.jpg`;

/**
 * The Sun is drawn at a stand-in distance from the camera, inside the sky
 * sphere, in the direction it really is from the camera, at the size it
 * really looks from there. Only near the Earth does that matter: from the
 * ground the direction from the Earth's center is off by a twentieth of a
 * degree, enough to spoil an eclipse. The sprite is larger than the disc, to
 * carry the glow around it.
 */
const SUN_DISTANCE_KM = 700 * EARTH_RADIUS_KM;
const SUN_GLOW_SCALE = 26;
/** The corona reaches a few solar radii out; the sprite is this many discs across. */
const CORONA_SCALE = 7;

/**
 * The Sun's outer atmosphere, only seen when the Moon covers the rest: a
 * pearly glow drawn out into faint streamers, as a sprite texture.
 */
function createCoronaTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context) {
    const half = size / 2;
    const disc = half / CORONA_SCALE;
    const glow = context.createRadialGradient(half, half, disc * 0.9, half, half, half);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    glow.addColorStop(0.08, 'rgba(235, 240, 255, 0.55)');
    glow.addColorStop(0.3, 'rgba(210, 222, 255, 0.14)');
    glow.addColorStop(1, 'rgba(200, 215, 255, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
    // Streamers, longer along the Sun's equator, as at most points in its cycle.
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * 2 * Math.PI + Math.sin(i * 12.9898) * 0.08;
      const equatorial = Math.abs(Math.cos(angle));
      const length = disc * (1.6 + 2.4 * equatorial * (0.6 + 0.4 * Math.abs(Math.sin(i * 7.31))));
      const ray = context.createLinearGradient(
        half,
        half,
        half + Math.cos(angle) * length,
        half + Math.sin(angle) * length,
      );
      ray.addColorStop(0, 'rgba(230, 236, 255, 0.10)');
      ray.addColorStop(1, 'rgba(230, 236, 255, 0)');
      context.strokeStyle = ray;
      context.lineWidth = disc * 0.22;
      context.beginPath();
      context.moveTo(half, half);
      context.lineTo(half + Math.cos(angle) * length, half + Math.sin(angle) * length);
      context.stroke();
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

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
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Plain diffuse lighting from the Sun is all it takes to get the right phase.
// In a lunar eclipse the Earth hides the Sun: the Moon dims through the
// penumbra, and in the umbra is lit only by sunlight bent through the
// Earth's atmosphere, which reaches it dim and red.
const moonFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSunDirection;
  uniform vec3 uSun;

  varying vec2 vUv;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;

  ${ECLIPSE_GLSL}

  void main() {
    float facing = max(dot(normalize(vWorldNormal), uSunDirection), 0.0);
    float left = 1.0 - sunHiddenByEarth(vWorldPosition, uSun);
    vec3 sunlight = mix(vec3(0.16, 0.055, 0.025), vec3(1.0), left);
    gl_FragColor = vec4(texture2D(uMap, vUv).rgb * (0.02 + 1.3 * facing * sunlight), 1.0);
    #include <colorspace_fragment>
  }
`;

const scratch: Vec3 = { x: 0, y: 0, z: 0 };
const sunKm: Vec3 = { x: 0, y: 0, z: 0 };
const moonKm: Vec3 = { x: 0, y: 0, z: 0 };
const eye = new Vector3();
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
  const corona = useRef<Sprite>(null);
  const moon = useRef<Group>(null);
  const moonTag = useRef<Sprite>(null);

  const sunTexture = useMemo(createSunTexture, []);
  const coronaTexture = useMemo(createCoronaTexture, []);
  const moonLabel = useMemo(() => createLabelTexture('Moon'), []);
  const moonUniforms = useMemo(() => {
    moonMap.colorSpace = SRGBColorSpace;
    return {
      uMap: { value: moonMap },
      uSunDirection: { value: new Vector3(1, 0, 0) },
      uSun: { value: new Vector3() },
    };
  }, [moonMap]);

  useFrame(({ camera }) => {
    const simMs = currentSimTime();
    sunPosition(simMs, sunKm);
    moonPosition(simMs, moonKm);
    directionToWorld(sunDirection(simMs, scratch), moonUniforms.uSunDirection.value);
    directionToWorld(sunKm, moonUniforms.uSun.value).divideScalar(EARTH_RADIUS_KM);

    // The Sun as it looks from the camera: where, how big, and how much of
    // it the Moon leaves. The corona shows only when nearly all of it is gone.
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    const toSun = Math.hypot(sunKm.x - eye.x, sunKm.y - eye.y, sunKm.z - eye.z);
    const disc = 2 * SUN_DISTANCE_KM * Math.tan(Math.asin(SUN_RADIUS_KM / toSun));
    const hidden = sunHiddenByMoon(eye, sunKm, moonKm);
    for (const [sprite, scale] of [
      [sun.current, SUN_GLOW_SCALE],
      [corona.current, CORONA_SCALE],
    ] as const) {
      if (!sprite) continue;
      sprite.position.set(
        eye.x + ((sunKm.x - eye.x) / toSun) * SUN_DISTANCE_KM,
        eye.y + ((sunKm.y - eye.y) / toSun) * SUN_DISTANCE_KM,
        eye.z + ((sunKm.z - eye.z) / toSun) * SUN_DISTANCE_KM,
      );
      sprite.scale.setScalar(disc * scale);
    }
    // Even a thin crescent of Sun is dazzling: the glare only goes in the
    // last few percent before totality.
    if (sun.current) sun.current.material.opacity = MathUtils.smoothstep(1 - hidden, 0, 0.08);
    if (corona.current) {
      const opacity = MathUtils.smoothstep(hidden, 0.97, 1);
      corona.current.material.opacity = opacity;
      corona.current.visible = opacity > 0;
    }

    // A perspective-free sprite still scales with the field of view; undo
    // that, so the tag stays the same size on screen when zooming in.
    if (moonTag.current && camera instanceof PerspectiveCamera) {
      const zoom =
        Math.tan(MathUtils.degToRad(camera.fov) / 2) / Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);
      moonTag.current.scale.set(
        MOON_LABEL_HEIGHT * moonLabel.aspect * EARTH_RADIUS_KM * zoom,
        MOON_LABEL_HEIGHT * EARTH_RADIUS_KM * zoom,
        1,
      );
    }

    if (moon.current) {
      const position = moonKm;
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
      <sprite ref={sun}>
        <spriteMaterial
          map={sunTexture}
          blending={AdditiveBlending}
          depthWrite={false}
          transparent
        />
      </sprite>
      {/* Behind the Moon, which hides its middle. */}
      <sprite ref={corona} visible={false}>
        <spriteMaterial
          map={coronaTexture}
          blending={AdditiveBlending}
          depthWrite={false}
          transparent
          opacity={0}
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
        <sprite ref={moonTag} center={[0.5, MOON_LABEL_DROP]}>
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
