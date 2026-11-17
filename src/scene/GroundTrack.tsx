import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
} from 'three';
import { satelliteColor } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { gmst } from '../core/astro';
import { soleEnabled } from '../core/constellation';
import { groundTrack, sweepTimes } from '../core/ground';
import { GROUND_LINE_RADIUS_KM } from './frame';

// A little of where the satellite has just been, and its whole next revolution.
const REVOLUTIONS_BEHIND = 1 / 8;
const REVOLUTIONS_AHEAD = 1;
const SEGMENTS = 288;
/** The vertex the satellite is over at the moment the track is drawn. */
const NOW = (SEGMENTS * REVOLUTIONS_BEHIND) / (REVOLUTIONS_BEHIND + REVOLUTIONS_AHEAD);
const PEAK_OPACITY = 0.9;
/** Redrawn this often (real time), for the reason the orbit path is. */
const REFRESH_INTERVAL_MS = 200;

/** White, fading in up to the satellite and out again over the revolution ahead. */
function fade(): BufferAttribute {
  const colors = new Float32Array((SEGMENTS + 1) * 4).fill(1);
  for (let i = 0; i <= SEGMENTS; i++) {
    const ahead = (i - NOW) / (SEGMENTS - NOW);
    colors[i * 4 + 3] = PEAK_OPACITY * (i < NOW ? i / NOW : 1 - ahead * ahead);
  }
  return new BufferAttribute(colors, 4);
}

/**
 * The selected satellite's ground track: the line it traces over the Earth's
 * surface. The track is fixed to the ground, so it turns with the Earth, which
 * is why consecutive revolutions do not retrace each other.
 */
export function GroundTrack({ world }: { world: World }) {
  const { group, line, positions, samples, times } = useMemo(() => {
    const samples = new Float32Array((SEGMENTS + 1) * 3);
    const positions = new BufferAttribute(samples, 3);
    positions.setUsage(DynamicDrawUsage);
    const line = new Line(
      new BufferGeometry().setAttribute('position', positions).setAttribute('color', fade()),
      // The color is set whenever the line is drawn, to match its satellite.
      new LineBasicMaterial({ transparent: true, vertexColors: true, depthWrite: false }),
    );
    line.frustumCulled = false;
    line.visible = false;
    // Earth-fixed axes, turned to the sidereal angle every frame like the Earth.
    const group = new Group().add(line);
    return { group, line, positions, samples, times: new Float64Array(SEGMENTS + 1) };
  }, []);

  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );

  const drawn = useRef({ index: -1, at: 0 });
  useFrame(() => {
    const simMs = currentSimTime();
    group.rotation.z = gmst(simMs);

    const { selected, colorBy, filters } = useApp.getState();
    if (selected === null) {
      line.visible = false;
      drawn.current.index = -1;
      return;
    }
    const now = performance.now();
    if (drawn.current.index === selected && now - drawn.current.at < REFRESH_INTERVAL_MS) return;
    drawn.current = { index: selected, at: now };

    const alone = soleEnabled(filters.constellations);
    line.material.color.set(satelliteColor(world, selected, colorBy, alone));

    const record = world.satellites[selected];
    sweepTimes(record.elements, simMs, REVOLUTIONS_BEHIND, REVOLUTIONS_AHEAD, SEGMENTS, times);
    line.visible = groundTrack(record, times, GROUND_LINE_RADIUS_KM, samples) !== null;
    positions.needsUpdate = true;
  });

  return <primitive object={group} />;
}
