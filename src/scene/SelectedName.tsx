import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { famousName } from '../core/brightness';
import { extrapolatePosition, hasState, isOccludedByEarth, type Vec3 } from '../core/kinematics';
import { TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';
import { labelLayer } from './labelLayer';

/** How far to the right of the ring round its satellite the name sits, CSS px. */
const NAME_OFFSET_PX = 20;

const eye = new Vector3();
const point = new Vector3();
const position: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The selected satellite's name, on a small plate beside the ring that marks
 * it. What was selected is then said where it is, and the panel that says
 * the rest about it can stay small until it is asked for.
 */
export function SelectedName({ world }: { world: World }) {
  const plate = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      plate.current?.remove();
      plate.current = null;
    },
    [],
  );

  useFrame(({ camera, size }) => {
    const layer = labelLayer();
    if (layer && !plate.current) {
      plate.current = document.createElement('span');
      plate.current.dataset.selectedName = '';
      plate.current.className =
        'absolute top-0 left-0 hidden rounded-full border border-chalk/10 bg-night/80 px-2 py-1 text-xs leading-none font-medium whitespace-nowrap text-chalk';
      layer.appendChild(plate.current);
    }
    const label = plate.current;
    if (!label) return;

    const { selected } = useApp.getState();
    const { simulation } = world;
    if (selected === null || !hasState(simulation.state, selected)) {
      label.style.display = 'none';
      return;
    }
    extrapolatePosition(
      simulation.state,
      selected,
      simulation.dtSeconds(currentSimTime()),
      position,
    );
    camera.updateMatrixWorld();
    eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);
    point.set(position.x, position.y, position.z).applyMatrix4(WORLD_FROM_TEME).project(camera);
    // Not behind the Earth, where its ring is hidden too, and from the
    // ground that is anywhere below the horizon.
    const shown =
      point.z < 1 &&
      Math.abs(point.x) <= 1 &&
      Math.abs(point.y) <= 1 &&
      !isOccludedByEarth(eye, position);
    label.style.display = shown ? 'block' : 'none';
    if (!shown) return;

    const record = world.satellites[selected];
    const name = famousName(record) ?? record.name;
    if (label.textContent !== name) label.textContent = name;
    const x = ((point.x + 1) / 2) * size.width + NAME_OFFSET_PX;
    const y = ((1 - point.y) / 2) * size.height;
    label.style.transform = `translate(${x}px, ${y}px) translate(0, -50%)`;
  });

  return null;
}
