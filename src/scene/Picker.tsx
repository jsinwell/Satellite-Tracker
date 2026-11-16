import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, Matrix4, Vector3 } from 'three';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { pickSatellite } from '../core/picking';
import { TEME_FROM_WORLD, WORLD_FROM_TEME } from './frame';

/** How close (CSS px) the pointer must be to a satellite to hit it. */
const PICK_RADIUS = { mouse: 9, touch: 22 };
/** A press that moves further than this (CSS px) is a drag, not a click. */
const CLICK_SLOP = 5;

interface Point {
  x: number;
  y: number;
}

const clipFromTeme = new Matrix4();
const eye = new Vector3();

function pick(
  world: World,
  camera: Camera,
  element: HTMLElement,
  pointer: Point,
  radiusPx: number,
): number | null {
  clipFromTeme
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(WORLD_FROM_TEME);
  eye.copy(camera.position).applyMatrix4(TEME_FROM_WORLD);

  const { simulation } = world;
  const index = pickSatellite({
    state: simulation.state,
    count: simulation.count,
    dtSeconds: simulation.dtSeconds(currentSimTime()),
    visible: useApp.getState().visible,
    clipFromTeme: clipFromTeme.elements,
    eye,
    pointer,
    viewport: { width: element.clientWidth, height: element.clientHeight },
    radiusPx,
  });
  return index === -1 ? null : index;
}

/**
 * Turns pointer input on the canvas into hover and selection.
 *
 * Hover is re-evaluated every frame, not just on pointer movement, because
 * the satellites move under a stationary pointer.
 */
export function Picker({ world }: { world: World }) {
  const camera = useThree((state) => state.camera);
  const element = useThree((state) => state.gl.domElement);
  /** Where the mouse is resting over the canvas; null when away or dragging. */
  const hoverPoint = useRef<Point | null>(null);

  useEffect(() => {
    let pressedAt: Point | null = null;

    const toLocal = (event: PointerEvent): Point => {
      const bounds = element.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.isPrimary) pressedAt = toLocal(event);
    };
    const onPointerMove = (event: PointerEvent) => {
      // Touch has no hover, and a held button means the camera is being dragged.
      hoverPoint.current =
        event.pointerType === 'mouse' && event.buttons === 0 ? toLocal(event) : null;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!pressedAt || !event.isPrimary) return;
      const released = toLocal(event);
      const travelled = Math.hypot(released.x - pressedAt.x, released.y - pressedAt.y);
      pressedAt = null;
      if (travelled > CLICK_SLOP) return;
      const radius = event.pointerType === 'mouse' ? PICK_RADIUS.mouse : PICK_RADIUS.touch;
      useApp.getState().select(pick(world, camera, element, released, radius));
    };
    const onPointerLeave = () => {
      hoverPoint.current = null;
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointerleave', onPointerLeave);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointerleave', onPointerLeave);
      useApp.getState().hover(null);
    };
  }, [world, camera, element]);

  useFrame(() => {
    const point = hoverPoint.current;
    const hovered = point ? pick(world, camera, element, point, PICK_RADIUS.mouse) : null;
    useApp.getState().hover(hovered);
    element.style.cursor = hovered === null ? 'grab' : 'pointer';
  });

  return null;
}
