import { describe, expect, it } from 'vitest';
import { geostationary, highlyElliptical, iss } from './__fixtures__/satellites';
import { subSatellitePoint } from './astro';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY } from './constants';
import {
  eccentricAnomaly,
  footprintCircle,
  footprintWidthKm,
  groundTrack,
  horizonAngle,
  sweepTimes,
} from './ground';
import { samplePositions } from './propagator';

const DEG = Math.PI / 180;
const epochOf = (record: SatelliteRecord) => Date.parse(record.elements.epoch);
const periodMs = (record: SatelliteRecord) => MS_PER_DAY / record.elements.meanMotion;

/** Latitude and longitude, degrees, of point `i` of a ground track. */
function groundPoint(track: Float32Array, i: number) {
  const [x, y, z] = track.subarray(i * 3, i * 3 + 3);
  return {
    latitude: Math.asin(z / Math.hypot(x, y, z)) / DEG,
    longitude: Math.atan2(y, x) / DEG,
  };
}

describe('eccentricAnomaly', () => {
  it.each([
    [0.3, 0],
    [1, 0.1],
    [3, 0.66],
    [6.2, 0.9],
    [0.01, 0.99],
  ])("solves Kepler's equation for M = %d, e = %d", (mean, eccentricity) => {
    const e = eccentricAnomaly(mean, eccentricity);
    expect(e - eccentricity * Math.sin(e)).toBeCloseTo(mean, 9);
  });

  it('carries whole revolutions through', () => {
    const once = eccentricAnomaly(1, 0.5);
    expect(eccentricAnomaly(1 + 4 * Math.PI, 0.5)).toBeCloseTo(once + 4 * Math.PI, 9);
    expect(eccentricAnomaly(1 - 2 * Math.PI, 0.5)).toBeCloseTo(once - 2 * Math.PI, 9);
  });
});

