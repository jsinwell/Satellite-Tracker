import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { MathUtils, Vector3 } from 'three';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sunDirection } from '../core/astro';
import { faintestSeen, famousName, namedOverhead } from '../core/brightness';
import { extrapolatePosition, hasState, type Vec3 } from '../core/kinematics';
import { TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';
import { labelLayer } from './labelLayer';
import { groundView } from './standing';

/** No more names than this at once: they are for finding the few worth finding. */
const MOST_NAMES = 5;
/** Which satellites are named is worked out afresh this often, ms: it changes over seconds. */
const CHOOSE_EVERY_MS = 500;
/** How far to the right of its satellite a name sits, CSS px. */
const NAME_OFFSET_PX = 13;

const eye = new Vector3();
const point = new Vector3();
const up: Vec3 = { x: 0, y: 0, z: 0 };
const sun: Vec3 = { x: 0, y: 0, z: 0 };
const position: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Names beside the few satellites worth one, looking up at the ones that can
 * be seen: the space stations and Hubble whenever they show, and anything
 * else as bright as a bright star. Drawn as lights they all look alike, and
 * these are the ones people go out to look for.
 */
export function SatelliteNames({ world }: { world: World }) {
  const labels = useRef<HTMLElement[]>([]);
  const named = useRef<{ atMs: number; indices: number[] }>({ atMs: Number.NaN, indices: [] });
  useEffect(
    () => () => {
      for (const label of labels.current) label.remove();
      labels.current = [];
    },
    [],
  );

  useFrame(({ camera, size }) => {
    const layer = labelLayer();
    if (layer && labels.current.length === 0) {
      labels.current = Array.from({ length: MOST_NAMES }, () => {
        const label = document.createElement('span');
        label.dataset.satelliteName = '';
        label.className =
          'absolute top-0 left-0 hidden text-[0.65rem] leading-none text-slate-200 [text-shadow:0_1px_3px_#000]';
        return layer.appendChild(label);
      });
    }

    const { skyShows, visible, selected } = useApp.getState();
    // Only where the satellites are lights: marked, they are too many to
    // name, and each says what it is to the pointer.
    if (skyShows === 'all' || groundView(camera.position.length() - 1) <= 0.5) {
      for (const label of labels.current) label.style.display = 'none';
      named.current.atMs = Number.NaN;
      return;
    }

    const { simulation } = world;
    const simMs = currentSimTime();
    const dtSeconds = simulation.dtSeconds(simMs);
    camera.updateMatrixWorld();
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    const now = performance.now();
    if (!(now - named.current.atMs < CHOOSE_EVERY_MS)) {
      const radius = Math.max(1, eye.length());
      up.x = eye.x / radius;
      up.y = eye.y / radius;
      up.z = eye.z / radius;
      sunDirection(simMs, sun);
      const sunHeight = sun.x * up.x + sun.y * up.y + sun.z * up.z;
      named.current = {
        atMs: now,
        indices: namedOverhead(
          {
            state: simulation.state,
            count: simulation.count,
            dtSeconds,
            shown: visible,
            standardMagnitudes: world.standardMagnitudes,
            famous: world.famous,
            eye,
            up,
            sun,
            faintest: faintestSeen(
              skyShows,
              MathUtils.radToDeg(Math.asin(MathUtils.clamp(sunHeight, -1, 1))),
            ),
          },
          MOST_NAMES,
        ),
      };
    }

    labels.current.forEach((label, i) => {
      const index = named.current.indices[i];
      // The selected one has its marker, and its name in the panel.
      if (index === undefined || index === selected || !hasState(simulation.state, index)) {
        label.style.display = 'none';
        return;
      }
      extrapolatePosition(simulation.state, index, dtSeconds, position);
      point.set(position.x, position.y, position.z).applyMatrix4(WORLD_FROM_TEME).project(camera);
      const onScreen = point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      label.style.display = onScreen ? 'block' : 'none';
      if (!onScreen) return;
      const record = world.satellites[index];
      const name = famousName(record) ?? record.name;
      if (label.textContent !== name) label.textContent = name;
      const x = ((point.x + 1) / 2) * size.width + NAME_OFFSET_PX;
      const y = ((1 - point.y) / 2) * size.height;
      label.style.transform = `translate(${x}px, ${y}px) translate(0, -50%)`;
    });
  });

  return null;
}
