import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { type Camera, Matrix4, Raycaster, Sphere, Vector2, Vector3 } from 'three';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { subSatellitePoint } from '../core/astro';
import type { Observer } from '../core/observer';
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
  // Bring the camera's matrices in line with its current position and
  // orientation. The renderer only does this when it draws, and the orbit
  // controls leave the inverse matrix half-updated (new position, old
  // orientation) after moving the camera, which would throw picks off by
  // however far the camera moved this frame.
  camera.updateMatrixWorld();
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

const raycaster = new Raycaster();
const pointerNdc = new Vector2();
/** The Earth, in world units. */
const globe = new Sphere(new Vector3(), 1);
const hit = new Vector3();

/** The place on the Earth under the pointer, or null if it points past it. */
function placeAt(camera: Camera, element: HTMLElement, pointer: Point): Observer | null {
  camera.updateMatrixWorld();
  pointerNdc.set(
    (pointer.x / element.clientWidth) * 2 - 1,
    1 - (pointer.y / element.clientHeight) * 2,
  );
  raycaster.setFromCamera(pointerNdc, camera);
  if (!raycaster.ray.intersectSphere(globe, hit)) return null;
  const { latitude, longitude } = subSatellitePoint(
    hit.applyMatrix4(TEME_FROM_WORLD),
    currentSimTime(),
  );
  // Two decimals, about a kilometer: finer than a click can aim.
  const round = (degrees: number) => Math.round(degrees * 100) / 100;
  return { latitude: round(latitude), longitude: round(longitude) };
}

/**
 * Turns pointer input on the canvas into hover and selection, or, while the
 * viewer is choosing where they are, into a place on the Earth.
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
      const traveled = Math.hypot(released.x - pressedAt.x, released.y - pressedAt.y);
      pressedAt = null;
      if (traveled > CLICK_SLOP) return;
      const { pickingObserver, setObserver } = useApp.getState();
      if (pickingObserver) {
        const place = placeAt(camera, element, released);
        if (place) setObserver(place);
        return;
      }
      const radius = event.pointerType === 'mouse' ? PICK_RADIUS.mouse : PICK_RADIUS.touch;
      const hit = pick(world, camera, element, released, radius);
      // A click on nothing clears the selection, except during a ride, where
      // there is no satellite-free sky to click on that is not part of the
      // trip. (Drags never get here: they are told apart from clicks above.)
      const { riding, select } = useApp.getState();
      if (hit !== null || !riding) select(hit);
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
    const { pickingObserver, hover } = useApp.getState();
    if (pickingObserver) {
      hover(null);
      element.style.cursor = 'crosshair';
      return;
    }
    const point = hoverPoint.current;
    const hovered = point ? pick(world, camera, element, point, PICK_RADIUS.mouse) : null;
    hover(hovered);
    element.style.cursor = hovered === null ? 'grab' : 'pointer';
  });

  return null;
}
