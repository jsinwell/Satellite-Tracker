import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { currentSimTime } from '../app/store';
import { EARTH_RADIUS_KM } from '../core/constants';
import { isOccludedByEarth, type Vec3 } from '../core/kinematics';
import {
  NAKED_EYE_MAGNITUDE,
  PLANET_NAMES,
  PLANETS,
  type Planet,
  type PlanetPosition,
  planetPositions,
} from '../core/planets';
import { TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';
import { labelLayer } from './labelLayer';

/**
 * The planets are drawn at a stand-in distance inside the sky sphere, like
 * the Sun; only their directions are real. Seen from the ground, the stand-in
 * shifts them by under a tenth of a degree.
 */
const PLANET_DISTANCE_KM = 750 * EARTH_RADIUS_KM;
/** Planets move slowly against the stars: placed afresh after this much simulated time. */
const REFRESH_SIM_MS = 60_000;

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
  attribute vec3 tint;
  varying vec3 vTint;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * ${GLOW_SPREAD.toFixed(1)} * uPixelRatio;
    vTint = tint;
  }
`;

// A white-hot core in the planet's tint, inside a soft glow of the same tint:
// a planet looks like a bright, steady star.
const fragmentShader = /* glsl */ `
  varying vec3 vTint;

  const float CORE = 1.0 / ${GLOW_SPREAD.toFixed(1)};

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(CORE * 0.7, CORE, d);
    float glow = 0.35 * pow(max(1.0 - d, 0.0), 2.0);
    float alpha = max(core, glow);
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
 * a dot sized by how bright it is, named beside it. Lives in the TEME group.
 */
export function Planets() {
  const { dots, positions, sizes } = useMemo(() => {
    const positions = new Float32Array(PLANETS.length * 3);
    const sizes = new Float32Array(PLANETS.length);
    const tints = new Float32Array(PLANETS.length * 3);
    PLANETS.forEach((planet, i) => {
      new Color(TINTS[planet]).toArray(tints, i * 3);
    });
    const geometry = new BufferGeometry()
      .setAttribute('position', new BufferAttribute(positions, 3))
      .setAttribute('size', new BufferAttribute(sizes, 1))
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
    return { dots, positions, sizes };
  }, []);

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

  const placed = useRef<{ atMs: number; planets: PlanetPosition[] }>({
    atMs: Number.NaN,
    planets: [],
  });

  useFrame(({ camera, size }) => {
    const simMs = currentSimTime();
    if (!(Math.abs(simMs - placed.current.atMs) < REFRESH_SIM_MS)) {
      const planets = planetPositions(simMs);
      planets.forEach(({ direction, magnitude }, i) => {
        positions[i * 3] = direction.x * PLANET_DISTANCE_KM;
        positions[i * 3 + 1] = direction.y * PLANET_DISTANCE_KM;
        positions[i * 3 + 2] = direction.z * PLANET_DISTANCE_KM;
        sizes[i] = dotSize(magnitude);
      });
      dots.geometry.getAttribute('position').needsUpdate = true;
      dots.geometry.getAttribute('size').needsUpdate = true;
      placed.current = { atMs: simMs, planets };
    }

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
    camera.updateMatrixWorld();
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    tempEye.x = eye.x;
    tempEye.y = eye.y;
    tempEye.z = eye.z;
    const shown: { index: number; x: number; y: number }[] = [];
    labels.current.forEach((label, i) => {
      const planet = placed.current.planets[i];
      tempPoint.x = positions[i * 3];
      tempPoint.y = positions[i * 3 + 1];
      tempPoint.z = positions[i * 3 + 2];
      point
        .set(tempPoint.x, tempPoint.y, tempPoint.z)
        .applyMatrix4(WORLD_FROM_TEME)
        .project(camera);
      const onScreen =
        planet !== undefined &&
        point.z < 1 &&
        Math.abs(point.x) <= 1 &&
        Math.abs(point.y) <= 1 &&
        !isOccludedByEarth(tempEye, tempPoint);
      label.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        const x = ((point.x + 1) / 2) * size.width;
        const y = ((1 - point.y) / 2) * size.height;
        shown.push({ index: i, x, y });
      }
    });

    // Boxes already spoken for, as label-height rows: every dot, then each
    // name as it is placed.
    const taken = shown.map(({ index, x, y }) => ({
      x: x - sizes[index] / 2,
      y: y - LABEL_HEIGHT / 2,
      width: sizes[index],
    }));
    const magnitude = (index: number) => placed.current.planets[index]?.magnitude ?? 0;
    shown.sort((a, b) => magnitude(a.index) - magnitude(b.index));
    for (const { index, x: dotX, y: dotY } of shown) {
      const label = labels.current[index];
      const name = PLANET_NAMES[PLANETS[index]];
      const width = labelWidth(name);
      const gap = sizes[index] / 2 + 4;
      const free = (x: number, y: number) =>
        !taken.some(
          (other) =>
            Math.abs(other.y - y) < LABEL_HEIGHT &&
            x < other.x + other.width &&
            other.x < x + width,
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
        if (free(dotX - gap - width, y)) {
          x = dotX - gap - width;
          break;
        }
      }
      taken.push({ x, y, width });
      label.style.opacity = magnitude(index) > NAKED_EYE_MAGNITUDE ? '0.55' : '1';
      label.style.transform = `translate(${x}px, ${y}px)`;
    }
  });

  return <primitive object={dots} />;
}
