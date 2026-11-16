import { useCallback, useEffect, useState } from 'react';
import { currentSimTime } from '../app/store';
import type { World } from '../app/world';
import { isSunlit, subSatellitePoint } from '../core/astro';
import { wallNow } from '../core/clock';
import { extrapolatePosition, hasState, speed, type Vec3 } from '../core/kinematics';

/**
 * Re-evaluates `read` on an interval. The simulation changes every frame;
 * panels that display it sample it a few times a second instead of
 * re-rendering React at the frame rate.
 *
 * `read` must be referentially stable (module-level or `useCallback`).
 */
function usePolled<T>(read: () => T, intervalMs: number): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    const timer = setInterval(() => setValue(read()), intervalMs);
    return () => clearInterval(timer);
  }, [read, intervalMs]);
  return value;
}

/** The simulated instant, refreshed every `intervalMs`. */
export function useSimTime(intervalMs: number): number {
  return usePolled(currentSimTime, intervalMs);
}

/** The real, present instant, refreshed every `intervalMs`. */
export function useWallTime(intervalMs: number): number {
  return usePolled(wallNow, intervalMs);
}

export interface Telemetry {
  /** Degrees, north positive. */
  latitude: number;
  /** Degrees, east positive. */
  longitude: number;
  altitudeKm: number;
  speedKmS: number;
  sunlit: boolean;
}

const TELEMETRY_INTERVAL_MS = 250;
const scratch: Vec3 = { x: 0, y: 0, z: 0 };

function readTelemetry(world: World, index: number): Telemetry | null {
  const { simulation } = world;
  if (!hasState(simulation.state, index)) return null;
  const simMs = currentSimTime();
  const position = extrapolatePosition(
    simulation.state,
    index,
    simulation.dtSeconds(simMs),
    scratch,
  );
  return {
    ...subSatellitePoint(position, simMs),
    speedKmS: speed(simulation.state, index),
    sunlit: isSunlit(position, simMs),
  };
}

/** Live position of one satellite, or null while it has no propagated state. */
export function useTelemetry(world: World, index: number): Telemetry | null {
  const read = useCallback(() => readTelemetry(world, index), [world, index]);
  return usePolled(read, TELEMETRY_INTERVAL_MS);
}
