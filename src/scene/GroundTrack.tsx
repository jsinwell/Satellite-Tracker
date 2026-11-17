import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { type Camera, Group, Vector3 } from 'three';
import { GROUND_TRACK_COLOR } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { gmst } from '../core/astro';
import { MS_PER_DAY } from '../core/constants';
import {
  groundTrack,
  MAX_MARKS_PER_REVOLUTION,
  markStepMs,
  markTimes,
  sweepTimes,
} from '../core/ground';
import { GROUND_LINE_RADIUS_KM, OVERLAY_ORDER } from './frame';
import { GroundDots } from './GroundDots';
import { labelLayer } from './labelLayer';
import { ScreenLine } from './ScreenLine';

// A little of where the satellite has just been, and its whole next revolution.
const REVOLUTIONS_BEHIND = 1 / 8;
const REVOLUTIONS_AHEAD = 1;
const SEGMENTS = 288;
/** The vertex the satellite is over at the moment the track is drawn. */
const NOW = (SEGMENTS * REVOLUTIONS_BEHIND) / (REVOLUTIONS_BEHIND + REVOLUTIONS_AHEAD);
/** Redrawn this often (real time), for the reason the orbit path is. */
const REFRESH_INTERVAL_MS = 200;
/** A time label this close (CSS px) to another one, or to the satellite's own spot, is left out. */
const LABEL_SPACING_PX = 44;
/** Labels on marks this faint are left out: the track has all but faded there. */
const MIN_LABEL_OPACITY = 0.3;

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * How strongly the track is drawn at a point `ahead` of now, as a fraction of
 * the revolution ahead: fully at the satellite, fading out toward a revolution
 * on, where the next pass would start to cross this one.
 */
function strengthAhead(ahead: number): number {
  return 1 - ahead * ahead;
}

function trackFade(line: ScreenLine): void {
  for (let i = 0; i <= SEGMENTS; i++) {
    line.alphas[i] = i < NOW ? i / NOW : strengthAhead((i - NOW) / (SEGMENTS - NOW));
  }
}

const point = new Vector3();
const eye = new Vector3();

/**
 * Where on the screen a point in the track's Earth-fixed frame is, in CSS
 * pixels, or null if the Earth hides it or it is off screen.
 */
function toScreen(
  group: Group,
  camera: Camera,
  width: number,
  height: number,
  local: ArrayLike<number>,
  offset: number,
): { x: number; y: number } | null {
  point.set(local[offset], local[offset + 1], local[offset + 2]).applyMatrix4(group.matrixWorld);
  // On the far side of the Earth if the camera is below its local horizon.
  eye.copy(camera.position).sub(point);
  if (eye.dot(point) <= 0) return null;
  point.project(camera);
  if (point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
}

/** One label per mark, created in the label layer on first use. */
function useLabels(): () => HTMLElement[] {
  const labels = useRef<HTMLElement[]>([]);
  useEffect(
    () => () => {
      for (const label of labels.current) label.remove();
      labels.current = [];
    },
    [],
  );
  return () => {
    const layer = labelLayer();
    if (layer && labels.current.length === 0) {
      labels.current = Array.from({ length: MAX_MARKS_PER_REVOLUTION }, () => {
        const label = document.createElement('span');
        label.dataset.trackLabel = '';
        label.className =
          'absolute top-0 left-0 hidden rounded bg-slate-950/75 px-1 py-0.5 font-mono text-[0.65rem] leading-none whitespace-nowrap text-slate-100';
        return layer.appendChild(label);
      });
    }
    return labels.current;
  };
}

/**
 * The selected satellite's ground track: the line it traces over the Earth's
 * surface, fixed to the ground and turning with it, which is why one
 * revolution does not retrace the last. Dots along it mark round clock times
 * (UTC, like the time bar), labeled where there is room, so it reads as when
 * the satellite will be over each place.
 */
export function GroundTrack({ world }: { world: World }) {
  const { group, line, marks, times } = useMemo(() => {
    const line = new ScreenLine({ capacity: SEGMENTS + 1, width: 2, color: GROUND_TRACK_COLOR });
    line.renderOrder = OVERLAY_ORDER.groundTrack;
    trackFade(line);
    const marks = new GroundDots(MAX_MARKS_PER_REVOLUTION, GROUND_TRACK_COLOR);
    marks.sizes.fill(7);
    marks.renderOrder = OVERLAY_ORDER.marks;
    // Earth-fixed axes, turned to the sidereal angle every frame like the Earth.
    const group = new Group().add(line, marks);
    group.visible = false;
    return { group, line, marks, times: new Float64Array(SEGMENTS + 1) };
  }, []);

  useEffect(
    () => () => {
      line.dispose();
      marks.dispose();
    },
    [line, marks],
  );

  const labels = useLabels();
  const drawn = useRef({ index: -1, at: 0, marks: 0 });

  useFrame(({ camera, size }) => {
    const simMs = currentSimTime();
    group.rotation.z = gmst(simMs);

    const { selected, overlays } = useApp.getState();
    const shown = selected !== null && overlays.groundTrack;
    if (!shown) {
      group.visible = false;
      drawn.current.index = -1;
      for (const label of labels()) label.style.display = 'none';
      return;
    }

    const now = performance.now();
    if (drawn.current.index !== selected || now - drawn.current.at >= REFRESH_INTERVAL_MS) {
      const record = world.satellites[selected];
      const periodMs = MS_PER_DAY / record.elements.meanMotion;
      sweepTimes(record.elements, simMs, REVOLUTIONS_BEHIND, REVOLUTIONS_AHEAD, SEGMENTS, times);
      const markAt = markTimes(
        simMs,
        simMs + periodMs * REVOLUTIONS_AHEAD,
        markStepMs(periodMs),
        MAX_MARKS_PER_REVOLUTION,
      );
      group.visible =
        groundTrack(record, times, GROUND_LINE_RADIUS_KM, line.positions) !== null &&
        groundTrack(record, markAt, GROUND_LINE_RADIUS_KM, marks.positions) !== null;
      line.update(SEGMENTS + 1);
      markAt.forEach((t, i) => {
        marks.alphas[i] = strengthAhead((t - simMs) / (periodMs * REVOLUTIONS_AHEAD));
        const label = labels()[i];
        if (label) label.textContent = clockFormat.format(t);
      });
      marks.update(markAt.length);
      drawn.current = { index: selected, at: now, marks: markAt.length };
    }

    // The labels follow the marks across the screen every frame, as the camera
    // and the Earth turn. Each one keeps clear of the satellite's own spot and
    // of the labels placed before it, so where marks bunch up (a slow stretch
    // of an eccentric orbit, or a satellite that hangs over one place) only
    // the first of them is labeled.
    group.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const placed: { x: number; y: number }[] = [];
    const beneath = group.visible
      ? toScreen(group, camera, size.width, size.height, line.positions, NOW * 3)
      : null;
    if (beneath) placed.push(beneath);
    labels().forEach((label, i) => {
      const at =
        group.visible && i < drawn.current.marks && marks.alphas[i] >= MIN_LABEL_OPACITY
          ? toScreen(group, camera, size.width, size.height, marks.positions, i * 3)
          : null;
      const crowded =
        at === null ||
        placed.some((other) => Math.hypot(other.x - at.x, other.y - at.y) < LABEL_SPACING_PX);
      if (at === null || crowded) {
        label.style.display = 'none';
        return;
      }
      placed.push(at);
      label.style.display = 'block';
      label.style.opacity = String(marks.alphas[i]);
      label.style.transform = `translate(${at.x + 8}px, ${at.y - 8}px)`;
    });
  });

  return <primitive object={group} />;
}