describe('sweepTimes', () => {
  it('runs from the given part of a revolution behind to the given part ahead', () => {
    const now = epochOf(iss) + 1_234_567;
    const times = sweepTimes(iss.elements, now, 0.25, 1, 100);

    expect(times).toHaveLength(101);
    // A quarter of the way around a nearly circular orbit takes a quarter of
    // the period, give or take a second. A whole revolution takes all of it.
    expect(Math.abs(times[0] - (now - periodMs(iss) / 4))).toBeLessThan(2000);
    expect(times[20]).toBeCloseTo(now, 3);
    expect(times[100]).toBeCloseTo(now + periodMs(iss), 0);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it('takes its smallest steps where an eccentric orbit moves fastest', () => {
    // Half a revolution either side of now, so both ends of the orbit are covered.
    const times = sweepTimes(highlyElliptical.elements, epochOf(highlyElliptical), 0.5, 0.5, 200);
    const steps = Array.from({ length: 200 }, (_, i) => times[i + 1] - times[i]);
    const { eccentricity } = highlyElliptical.elements;

    // Equal steps around the ellipse take time in proportion to the distance
    // from the Earth, which varies by (1 + e) / (1 - e) around the orbit.
    const ratio = Math.max(...steps) / Math.min(...steps);
    expect(ratio).toBeCloseTo((1 + eccentricity) / (1 - eccentricity), 1);
  });
});

describe('groundTrack', () => {
  it('is beneath the satellite', () => {
    const now = epochOf(iss) + 600_000;
    const track = groundTrack(iss, [now], EARTH_RADIUS_KM);
    const position = samplePositions(iss, [now]);
    if (!track || !position) throw new Error('expected a position');
    const [x, y, z] = position;

    expect(Math.hypot(...track)).toBeCloseTo(EARTH_RADIUS_KM, 1);
    expect(groundPoint(track, 0).longitude).toBeCloseTo(
      subSatellitePoint({ x, y, z }, now).longitude,
      2,
    );
    // Toward the Earth's center, so the latitude is the geocentric one.
    expect(groundPoint(track, 0).latitude).toBeCloseTo(Math.asin(z / Math.hypot(x, y, z)) / DEG, 3);
  });

  it('reaches as far north and south as the orbit is inclined, and no further', () => {
    const times = sweepTimes(iss.elements, epochOf(iss), 0, 1, 360);
    const track = groundTrack(iss, times, EARTH_RADIUS_KM);
    if (!track) throw new Error('expected a track');
    const latitudes = Array.from(times, (_, i) => groundPoint(track, i).latitude);

    expect(Math.max(...latitudes)).toBeCloseTo(iss.elements.inclination, 0);
    expect(Math.min(...latitudes)).toBeCloseTo(-iss.elements.inclination, 0);
  });

  it('falls further west each revolution, by as much as the Earth has turned', () => {
    const now = epochOf(iss);
    const track = groundTrack(iss, [now, now + periodMs(iss)], EARTH_RADIUS_KM);
    if (!track) throw new Error('expected a track');

    const shift = groundPoint(track, 1).longitude - groundPoint(track, 0).longitude;
    const westward = ((((shift + 180) % 360) + 360) % 360) - 180;
    // 92.9 minutes of the Earth's rotation is 23.3°; the orbit's own slow
    // westward drift adds a little.
    expect(westward).toBeGreaterThan(-24.5);
    expect(westward).toBeLessThan(-23);
  });

  it('barely moves for a geostationary satellite', () => {
    const times = sweepTimes(geostationary.elements, epochOf(geostationary), 0, 1, 48);
    const track = groundTrack(geostationary, times, EARTH_RADIUS_KM);
    if (!track) throw new Error('expected a track');
    const start = groundPoint(track, 0);

    for (let i = 0; i < times.length; i++) {
      const point = groundPoint(track, i);
      expect(Math.abs(point.longitude - start.longitude)).toBeLessThan(0.5);
      // It nods north and south by its small inclination once a day.
      expect(Math.abs(point.latitude)).toBeLessThan(geostationary.elements.inclination + 0.1);
    }
  });

  it('returns null for elements that cannot be propagated', () => {
    const unusable = { ...iss, elements: { ...iss.elements, eccentricity: 1.5 } };
    expect(groundTrack(unusable, [epochOf(iss)], EARTH_RADIUS_KM)).toBeNull();
  });
});

describe('horizonAngle', () => {
  it('is nothing at the surface and approaches a quarter turn far away', () => {
    expect(horizonAngle(EARTH_RADIUS_KM)).toBe(0);
    expect(horizonAngle(EARTH_RADIUS_KM * 1000) / DEG).toBeCloseTo(90, 0);
  });

  it('is 20° from the ISS and 81° from geostationary orbit', () => {
    expect(horizonAngle(EARTH_RADIUS_KM + 420) / DEG).toBeCloseTo(20.2, 1);
    expect(horizonAngle(42_164) / DEG).toBeCloseTo(81.3, 1);
  });

  it('is nothing, not undefined, below the surface', () => {
    expect(horizonAngle(EARTH_RADIUS_KM - 10)).toBe(0);
  });
});

describe('footprintWidthKm', () => {
  it('is about 4,500 km for the ISS', () => {
    expect(footprintWidthKm(EARTH_RADIUS_KM + 420)).toBeCloseTo(4507, -1);
  });

  it('never reaches halfway around the Earth', () => {
    expect(footprintWidthKm(EARTH_RADIUS_KM * 1e6)).toBeLessThan(Math.PI * EARTH_RADIUS_KM);
  });
});

describe('footprintCircle', () => {
  const overEquator = { x: EARTH_RADIUS_KM + 800, y: 0, z: 0 };
  const overPole = { x: 0, y: 0, z: -(EARTH_RADIUS_KM + 20_000) };
  const somewhere = { x: 3000, y: -5200, z: 4100 };

  it.each([
    ['over the equator', overEquator],
    ['over a pole', overPole],
    ['somewhere in between', somewhere],
  ])('puts the satellite on the horizon of every point, %s', (_, satellite) => {
    const segments = 24;
    const circle = footprintCircle(satellite, segments, EARTH_RADIUS_KM);

    for (let i = 0; i < segments; i++) {
      const [x, y, z] = circle.subarray(i * 3, i * 3 + 3);
      expect(Math.hypot(x, y, z)).toBeCloseTo(EARTH_RADIUS_KM, 1);
      // On the horizon, the line of sight is at right angles to straight up.
      const sight = { x: satellite.x - x, y: satellite.y - y, z: satellite.z - z };
      const cosine =
        (sight.x * x + sight.y * y + sight.z * z) /
        (Math.hypot(sight.x, sight.y, sight.z) * EARTH_RADIUS_KM);
      expect(cosine).toBeCloseTo(0, 4);
    }
  });

  it('goes all the way around the point beneath the satellite', () => {
    const segments = 24;
    const circle = footprintCircle(somewhere, segments, EARTH_RADIUS_KM);
    const center = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < segments; i++) {
      center.x += circle[i * 3] / segments;
      center.y += circle[i * 3 + 1] / segments;
      center.z += circle[i * 3 + 2] / segments;
    }

    // Points spread evenly around a circle average out to its center, which
    // lies on the line from the Earth's center to the satellite.
    const distance = Math.hypot(somewhere.x, somewhere.y, somewhere.z);
    const depth = EARTH_RADIUS_KM * Math.cos(horizonAngle(distance));
    expect(center.x).toBeCloseTo((somewhere.x / distance) * depth, 2);
    expect(center.y).toBeCloseTo((somewhere.y / distance) * depth, 2);
    expect(center.z).toBeCloseTo((somewhere.z / distance) * depth, 2);
  });
});
