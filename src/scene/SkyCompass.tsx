import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three';
import { currentSimTime, useApp } from '../app/store';
import { labelLayer } from './labelLayer';
import { createStance, stand } from './standing';

/** The eight points of the compass, clockwise from north. */
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** How far out along the horizon the labels are pinned, in Earth radii. Any distance will do. */
const REACH = 0.02;
/** A degree or two above the horizon, so the labels sit on it rather than in the ground. */
const LIFT = REACH * Math.tan((1.5 * Math.PI) / 180);

const stance = createStance();
const point = new Vector3();

/**
 * Compass points along the horizon while looking up from the ground, so the
 * directions in the sky panel and the pass list can be found.
 */
export function SkyCompass() {
  const labels = useRef<HTMLElement[]>([]);
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
      labels.current = POINTS.map((name) => {
        const label = document.createElement('span');
        label.dataset.compassPoint = name;
        // The cardinal points stand out from the ones between.
        label.className = `absolute top-0 left-0 hidden font-semibold [text-shadow:0_1px_3px_#000] ${
          name.length === 1 ? 'text-sm text-slate-100' : 'text-[0.7rem] text-slate-400'
        }`;
        label.textContent = name;
        return layer.appendChild(label);
      });
    }

    const { lookingUp, observer } = useApp.getState();
    if (!lookingUp || !observer) {
      for (const label of labels.current) label.style.display = 'none';
      return;
    }

    const { eye, east, up, north } = stand(observer, currentSimTime(), stance);
    camera.updateMatrixWorld();
    labels.current.forEach((label, i) => {
      const azimuth = (i * Math.PI) / 4;
      point
        .copy(eye)
        .addScaledVector(north, REACH * Math.cos(azimuth))
        .addScaledVector(east, REACH * Math.sin(azimuth))
        .addScaledVector(up, LIFT)
        .project(camera);
      const onScreen = point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      label.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        const x = ((point.x + 1) / 2) * size.width;
        const y = ((1 - point.y) / 2) * size.height;
        label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    });
  });

  return null;
}
