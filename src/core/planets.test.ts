import { MakeTime, RotateVector, Rotation_EQJ_EQD, Vector } from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { brightnessWords, j2000ToDate, type Planet, planetPositions, planetsUp } from './planets';

const DEG = Math.PI / 180;

/**
 * Apparent right ascension and declination of date, and visual magnitude,
 * from JPL Horizons (DE441 and satellite ephemerides) for 2026-11-17 00:00
 * UT, as seen from the Earth's center.
 */
const HORIZONS: Partial<Record<Planet, { ra: number; dec: number; magnitude: number }>> = {
  mercury: { ra: 214.479766, dec: -11.299484, magnitude: -0.198 },
  venus: { ra: 200.942788, dec: -9.87642, magnitude: -4.838 },
  mars: { ra: 149.141292, dec: 14.619188, magnitude: 0.684 },
  jupiter: { ra: 148.459003, dec: 13.572083, magnitude: -2.096 },
  saturn: { ra: 8.793582, dec: 0.921844, magnitude: 0.54 },
};
const MOMENT = Date.UTC(2026, 10, 17);

/** The angle between two directions, degrees. */
function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const cosine =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, cosine)) / DEG;
}

describe('planetPositions', () => {
  const positions = planetPositions(MOMENT);

  it('gives all seven, as unit vectors', () => {
    expect(positions.map((p) => p.planet)).toEqual([
      'mercury',
      'venus',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);
    for (const { direction } of positions) {
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
    }
  });

  it.each(Object.entries(HORIZONS))(
    'puts %s where JPL Horizons does, within about an arcminute',
    (planet, expected) => {
      const position = positions.find((p) => p.planet === planet);
      if (!position || !expected) throw new Error(`no ${planet}`);
      const { x, y, z } = position.direction;
      const ra = (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
      const dec = Math.asin(z) / DEG;
      // A minute of arc is 0.017°. The equinox the satellites use (TEME) differs
      // from Horizons' true equinox by up to about 0.005° more.
      expect(separation(ra, dec, expected.ra, expected.dec)).toBeLessThan(0.025);
    },
  );

  it.each(Object.entries(HORIZONS))('gets the brightness of %s right', (planet, expected) => {
    const position = positions.find((p) => p.planet === planet);
    expect(position?.magnitude).toBeCloseTo(expected?.magnitude ?? Number.NaN, 0);
  });
});

describe('j2000ToDate', () => {
  const m = j2000ToDate(MOMENT);
  const apply = ([x, y, z]: number[]) => [
    m[0] * x + m[1] * y + m[2] * z,
    m[3] * x + m[4] * y + m[5] * z,
    m[6] * x + m[7] * y + m[8] * z,
  ];

  it('is a rotation', () => {
    const columns = [0, 1, 2].map((c) => [m[c], m[3 + c], m[6 + c]]);
    for (const a of columns) {
      for (const b of columns) {
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(dot).toBeCloseTo(a === b ? 1 : 0, 9);
      }
    }
  });

  it('has moved the equinox by about a third of a degree since 2000', () => {
    // Precession is about 50 arcseconds a year, and 2026 is 27 years on.
    const [x, y, z] = apply([1, 0, 0]);
    const moved = Math.acos(x / Math.hypot(x, y, z)) / DEG;
    expect(moved).toBeGreaterThan(0.33);
    expect(moved).toBeLessThan(0.4);
  });

  it('turns vectors the same way astronomy-engine does, not transposed', () => {
    // The planets above are checked against Horizons through RotateVector;
    // this ties the matrix handed to three.js to the same rotation.
    const vector = new Vector(0.3, -0.5, 0.81, MakeTime(new Date(MOMENT)));
    const expected = RotateVector(Rotation_EQJ_EQD(new Date(MOMENT)), vector);
    const [x, y, z] = apply([vector.x, vector.y, vector.z]);
    expect(x).toBeCloseTo(expected.x, 12);
    expect(y).toBeCloseTo(expected.y, 12);
    expect(z).toBeCloseTo(expected.z, 12);
  });
});

describe('brightnessWords', () => {
  it.each([
    [-4.6, 'brilliant'],
    [-2.1, 'very bright'],
    [0.5, 'bright'],
    [2.5, 'faint'],
    [5.7, 'barely visible'],
    [7.8, 'telescope only'],
  ])('calls magnitude %d %s', (magnitude, words) => {
    expect(brightnessWords(magnitude)).toBe(words);
  });
});

describe('planetsUp', () => {
  // From the North Pole the sky turns about the zenith, and a planet's height
  // above the horizon is simply its declination.
  const northPole = { latitude: 90, longitude: 0 };
  const up = planetsUp(northPole, MOMENT);
  const names = up.map((entry) => entry.planet);

  it('lists the planets north of the celestial equator, and not those south of it', () => {
    expect(names).toEqual(expect.arrayContaining(['mars', 'jupiter', 'saturn']));
    expect(names).not.toContain('mercury');
    expect(names).not.toContain('venus');
  });

  it('puts each at its declination', () => {
    for (const planet of ['mars', 'jupiter', 'saturn'] as const) {
      const entry = up.find((e) => e.planet === planet);
      expect(entry?.elevation).toBeCloseTo(HORIZONS[planet]?.dec ?? Number.NaN, 1);
    }
  });

  it('leaves out what only a telescope shows, and puts the brightest first', () => {
    expect(names).not.toContain('neptune');
    for (let i = 1; i < up.length; i++) {
      expect(up[i].magnitude).toBeGreaterThanOrEqual(up[i - 1].magnitude);
    }
  });
});
