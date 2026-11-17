import { describe, expect, it } from 'vitest';
import { rideElevation } from './ride';

const DEG = Math.PI / 180;

/**
 * How far below the Earth's limb (radians) the satellite appears to a camera
 * `distance` behind it and raised by `elevation`. Worked out from positions,
 * independently of the function under test.
 */
function belowLimb(radius: number, distance: number, elevation: number): number {
  // In the plane of the orbit: Earth's center at the origin, satellite straight up.
  const camera = { x: distance * Math.cos(elevation), y: radius + distance * Math.sin(elevation) };
  const toSatellite = { x: -camera.x, y: radius - camera.y };
  const height = Math.hypot(camera.x, camera.y);
  const fromStraightDown = Math.acos(
    (toSatellite.x * -camera.x + toSatellite.y * -camera.y) / (distance * height),
  );
  return Math.asin(1 / height) - fromStraightDown;
}

describe('rideElevation', () => {
  it.each([
    ['the ISS', 1.066, 0.15],
    ['a Starlink satellite, from further back', 1.086, 0.4],
    ['a satellite at 1,400 km', 1.22, 0.33],
  ])('puts the horizon the asked-for margin above %s', (_, radius, distance) => {
    const margin = 6 * DEG;
    const elevation = rideElevation(radius, distance, margin);
    expect(belowLimb(radius, distance, elevation)).toBeCloseTo(margin, 6);
  });

  it('looks more steeply down the higher the satellite is', () => {
    const elevations = [1.05, 1.2, 1.6, 2.5].map((radius) => rideElevation(radius, 0.3, 6 * DEG));
    for (let i = 1; i < elevations.length; i++) {
      expect(elevations[i]).toBeGreaterThan(elevations[i - 1]);
    }
  });

  it('looks almost straight down from geostationary orbit, the only way to see the Earth', () => {
    const elevation = rideElevation(6.61, 0.6, 6 * DEG);
    expect(elevation / DEG).toBeGreaterThan(80);
    expect(elevation / DEG).toBeLessThan(90);
    // The satellite is still in front of the Earth, not out past its edge.
    expect(belowLimb(6.61, 0.6, elevation)).toBeGreaterThan(0);
  });
});
