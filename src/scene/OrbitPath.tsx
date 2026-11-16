import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Line, LineBasicMaterial } from 'three';
import { ACCENT_COLOR } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { sampleOrbit } from '../core/propagator';

const SEGMENTS = 256;
/**
 * The path is resampled this often (real time) while a satellite is selected.
 * An orbit is not a fixed curve — it precesses and decays — so a path drawn
 * once would slowly peel away from the satellite, quickly at high time rates.
 */
const REFRESH_INTERVAL_MS = 200;

/**
 * One revolution of the selected satellite's orbit, centered on where it is
 * now. Drawn in the inertial frame, where an orbit is a closed ellipse; the
 * Earth turns underneath it.
 */
export function OrbitPath({ world }: { world: World }) {
  const { line, positions, samples } = useMemo(() => {
    const samples = new Float32Array((SEGMENTS + 1) * 3);
    const positions = new BufferAttribute(samples, 3);
    positions.setUsage(DynamicDrawUsage);
    const line = new Line(
      new BufferGeometry().setAttribute('position', positions),
      new LineBasicMaterial({ color: ACCENT_COLOR, transparent: true, opacity: 0.7 }),
    );
    line.frustumCulled = false;
    line.visible = false;
    return { line, positions, samples };
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
    const { selected } = useApp.getState();
    if (selected === null) {
      line.visible = false;
      drawn.current.index = -1;
      return;
    }
    const now = performance.now();
    if (drawn.current.index === selected && now - drawn.current.at < REFRESH_INTERVAL_MS) return;
    drawn.current = { index: selected, at: now };

    const sampled = sampleOrbit(world.satellites[selected], currentSimTime(), SEGMENTS, samples);
    positions.needsUpdate = true;
    line.visible = sampled !== null;
  });

  return <primitive object={line} />;
}
