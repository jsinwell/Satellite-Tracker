import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  MathUtils,
  Matrix3,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { currentSimTime } from '../app/store';
import {
  BODY_SHAPES,
  bodyShown,
  JUPITER_MOON_NAMES,
  JUPITER_MOON_RADII_KM,
  JUPITER_MOONS,
  type JupiterMoon,
  jupiterMoonOffsets,
  type PlanetDisc,
  SATURN_RINGS,
} from '../core/bodies';
import type { Vec3 } from '../core/kinematics';
import { PLANETS } from '../core/planets';
import { ATMOSPHERE_GLSL, atmosphereUniforms } from './atmosphereGlsl';
import { SPHERE_POLES_TO_Z, TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';
import { labelLayer } from './labelLayer';
import { PLANET_DISTANCE_KM } from './Planets';
import { latestDiscs, setDiscsDrawn } from './skyBodies';

const MAP_URL = (name: string) => `${import.meta.env.BASE_URL}textures/planets/${name}`;
const MAP_URLS = PLANETS.map((planet) => MAP_URL(`${planet}.jpg`));
const RING_URL = MAP_URL('saturn-ring.png');

/** A disc narrower than this on screen, CSS px, is left to the planet's point of light. */
const NARROWEST_DISC = 1.5;
/** Jupiter's moons come into view as its disc grows from the first of these widths to the second, CSS px. */
const MOONS_APPEAR = [3, 7] as const;
/** They are named once Jupiter is this wide. */
const MOONS_NAMED = 12;
/** A moon is drawn at least this wide, CSS px: a point of light, as a small telescope shows it. */
const MOON_POINT = 2.6;

/**
 * Drawn after the sky and the Sun's corona and before the Moon, which can
 * pass in front of a planet: the planet, then its rings, then its moons.
 */
const DISC_ORDER = -0.36;
const RING_ORDER = -0.35;
const MOON_ORDER = -0.34;

/** The colors of Jupiter's four large moons: sulfur, ice, and two of dirty ice. */
const MOON_TINTS: Record<JupiterMoon, string> = {
  io: '#f2e08a',
  europa: '#efe9dc',
  ganymede: '#c4b6a2',
  callisto: '#8f8474',
};

// Everything about a planet's own shape is worked out in its own axes: z
// along its pole, lengths in its own radii. There the numbers are small and
// exact; in the world's, a planet is a speck a very long way off, and single
// precision leaves little to tell one side of it from the other.
const discVertexShader = /* glsl */ `
  uniform mat3 uShape;
  uniform mat3 uShapeNormal;

  varying vec2 vUv;
  varying vec3 vOwn;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vOwn = uShape * position;
    vNormal = uShapeNormal * normal;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Plain diffuse lighting from the Sun gives the phase: Venus a crescent,
// Jupiter all but full and darker toward its edge. Saturn also wears the
// shadow of its rings. Then the air it is seen through, as for the Moon.
const discFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uRingMap;
  uniform vec3 uSunOwn;
  uniform vec2 uRingSpan;
  uniform float uRinged;
  // How much of its brightness the picture's exposure leaves it: see bodyShown.
  uniform float uShown;

  varying vec2 vUv;
  varying vec3 vOwn;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  ${ATMOSPHERE_GLSL}

  void main() {
    float facing = max(dot(normalize(vNormal), uSunOwn), 0.0);
    vec3 color = texture2D(uMap, vUv).rgb * (1.3 * facing * uShown);

    if (uRinged > 0.5 && abs(uSunOwn.z) > 1e-4) {
      // Toward the Sun from here, does the line cross the rings' plane inside them?
      float t = -vOwn.z / uSunOwn.z;
      if (t > 0.0) {
        float place = (length(vOwn.xy + uSunOwn.xy * t) - uRingSpan.x) / (uRingSpan.y - uRingSpan.x);
        if (place > 0.0 && place < 1.0) {
          color *= 1.0 - 0.8 * textureLod(uRingMap, vec2(place, 0.5), 0.0).a;
        }
      }
    }

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

const ringVertexShader = /* glsl */ `
  varying vec2 vOwn;
  varying vec3 vWorldPosition;

  void main() {
    vOwn = position.xy;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The rings are a flat sheet of ice, see-through in places. Bright seen
// from the side the Sun is on and dim from the other; dark where the planet's
// shadow falls across them; and not there at all where the planet is in front.
const ringFragmentShader = /* glsl */ `
  uniform sampler2D uRingMap;
  uniform vec3 uSunOwn;
  uniform vec3 uEyeOwn;
  uniform vec2 uRingSpan;
  uniform float uShown;
  // How much shorter the planet is through its poles: a ball again once
  // everything is stretched back by this along z.
  uniform float uSquash;

  varying vec2 vOwn;
  varying vec3 vWorldPosition;

  ${ATMOSPHERE_GLSL}

  // Whether the planet is in the way, going from "point" along "toward".
  bool behindPlanet(vec3 point, vec3 toward) {
    vec3 stretch = vec3(1.0, 1.0, 1.0 / uSquash);
    vec3 from = point * stretch;
    vec3 along = normalize(toward * stretch);
    float b = dot(from, along);
    float c = dot(from, from) - 1.0;
    return b < 0.0 && b * b - c > 0.0;
  }

  void main() {
    float place = (length(vOwn) - uRingSpan.x) / (uRingSpan.y - uRingSpan.x);
    if (place <= 0.0 || place >= 1.0) discard;
    vec4 ring = texture2D(uRingMap, vec2(place, 0.5));
    vec3 point = vec3(vOwn, 0.0);
    if (ring.a <= 0.0 || behindPlanet(point, uEyeOwn - point)) discard;

    float lit = uSunOwn.z * uEyeOwn.z > 0.0 ? 1.0 : 0.22;
    // The lower the Sun over the rings, the less light each part of them gets.
    lit *= 0.55 + 0.45 * min(1.0, 4.0 * abs(uSunOwn.z));
    if (behindPlanet(point, uSunOwn)) lit *= 0.04;
    vec3 color = ring.rgb * (1.15 * lit * uShown);

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

    gl_FragColor = vec4(color, ring.a);
    #include <colorspace_fragment>
  }
`;

const moonVertexShader = /* glsl */ `
  uniform float uPixelRatio;
  attribute float size;
  attribute vec3 tint;
  varying vec3 vTint;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * uPixelRatio;
    vTint = tint;
  }
`;

const moonFragmentShader = /* glsl */ `
  uniform float uShown;
  varying vec3 vTint;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = (1.0 - smoothstep(0.7, 1.0, d)) * uShown;
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(vTint, alpha);
    #include <colorspace_fragment>
  }
`;

interface Disc {
  holder: Group;
  material: ShaderMaterial;
  ringMaterial: ShaderMaterial | null;
}

const eye = new Vector3();
const point = new Vector3();
const side = new Vector3();
const pole = new Vector3();
const meridian = new Vector3();
const basis = new Matrix4();
const scratch = new Vector3();
const offsetOwn: Vec3 = { x: 0, y: 0, z: 0 };

/** `v` (TEME) along a planet's own axes: its meridian, 90° east of that, and its pole. */
function alongOwnAxes(v: Vec3, out: Vector3): Vector3 {
  return out.set(
    v.x * meridian.x + v.y * meridian.y + v.z * meridian.z,
    v.x * side.x + v.y * side.y + v.z * side.z,
    v.x * pole.x + v.y * pole.y + v.z * pole.z,
  );
}

/**
 * Whether a planet `squash` times as tall as it is wide, at the origin of its
 * own axes and one unit in radius, is in the way going from `from` along
 * `toward`. As in the rings' shader.
 */
function behindPlanet(from: Vec3, toward: Vec3, squash: number): boolean {
  const fz = from.z / squash;
  const tz = toward.z / squash;
  const length = Math.hypot(toward.x, toward.y, tz);
  const b = (from.x * toward.x + from.y * toward.y + fz * tz) / length;
  const c = from.x * from.x + from.y * from.y + fz * fz - 1;
  return b < 0 && b * b - c > 0;
}

/**
 * The planets as discs: each a lit, turning ball with its own map, at the
 * size and in the place it is seen, with Saturn's rings and Jupiter's four
 * large moons. Only wide enough to be worth drawing with the view zoomed
 * well in; until then `Planets` shows each as a point of light.
 *
 * Like those points, the discs are drawn at a stand-in distance, everything
 * shrunk toward the camera by the same amount, so that angles and sizes on
 * screen are as they really are. Lives in the TEME group.
 */
export function PlanetDiscs() {
  const maps = useLoader(TextureLoader, MAP_URLS);
  const ringMap = useLoader(TextureLoader, RING_URL);

  const { root, discs, moons, moonSizes, moonPositions } = useMemo(() => {
    for (const map of [...maps, ringMap]) {
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 4;
    }
    const root = new Group();
    const ball = new SphereGeometry(1, 64, 32);
    const ringSpan = new Vector2(
      SATURN_RINGS.innerKm / BODY_SHAPES.saturn.radiusKm,
      SATURN_RINGS.outerKm / BODY_SHAPES.saturn.radiusKm,
    );

    const discs = PLANETS.map((planet, i): Disc => {
      const squash = 1 - BODY_SHAPES[planet].flattening;
      const holder = new Group();
      holder.visible = false;
      const squashed = new Group();
      squashed.scale.set(1, 1, squash);
      const mesh = new Mesh(ball);
      mesh.rotation.set(...SPHERE_POLES_TO_Z);
      mesh.updateMatrix();
      // From the ball's axes, poles on y, to the planet's own, squashed along its pole.
      const shape = new Matrix3().setFromMatrix4(
        new Matrix4().makeScale(1, 1, squash).multiply(mesh.matrix),
      );
      // Made here, not as an element: see `atmosphereUniforms`.
      const material = new ShaderMaterial({
        uniforms: {
          ...atmosphereUniforms(),
          uMap: { value: maps[i] as Texture },
          uRingMap: { value: ringMap },
          uRingSpan: { value: ringSpan },
          uRinged: { value: planet === 'saturn' ? 1 : 0 },
          uSunOwn: { value: new Vector3(1, 0, 0) },
          uShown: { value: 1 },
          uShape: { value: shape },
          uShapeNormal: { value: shape.clone().invert().transpose() },
        },
        vertexShader: discVertexShader,
        fragmentShader: discFragmentShader,
        // Solid, but marked see-through so that it is drawn after the sky.
        transparent: true,
        depthWrite: false,
      });
      mesh.material = material;
      mesh.renderOrder = DISC_ORDER;
      squashed.add(mesh);
      holder.add(squashed);

      let ringMaterial: ShaderMaterial | null = null;
      if (planet === 'saturn') {
        ringMaterial = new ShaderMaterial({
          uniforms: {
            ...atmosphereUniforms(),
            uRingMap: { value: ringMap },
            uRingSpan: { value: ringSpan },
            uSunOwn: { value: new Vector3(1, 0, 0) },
            uEyeOwn: { value: new Vector3(0, 0, 1) },
            uShown: { value: 1 },
            uSquash: { value: squash },
          },
          vertexShader: ringVertexShader,
          fragmentShader: ringFragmentShader,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        });
        const rings = new Mesh(new RingGeometry(ringSpan.x, ringSpan.y, 180, 1), ringMaterial);
        rings.renderOrder = RING_ORDER;
        holder.add(rings);
      }
      root.add(holder);
      return { holder, material, ringMaterial };
    });

    const moonPositions = new Float32Array(JUPITER_MOONS.length * 3);
    const moonSizes = new Float32Array(JUPITER_MOONS.length);
    const tints = new Float32Array(JUPITER_MOONS.length * 3);
    JUPITER_MOONS.forEach((moon, i) => {
      new Color(MOON_TINTS[moon]).toArray(tints, i * 3);
    });
    const moonMaterial = new ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 }, uShown: { value: 0 } },
      vertexShader: moonVertexShader,
      fragmentShader: moonFragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const moons = new Points(
      new BufferGeometry()
        .setAttribute('position', new BufferAttribute(moonPositions, 3))
        .setAttribute('size', new BufferAttribute(moonSizes, 1))
        .setAttribute('tint', new BufferAttribute(tints, 3)),
      moonMaterial,
    );
    moons.frustumCulled = false;
    moons.visible = false;
    moons.renderOrder = MOON_ORDER;
    moons.onBeforeRender = (renderer: WebGLRenderer) => {
      moonMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    root.add(moons);

    return { root, discs, moons, moonSizes, moonPositions };
  }, [maps, ringMap]);

  const labels = useRef<HTMLElement[]>([]);
  useEffect(() => {
    setDiscsDrawn(true);
    return () => {
      setDiscsDrawn(false);
      root.traverse((object) => {
        if (object instanceof Mesh || object instanceof Points) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
      for (const label of labels.current) label.remove();
      labels.current = [];
    };
  }, [root]);

  useFrame(({ camera, size }) => {
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 90;
    const pixel = MathUtils.degToRad(fov) / size.height;
    camera.updateMatrixWorld();
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);

    const exposure = atmosphereUniforms().uSkyExposure.value;
    let jupiterWidth = 0;
    latestDiscs().forEach((disc, i) => {
      const { holder, material, ringMaterial } = discs[i];
      const { radiusKm, flattening } = BODY_SHAPES[disc.planet];
      // From the camera, which near the Earth is not quite from its center.
      const x = disc.direction.x * disc.distanceKm - eye.x;
      const y = disc.direction.y * disc.distanceKm - eye.y;
      const z = disc.direction.z * disc.distanceKm - eye.z;
      const distance = Math.hypot(x, y, z);
      const width = (2 * Math.asin(radiusKm / distance)) / pixel;
      if (disc.planet === 'jupiter') jupiterWidth = width;
      holder.visible = width > NARROWEST_DISC;
      if (!holder.visible) return;

      const shrink = PLANET_DISTANCE_KM / distance;
      holder.position.set(eye.x + x * shrink, eye.y + y * shrink, eye.z + z * shrink);
      holder.scale.setScalar(radiusKm * shrink);
      setOwnAxes(disc);
      holder.quaternion.setFromRotationMatrix(basis.makeBasis(meridian, side, pole));

      alongOwnAxes(disc.sunward, material.uniforms.uSunOwn.value);
      material.uniforms.uShown.value = bodyShown(disc.planet, exposure);
      if (ringMaterial) {
        ringMaterial.uniforms.uShown.value = material.uniforms.uShown.value;
        ringMaterial.uniforms.uSunOwn.value.copy(material.uniforms.uSunOwn.value);
        // Where the camera is from the planet, in the planet's radii.
        scratch.set(-x / radiusKm, -y / radiusKm, -z / radiusKm);
        alongOwnAxes(scratch, ringMaterial.uniforms.uEyeOwn.value);
      }

      if (disc.planet === 'jupiter') {
        placeMoons(disc, x, y, z, shrink, 1 - flattening, pixel);
      }
    });

    const shown =
      MathUtils.smoothstep(jupiterWidth, MOONS_APPEAR[0], MOONS_APPEAR[1]) *
      bodyShown('jupiter', exposure);
    moons.visible = shown > 0;
    (moons.material as ShaderMaterial).uniforms.uShown.value = shown;
    nameMoons(camera, size.width, size.height, jupiterWidth >= MOONS_NAMED);
  });

  /** Fills `meridian`, `side` and `pole` with a planet's own axes, TEME. */
  function setOwnAxes(disc: PlanetDisc): void {
    pole.set(disc.pole.x, disc.pole.y, disc.pole.z);
    meridian.set(disc.meridian.x, disc.meridian.y, disc.meridian.z);
    side.crossVectors(pole, meridian);
  }

  /**
   * Puts Jupiter's moons where they are seen, shrunk toward the camera as
   * Jupiter is, and sizes them: nothing for one hidden behind Jupiter or
   * passing through its shadow. `x`, `y`, `z` is Jupiter from the camera.
   */
  function placeMoons(
    jupiter: PlanetDisc,
    x: number,
    y: number,
    z: number,
    shrink: number,
    squash: number,
    pixel: number,
  ): void {
    const radiusKm = BODY_SHAPES.jupiter.radiusKm;
    const offsets = jupiterMoonOffsets(currentSimTime(), jupiter.distanceKm);
    const sunOwn = alongOwnAxes(jupiter.sunward, point);
    JUPITER_MOONS.forEach((moon, i) => {
      const offset = offsets[moon];
      moonPositions[i * 3] = eye.x + (x + offset.x) * shrink;
      moonPositions[i * 3 + 1] = eye.y + (y + offset.y) * shrink;
      moonPositions[i * 3 + 2] = eye.z + (z + offset.z) * shrink;

      // In Jupiter's own axes and radii: is Jupiter between the moon and the
      // camera, or between it and the Sun?
      alongOwnAxes(offset, scratch).divideScalar(radiusKm);
      offsetOwn.x = scratch.x;
      offsetOwn.y = scratch.y;
      offsetOwn.z = scratch.z;
      scratch.set(-(x + offset.x), -(y + offset.y), -(z + offset.z));
      const towardEye = alongOwnAxes(scratch, scratch);
      const hidden =
        behindPlanet(offsetOwn, towardEye, squash) || behindPlanet(offsetOwn, sunOwn, squash);
      const distance = Math.hypot(x + offset.x, y + offset.y, z + offset.z);
      const width = (2 * Math.asin(JUPITER_MOON_RADII_KM[moon] / distance)) / pixel;
      moonSizes[i] = hidden ? 0 : Math.max(MOON_POINT, width);
    });
    moons.geometry.getAttribute('position').needsUpdate = true;
    moons.geometry.getAttribute('size').needsUpdate = true;
  }

  /** Names the moons that can be seen, under each. */
  function nameMoons(
    camera: { matrixWorldInverse: Matrix4; projectionMatrix: Matrix4 },
    width: number,
    height: number,
    named: boolean,
  ): void {
    const layer = labelLayer();
    if (layer && labels.current.length === 0) {
      labels.current = JUPITER_MOONS.map((moon) => {
        const label = document.createElement('span');
        label.dataset.moon = moon;
        label.textContent = JUPITER_MOON_NAMES[moon];
        label.className =
          'absolute top-0 left-0 hidden -translate-x-1/2 text-[0.65rem] leading-none text-slate-400 [text-shadow:0_1px_3px_#000]';
        return layer.appendChild(label);
      });
    }
    const placed: { x: number; y: number }[] = [];
    labels.current.forEach((label, i) => {
      const visible = named && moonSizes[i] > 0;
      if (visible) {
        point
          .set(moonPositions[i * 3], moonPositions[i * 3 + 1], moonPositions[i * 3 + 2])
          .applyMatrix4(WORLD_FROM_TEME)
          .applyMatrix4(camera.matrixWorldInverse)
          .applyMatrix4(camera.projectionMatrix);
      }
      const onScreen = visible && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z < 1;
      label.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        const x = ((point.x + 1) / 2) * width;
        let y = ((1 - point.y) / 2) * height + moonSizes[i] / 2 + 5;
        // Two moons close together in the sky: the second name a line lower.
        while (placed.some((other) => Math.abs(other.x - x) < 56 && Math.abs(other.y - y) < 11)) {
          y += 11;
        }
        placed.push({ x, y });
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
      }
    });
  }

  return <primitive object={root} />;
}
