import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Group, Vector3 } from 'three';
import { MARK_COLOR } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import { gmst } from '../core/astro';
import type { Observer } from '../core/observer';
import { GROUND_LINE_RADIUS_KM, OVERLAY_ORDER } from './frame';
import { GroundDots } from './GroundDots';
import { labelLayer, screenPosition } from './labelLayer';

const DEG = Math.PI / 180;
const point = new Vector3();

/**
 * Where on the drawn globe an observer stands, Earth-fixed. Along the
 * geodetic "up", which is close enough to the center's direction at this
 * scale, and on the sphere the Earth is drawn as.
 */
function placeOnGlobe(observer: Observer, out: Float32Array): void {
  const latitude = observer.latitude * DEG;
  const longitude = observer.longitude * DEG;
  out[0] = GROUND_LINE_RADIUS_KM * Math.cos(latitude) * Math.cos(longitude);
  out[1] = GROUND_LINE_RADIUS_KM * Math.cos(latitude) * Math.sin(longitude);
  out[2] = GROUND_LINE_RADIUS_KM * Math.sin(latitude);
}

/** A dot where the viewer said they are, labeled "You". */
export function ObserverMarker() {
  const { group, dot } = useMemo(() => {
    const dot = new GroundDots(1, MARK_COLOR);
    dot.sizes[0] = 10;
    dot.renderOrder = OVERLAY_ORDER.marks;
    dot.update(1);
    // Earth-fixed axes, turned to the sidereal angle every frame like the Earth.
    const group = new Group().add(dot);
    group.visible = false;
    return { group, dot };
  }, []);

  const label = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      dot.dispose();
      label.current?.remove();
    },
    [dot],
  );

  const placed = useRef<Observer | null>(null);
  useFrame(({ camera, size }) => {
    const { lookingUp } = useApp.getState();
    // Standing there, the viewer needs no telling where they are.
    const observer = lookingUp ? null : useApp.getState().observer;
    group.visible = observer !== null;
    group.rotation.z = gmst(currentSimTime());
    if (observer && observer !== placed.current) {
      placeOnGlobe(observer, dot.positions);
      dot.update(1);
      placed.current = observer;
    }

    const layer = labelLayer();
    if (layer && !label.current) {
      label.current = document.createElement('span');
      label.current.className =
        'absolute top-0 left-0 hidden rounded-sm bg-night/80 px-1 py-0.5 text-2xs leading-none font-medium text-chalk';
      label.current.textContent = 'You';
      layer.appendChild(label.current);
    }
    if (!label.current) return;

    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const at = observer
      ? screenPosition(
          point.fromArray(dot.positions).applyMatrix4(group.matrixWorld),
          camera,
          size.width,
          size.height,
        )
      : null;
    label.current.style.display = at ? 'block' : 'none';
    if (at) label.current.style.transform = `translate(${at.x + 9}px, ${at.y - 8}px)`;
  });

  return <primitive object={group} />;
}
