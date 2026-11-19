import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  PerspectiveCamera,
  Points,
  ShaderMaterial,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { currentSimTime } from '../app/store';
import { type PlanetDisc, planetDiscs } from '../core/bodies';
import { EARTH_RADIUS_KM } from '../core/constants';
import { isOccludedByEarth, type Vec3 } from '../core/kinematics';
import { NAKED_EYE_MAGNITUDE, PLANET_NAMES, PLANETS, type Planet } from '../core/planets';
import { TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';
import { labelLayer } from './labelLayer';
import { areDiscsDrawn, placeBody, setLatestDiscs } from './skyBodies';

/**
 * The planets are drawn at a stand-in distance from the camera, inside the
 * sky sphere, like the Sun: in the direction they really are from the camera,
 * which near the Earth is not quite their direction from its center.
 */
export const PLANET_DISTANCE_KM = 750 * EARTH_RADIUS_KM;
/** Planets move slowly against the stars: placed afresh after this much simulated time. */
const REFRESH_SIM_MS = 60_000;
/**
 * With the view narrower than this, degrees, they are placed afresh every
 * frame: Mercury covers its own width in the sky in under two minutes, and
 * Jupiter turns enough in one to see.
 */
const CLOSE_UP_FOV = 10;
/**
 * A planet's point of light gives way to its disc as the disc grows from the
 * first of these widths to the second, CSS px.
 */
const DOT_GIVES_WAY = [4, 10] as const;

/** A hint of each planet's color, as the eye sees it. */
const TINTS: Record<Planet, string> = {
  mercury: '#d6cfc4',
  venus: '#fff8e8',
  mars: '#ffa47a',
  jupiter: '#f6e7cc',
  saturn: '#efdfae',
  uranus: '#bfeaf0',
  neptune: '#9dbcff',
};

/**
 * The diameter of a planet's bright core, CSS px, for its magnitude: brighter
 * is bigger, but never lost or huge. Venus at its brightest is about 13 px and
 * Uranus 2.5; satellites are drawn at up to 6.
 */
export function dotSize(magnitude: number): number {
  return Math.min(13, Math.max(2.5, 7 - 1.2 * magnitude));
}

/** The point drawn is this much wider than the core, to leave room for the glow. */
const GLOW_SPREAD = 2.5;

const vertexShader = /* glsl */ `
  uniform float uPixelRatio;
  attribute float size;
  attribute float shown;
  attribute vec3 tint;
  varying vec3 vTint;
  varying float vShown;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * ${GLOW_SPREAD.toFixed(1)} * uPixelRatio;
    vTint = tint;
    vShown = shown;
  }
`;

// A white-hot core in the planet's tint, inside a soft glow of the same tint:
// a planet looks like a bright, steady star.
const fragmentShader = /* glsl */ `
  varying vec3 vTint;
  varying float vShown;

  const float CORE = 1.0 / ${GLOW_SPREAD.toFixed(1)};

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(CORE * 0.7, CORE, d);
    float glow = 0.35 * pow(max(1.0 - d, 0.0), 2.0);
    float alpha = max(core, glow) * vShown;
    if (alpha <= 0.0) discard;
    vec3 color = mix(vTint, vec3(1.0), 1.0 - smoothstep(0.0, CORE * 0.6, d));
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

/** Roughly how wide a name is, CSS px, at the label's size. */
const labelWidth = (name: string) => name.length * 6 + 2;
const LABEL_HEIGHT = 12;

const eye = new Vector3();
const point = new Vector3();
const tempEye: Vec3 = { x: 0, y: 0, z: 0 };
const tempPoint: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Mercury to Neptune where they are in the sky at the simulated instant, each
 * a dot sized by how bright it is, named beside it. Zoomed in far enough for
 * a planet's own disc to show, `PlanetDiscs` draws that and the dot goes.
 * Lives in the TEME group.
 */
export function Planets() {
  const { dots, positions, sizes, shown } = useMemo(() => {
    const positions = new Float32Array(PLANETS.length * 3);
    const sizes = new Float32Array(PLANETS.length);
    const shown = new Float32Array(PLANETS.length).fill(1);
    const tints = new Float32Array(PLANETS.length * 3);
    PLANETS.forEach((planet, i) => {
      new Color(TINTS[planet]).toArray(tints, i * 3);
    });
    const geometry = new BufferGeometry()
      .setAttribute('position', new BufferAttribute(positions, 3))
      .setAttribute('size', new BufferAttribute(sizes, 1))
      .setAttribute('shown', new BufferAttribute(shown, 1))
      .setAttribute('tint', new BufferAttribute(tints, 3));
    const material = new ShaderMaterial({
      uniforms: { uPixelRatio: { value: 1 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    const dots = new Points(geometry, material);
    dots.frustumCulled = false;
    dots.onBeforeRender = (renderer: WebGLRenderer) => {
      material.uniforms.uPixelRatio.value = renderer.getPixelRatio();
    };
    return { dots, positions, sizes, shown };
  }, []);

  /** How wide each planet's disc is on screen, CSS px. */
  const discWidths = useMemo(() => new Float32Array(PLANETS.length), []);

  const labels = useRef<HTMLElement[]>([]);
  useEffect(
    () => () => {
      dots.geometry.dispose();
      dots.material.dispose();
      for (const label of labels.current) label.remove();
      labels.current = [];
    },
    [dots],
  );

  const placed = useRef<{ atMs: number; planets: PlanetDisc[] }>({
    atMs: Number.NaN,
    planets: [],
  });

  useFrame(({ camera, size }) => {
    const simMs = currentSimTime();
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 90;
    if (fov < CLOSE_UP_FOV || !(Math.abs(simMs - placed.current.atMs) < REFRESH_SIM_MS)) {
      const planets = planetDiscs(simMs);
      planets.forEach(({ planet, magnitude, direction, distanceKm }, i) => {
        sizes[i] = dotSize(magnitude);
        placeBody(
          planet,
          direction.x * distanceKm,
          direction.y * distanceKm,
          direction.z * distanceKm,
        );
      });
      dots.geometry.getAttribute('size').needsUpdate = true;
      placed.current = { atMs: simMs, planets };
      setLatestDiscs(planets);
    }

    // A dot stands for a planet until the planet itself is wide enough to see.
    const pixel = MathUtils.degToRad(fov) / size.height;
    const discsDrawn = areDiscsDrawn();
    placed.current.planets.forEach(({ angularDiameter }, i) => {
      discWidths[i] = angularDiameter / pixel;
      shown[i] = discsDrawn
        ? 1 - MathUtils.smoothstep(discWidths[i], DOT_GIVES_WAY[0], DOT_GIVES_WAY[1])
        : 1;
    });
    dots.geometry.getAttribute('shown').needsUpdate = true;

    // Each frame, as the camera moves: the true position less the camera's,
    // scaled down to the stand-in distance.
    camera.updateMatrixWorld();
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    placed.current.planets.forEach(({ direction, distanceKm }, i) => {
      const x = direction.x * distanceKm - eye.x;
      const y = direction.y * distanceKm - eye.y;
      const z = direction.z * distanceKm - eye.z;
      const scale = PLANET_DISTANCE_KM / Math.hypot(x, y, z);
      positions[i * 3] = eye.x + x * scale;
      positions[i * 3 + 1] = eye.y + y * scale;
      positions[i * 3 + 2] = eye.z + z * scale;
    });
    dots.geometry.getAttribute('position').needsUpdate = true;

    const layer = labelLayer();
    if (layer && labels.current.length === 0) {
      labels.current = PLANETS.map((planet) => {
        const label = document.createElement('span');
        label.dataset.planet = planet;
        label.textContent = PLANET_NAMES[planet];
        label.className =
          'absolute top-0 left-0 hidden text-[0.65rem] leading-none text-slate-300 [text-shadow:0_1px_3px_#000]';
        return layer.appendChild(label);
      });
    }

    // Named only where the planet itself shows: not behind the Earth, and on
    // screen. Too faint to see by eye, the name is dimmer. Planets do pass
    // close by each other, so names keep clear of the other planets and of
    // each other, the brightest placed first.
    tempEye.x = eye.x;
    tempEye.y = eye.y;
    tempEye.z = eye.z;
    const onScreen: { index: number; x: number; y: number }[] = [];
    labels.current.forEach((label, i) => {
      const planet = placed.current.planets[i];
      tempPoint.x = positions[i * 3];
      tempPoint.y = positions[i * 3 + 1];
      tempPoint.z = positions[i * 3 + 2];
      point
        .set(tempPoint.x, tempPoint.y, tempPoint.z)
        .applyMatrix4(WORLD_FROM_TEME)
        .project(camera);
      const visible =
        planet !== undefined &&
        point.z < 1 &&
        Math.abs(point.x) <= 1 &&
        Math.abs(point.y) <= 1 &&
        !isOccludedByEarth(tempEye, tempPoint);
      label.style.display = visible ? 'block' : 'none';
      if (visible) {
        const x = ((point.x + 1) / 2) * size.width;
        const y = ((1 - point.y) / 2) * size.height;
        onScreen.push({ index: i, x, y });
      }
    });

    // Boxes already spoken for, as label-height rows: every dot, then each
    // name as it is placed.
    const width = (index: number) => Math.max(sizes[index], discWidths[index]);
    const taken = onScreen.map(({ index, x, y }) => ({
      x: x - width(index) / 2,
      y: y - LABEL_HEIGHT / 2,
      width: width(index),
    }));
    const magnitude = (index: number) => placed.current.planets[index]?.magnitude ?? 0;
    onScreen.sort((a, b) => magnitude(a.index) - magnitude(b.index));
    for (const { index, x: dotX, y: dotY } of onScreen) {
      const label = labels.current[index];
      const name = PLANET_NAMES[PLANETS[index]];
      const nameWidth = labelWidth(name);
      const gap = width(index) / 2 + 4;
      const free = (x: number, y: number) =>
        !taken.some(
          (other) =>
            Math.abs(other.y - y) < LABEL_HEIGHT &&
            x < other.x + other.width &&
            other.x < x + nameWidth,
        );
      // To the right of the dot; else to its left, so it still reads as this
      // planet's name; else a line further down, and so on.
      let x = dotX + gap;
      let y = dotY - LABEL_HEIGHT / 2;
      for (let line = 0; line < PLANETS.length; line++) {
        y = dotY - LABEL_HEIGHT / 2 + line * LABEL_HEIGHT;
        if (free(dotX + gap, y)) {
          x = dotX + gap;
          break;
        }
        if (free(dotX - gap - nameWidth, y)) {
          x = dotX - gap - nameWidth;
          break;
        }
      }
      taken.push({ x, y, width: nameWidth });
      label.style.opacity = magnitude(index) > NAKED_EYE_MAGNITUDE ? '0.55' : '1';
      label.style.transform = `translate(${x}px, ${y}px)`;
    }
  });

  return <primitive object={dots} />;
}
