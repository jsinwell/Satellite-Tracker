import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { satelliteColor } from '../app/palette';
import { currentSimTime, useApp } from '../app/store';
import type { World } from '../app/world';
import { soleEnabled } from '../core/constellation';
import { sampleOrbit } from '../core/propagator';
import { OVERLAY_ORDER } from './frame';
import { ScreenLine } from './ScreenLine';

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
  const line = useMemo(() => {
    // The color is set whenever the line is drawn, to match its satellite.
    const line = new ScreenLine({ capacity: SEGMENTS + 1, width: 1.5, opacity: 0.75 });
    line.renderOrder = OVERLAY_ORDER.orbit;
    line.visible = false;
    return line;
  }, []);

  useEffect(() => () => line.dispose(), [line]);

  const drawn = useRef({ index: -1, at: 0 });
  useFrame(() => {
    const { selected, colorBy, filters, overlays } = useApp.getState();
    if (selected === null || !overlays.orbit) {
      line.visible = false;
      drawn.current.index = -1;
      return;
    }
    const now = performance.now();
    if (drawn.current.index === selected && now - drawn.current.at < REFRESH_INTERVAL_MS) return;
    drawn.current = { index: selected, at: now };

    // The orbit belongs to the satellite, so it wears the satellite's color.
    const alone = soleEnabled(filters.constellations);
    line.color.set(satelliteColor(world, selected, colorBy, alone));

    const record = world.satellites[selected];
    line.visible = sampleOrbit(record, currentSimTime(), SEGMENTS, line.positions) !== null;
    line.update(SEGMENTS + 1);
  });

  return <primitive object={line} />;
}
