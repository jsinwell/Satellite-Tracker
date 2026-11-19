import { ecfToLookAngles, eciToEcf, propagate } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { geostationary, iss } from './__fixtures__/satellites';
import { gmst, sunDirection } from './astro';
import { standardMagnitude } from './brightness';
import type { SatelliteRecord } from './catalog';
import { EARTH_RADIUS_KM, MS_PER_DAY } from './constants';
import type { Vec3 } from './kinematics';
import {
  canBeSeen,
  directionAngles,
  isObserver,
  LOW_ORBIT_DARK_SUN_ELEVATION,
  lookAngles,
  MIN_PASS_ELEVATION,
  nextViewingWindow,
  type Observer,
  observerFrame,
  type Pass,
  parseCoordinates,
  predictPasses,
  skyNow,
  skyState,
  sunElevation,
  sunElevationAt,
} from './observer';
import { createSatRec, Propagator, STATE_STRIDE } from './propagator';

const DEG = Math.PI / 180;
const epochOf = (record: SatelliteRecord) => Date.parse(record.elements.epoch);

const chicago: Observer = { latitude: 41.88, longitude: -87.63 };
const sydney: Observer = { latitude: -33.87, longitude: 151.21 };
/** On the equator, under GOES 16, which has been parked at 104.7° W since it retired. */
const underGoes: Observer = { latitude: 0, longitude: -104.7 };
const farFromGoes: Observer = { latitude: 0, longitude: 75.3 };

/** Look angles straight from satellite.js, as an independent check. */
function referenceLook(record: SatelliteRecord, observer: Observer, timeMs: number) {
  const satrec = createSatRec(record);
  const result = satrec && propagate(satrec, new Date(timeMs));
  if (!result) throw new Error('expected a position');
  const angles = ecfToLookAngles(
    { latitude: observer.latitude * DEG, longitude: observer.longitude * DEG, height: 0 },
    eciToEcf(result.position, gmst(timeMs)),
  );
  return {
    azimuth: angles.azimuth / DEG,
    elevation: angles.elevation / DEG,
    rangeKm: angles.rangeSat,
    position: result.position,
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);

describe('isObserver', () => {
  it('takes a latitude and longitude on Earth', () => {
    expect(isObserver({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isObserver({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isObserver({ latitude: 0, longitude: -181 })).toBe(false);
    expect(isObserver({ latitude: '1', longitude: 2 })).toBe(false);
    expect(isObserver(null)).toBe(false);
  });
});

describe('parseCoordinates', () => {
  it.each([
    ['41.88, -87.63', 41.88, -87.63],
    ['41.88 -87.63', 41.88, -87.63],
    ['  -33.87,151.21 ', -33.87, 151.21],
    ['41.88° N, 87.63° W', 41.88, -87.63],
    ['33.87S 151.21E', -33.87, 151.21],
    ['0, 0', 0, 0],
  ])('reads %s', (text, latitude, longitude) => {
    expect(parseCoordinates(text)).toEqual({ latitude, longitude });
  });

  it.each(['Chicago', '41.88', '41.88, -87.63, 10', '95, 10', '10, 200', '41.88 W, 87.63 N', ''])(
    'rejects %j',
    (text) => {
      expect(parseCoordinates(text)).toBeNull();
    },
  );
});

describe('observerFrame', () => {
  it('has square, unit axes, and up points away from the Earth', () => {
    const frame = observerFrame(sydney, Date.UTC(2026, 10, 16, 3));
    for (const axis of [frame.up, frame.east, frame.north]) expect(length(axis)).toBeCloseTo(1, 9);
    expect(dot(frame.up, frame.east)).toBeCloseTo(0, 9);
    expect(dot(frame.up, frame.north)).toBeCloseTo(0, 9);
    expect(dot(frame.east, frame.north)).toBeCloseTo(0, 9);
    expect(dot(frame.up, frame.position)).toBeGreaterThan(0);
  });

  it('stands on the ellipsoid, further from the center at the equator than at a pole', () => {
    const at = (latitude: number) =>
      length(observerFrame({ latitude, longitude: 30 }, Date.UTC(2026, 10, 16)).position);
    expect(at(0)).toBeCloseTo(EARTH_RADIUS_KM, 3);
    expect(at(90)).toBeCloseTo(6356.752, 2);
  });

  it('has north toward the pole', () => {
    const frame = observerFrame(chicago, Date.UTC(2026, 10, 16));
    expect(frame.north.z).toBeGreaterThan(0);
  });
});

describe('lookAngles', () => {
  it.each([
    ['Chicago', chicago, 0],
    ['Sydney', sydney, 2_000_000],
    ['the equator', underGoes, 4_000_000],
  ])('agrees with satellite.js from %s', (_, observer, offset) => {
    const timeMs = epochOf(iss) + offset;
    const reference = referenceLook(iss, observer, timeMs);
    const angles = lookAngles(observerFrame(observer, timeMs), reference.position);

    expect(angles.elevation).toBeCloseTo(reference.elevation, 6);
    expect(angles.azimuth).toBeCloseTo(reference.azimuth, 6);
    expect(angles.rangeKm).toBeCloseTo(reference.rangeKm, 3);
  });
});

describe('directionAngles', () => {
  it('agrees with lookAngles for something very far away', () => {
    const timeMs = epochOf(iss);
    const frame = observerFrame(sydney, timeMs);
    const direction = { x: 0.48, y: -0.6, z: 0.64 };
    const far = 1e12;
    const target = {
      x: frame.position.x + direction.x * far,
      y: frame.position.y + direction.y * far,
      z: frame.position.z + direction.z * far,
    };
    const near = lookAngles(frame, target);
    const angles = directionAngles(frame, direction);
    expect(angles.elevation).toBeCloseTo(near.elevation, 6);
    expect(angles.azimuth).toBeCloseTo(near.azimuth, 6);
  });

  it('is straight up along the local vertical', () => {
    const frame = observerFrame(chicago, Date.UTC(2026, 10, 16));
    expect(directionAngles(frame, frame.up).elevation).toBeCloseTo(90, 6);
  });
});

describe('sunElevation', () => {
  const equinoxNoon = Date.UTC(2026, 2, 20, 12);
  const sun = sunDirection(equinoxNoon, { x: 0, y: 0, z: 0 });

  it('puts the Sun nearly overhead at noon on the equator at the equinox', () => {
    const frame = observerFrame({ latitude: 0, longitude: 0 }, equinoxNoon);
    expect(sunElevation(frame, sun)).toBeGreaterThan(85);
  });

  it('puts it nearly straight down on the other side of the world', () => {
    const frame = observerFrame({ latitude: 0, longitude: 180 }, equinoxNoon);
    expect(sunElevation(frame, sun)).toBeLessThan(-85);
  });

  it('puts it on the horizon at a pole', () => {
    const frame = observerFrame({ latitude: 90, longitude: 0 }, equinoxNoon);
    expect(Math.abs(sunElevation(frame, sun))).toBeLessThan(1);
  });
});

describe('skyState', () => {
  it.each([
    [10, 'day'],
    [-0.5, 'day'],
    [-3, 'twilight'],
    [-6.5, 'dark'],
    [-40, 'dark'],
  ])('is %d° → %s', (elevation, state) => {
    expect(skyState(elevation)).toBe(state);
  });
});

describe('canBeSeen', () => {
  const overhead = { elevation: 40 };

  it('needs sunlight on the satellite, a dark sky, some height and enough brightness', () => {
    expect(canBeSeen(overhead, true, -12, 4)).toBe(true);
    expect(canBeSeen(overhead, false, -12, 4)).toBe(false); // in the Earth's shadow
    expect(canBeSeen(overhead, true, -2, 4)).toBe(false); // sky too bright
    expect(canBeSeen({ elevation: 5 }, true, -12, 4)).toBe(false); // too low
    expect(canBeSeen(overhead, true, -12, 9)).toBe(false); // too faint
  });

  it('lets the brightest through in twilight', () => {
    // The space station at its best, with the Sun 4 degrees down.
    expect(canBeSeen(overhead, true, -4, -3)).toBe(true);
    expect(canBeSeen(overhead, true, 5, -3)).toBe(false);
  });
});

describe('skyNow', () => {
  const satellites = [iss, geostationary];
  const timeMs = epochOf(iss) + 3_600_000;
  const state = new Float32Array(satellites.length * STATE_STRIDE);
  new Propagator(satellites).propagate(timeMs, state);
  const all = Uint8Array.of(1, 1);
  const magnitudes = Float32Array.from(satellites, standardMagnitude);

  it('lists what is above the horizon, highest first', () => {
    const sky = skyNow(observerFrame(underGoes, timeMs), timeMs, state, 2, 0, all, magnitudes);
    const goes = sky.above.find((entry) => entry.index === 1);
    expect(goes?.elevation).toBeGreaterThan(85);
    // Overhead and sunlit, perhaps, but far too far away to see.
    expect(goes?.seeable).toBe(false);
    for (const entry of sky.above) expect(entry.elevation).toBeGreaterThan(0);
  });

  it('leaves out what the filters hide', () => {
    const sky = skyNow(
      observerFrame(underGoes, timeMs),
      timeMs,
      state,
      2,
      0,
      Uint8Array.of(1, 0),
      magnitudes,
    );
    expect(sky.above.some((entry) => entry.index === 1)).toBe(false);
  });

  it('leaves out GOES 16 from the far side of the world, where it is below the horizon', () => {
    const sky = skyNow(observerFrame(farFromGoes, timeMs), timeMs, state, 2, 0, all, magnitudes);
    expect(sky.above.some((entry) => entry.index === 1)).toBe(false);
  });
});

describe('nextViewingWindow', () => {
  const losAngeles: Observer = { latitude: 34.05, longitude: -118.44 };
  const atMidnight = Date.parse('2026-11-17T08:33:00Z'); // 12:33 AM there

  it('puts low orbit in the dark at about 500 km', () => {
    expect(LOW_ORBIT_DARK_SUN_ELEVATION).toBeCloseTo(-22, 1);
  });

  it('finds the hour before dawn, from the middle of the night', () => {
    const window = nextViewingWindow(losAngeles, atMidnight);
    if (!window) throw new Error('expected a window');
    // Sunrise is about 6:30 AM, 14:30 UTC: the window ends at civil dawn,
    // around 6:05, and starts an hour or so before that.
    expect(window.startMs).toBeGreaterThan(Date.parse('2026-11-17T12:30:00Z'));
    expect(window.endMs).toBeLessThan(Date.parse('2026-11-17T14:20:00Z'));
    expect(sunElevationAt(losAngeles, window.startMs)).toBeCloseTo(LOW_ORBIT_DARK_SUN_ELEVATION, 0);
    expect(sunElevationAt(losAngeles, window.endMs)).toBeCloseTo(-6, 0);
  });

  it('starts now when now is already a good time', () => {
    const first = nextViewingWindow(losAngeles, atMidnight);
    if (!first) throw new Error('expected a window');
    const during = (first.startMs + first.endMs) / 2;
    const window = nextViewingWindow(losAngeles, during);
    expect(window?.startMs).toBe(during);
    expect(Math.abs((window?.endMs ?? 0) - first.endMs)).toBeLessThan(60_000);
  });

  it('finds none where the Sun never sets', () => {
    const arcticSummer = Date.parse('2026-06-21T00:00:00Z');
    expect(nextViewingWindow({ latitude: 80, longitude: 0 }, arcticSummer)).toBeNull();
  });
});

describe('predictPasses', () => {
  const from = epochOf(iss);
  const until = from + MS_PER_DAY;

  function passesOf(prediction: ReturnType<typeof predictPasses>): Pass[] {
    if (prediction?.kind !== 'passes') throw new Error('expected passes');
    return prediction.passes;
  }

  it('finds several ISS passes over Chicago in a day', () => {
    const passes = passesOf(predictPasses(iss, chicago, from, until, 20));
    expect(passes.length).toBeGreaterThanOrEqual(2);
    expect(passes.length).toBeLessThanOrEqual(8);
  });

  it('times each pass from the horizon, up to its peak, and back down', () => {
    const passes = passesOf(predictPasses(iss, chicago, from, until, 20));
    for (const pass of passes) {
      // Within a second of the horizon: under 0.1° for the ISS.
      expect(Math.abs(referenceLook(iss, chicago, pass.riseMs).elevation)).toBeLessThan(0.1);
      expect(Math.abs(referenceLook(iss, chicago, pass.setMs).elevation)).toBeLessThan(0.1);
      expect(pass.riseMs).toBeLessThan(pass.peakMs);
      expect(pass.peakMs).toBeLessThan(pass.setMs);
      const minutes = (pass.setMs - pass.riseMs) / 60_000;
      expect(minutes).toBeGreaterThan(2);
      expect(minutes).toBeLessThan(12);

      expect(pass.peakElevation).toBeGreaterThanOrEqual(MIN_PASS_ELEVATION);
      expect(referenceLook(iss, chicago, pass.peakMs).elevation).toBeCloseTo(pass.peakElevation, 3);
      for (const offset of [-20_000, 20_000]) {
        expect(referenceLook(iss, chicago, pass.peakMs + offset).elevation).toBeLessThan(
          pass.peakElevation,
        );
      }
      if (pass.seeable) {
        expect(pass.seeable.fromMs).toBeGreaterThanOrEqual(pass.riseMs);
        expect(pass.seeable.toMs).toBeLessThanOrEqual(pass.setMs);
      }
    }
  });

  it('lists passes in order, without overlaps', () => {
    const passes = passesOf(predictPasses(iss, chicago, from, until, 20));
    for (let i = 1; i < passes.length; i++) {
      expect(passes[i].riseMs).toBeGreaterThan(passes[i - 1].setMs);
    }
  });

  it('stops at the limit', () => {
    expect(passesOf(predictPasses(iss, chicago, from, until, 1))).toHaveLength(1);
  });

  it('starts with a pass already underway, from when it rose', () => {
    const [first] = passesOf(predictPasses(iss, chicago, from, until, 1));
    const midway = (first.riseMs + first.setMs) / 2;
    const [again] = passesOf(predictPasses(iss, chicago, midway, until, 1));
    expect(again.riseMs).toBeCloseTo(first.riseMs, -4);
    expect(again.setMs).toBeCloseTo(first.setMs, -4);
  });

  it('says a geostationary satellite overhead never sets', () => {
    const prediction = predictPasses(geostationary, underGoes, from, until, 5);
    expect(prediction?.kind).toBe('always-up');
    if (prediction?.kind === 'always-up') expect(prediction.elevation).toBeGreaterThan(85);
  });

  it('finds no passes of a geostationary satellite from the far side of the world', () => {
    expect(passesOf(predictPasses(geostationary, farFromGoes, from, until, 5))).toEqual([]);
  });

  it('returns null for elements that cannot be propagated', () => {
    const unusable = { ...iss, elements: { ...iss.elements, eccentricity: 1.5 } };
    expect(predictPasses(unusable, chicago, from, until, 5)).toBeNull();
  });
});
