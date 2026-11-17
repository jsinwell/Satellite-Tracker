import { describe, expect, it } from 'vitest';
import { AU_KM, moonPosition, sunPosition } from './astro';
import { EARTH_RADIUS_KM } from './constants';
import {
  discCoverage,
  eclipseFrom,
  MOON_RADIUS_KM,
  SUN_RADIUS_KM,
  sunHiddenByEarth,
  sunHiddenByMoon,
} from './eclipse';
import type { Vec3 } from './kinematics';
import { type Observer, observerFrame } from './observer';

const DEG = Math.PI / 180;
const vec = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe('discCoverage', () => {
  it('is nothing when the discs are apart, and all when one hides the other', () => {
    expect(discCoverage(1, 1, 2.5)).toBe(0);
    expect(discCoverage(1, 1.1, 0.05)).toBe(1);
  });

  it('leaves a ring when the cover is the smaller', () => {
    expect(discCoverage(1, 0.9, 0)).toBeCloseTo(0.81, 9);
  });

  it('matches the lens between two equal circles a radius apart', () => {
    // Two lens halves, each a 120° sector less its triangle.
    const expected = (2 * Math.PI) / 3 - Math.sqrt(3) / 2;
    expect(discCoverage(1, 1, 1)).toBeCloseTo(expected / Math.PI, 9);
  });

  it('grows steadily as the discs close', () => {
    let last = 0;
    for (let d = 2; d >= 0; d -= 0.05) {
      const covered = discCoverage(1, 1.05, d);
      expect(covered).toBeGreaterThanOrEqual(last);
      last = covered;
    }
    expect(last).toBe(1);
  });
});

/** Right ascension and declination, degrees, and distance, km, of an inertial vector. */
function sky(v: Vec3) {
  const distance = Math.hypot(v.x, v.y, v.z);
  return {
    ra: (((Math.atan2(v.y, v.x) / DEG) % 360) + 360) % 360,
    dec: Math.asin(v.z / distance) / DEG,
    distance,
  };
}

function separation(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const cosine =
    Math.sin(dec1 * DEG) * Math.sin(dec2 * DEG) +
    Math.cos(dec1 * DEG) * Math.cos(dec2 * DEG) * Math.cos((ra1 - ra2) * DEG);
  return Math.acos(Math.min(1, cosine)) / DEG;
}

describe('the Sun and Moon against JPL Horizons', () => {
  // Apparent right ascension and declination of date, and distance, seen from
  // the Earth's center (Horizons, DE441).
  it.each([
    ['Moon', '2027-08-02T10:06:00Z', 132.409952646, 17.89919355, 0.00238896345521],
    ['Moon', '2026-11-17T00:00:00Z', 321.774244531, -15.568812699, 0.00267090120464],
    ['Sun', '2027-08-02T10:06:00Z', 132.361530802, 17.761593564, 1.01491147690812],
  ])('places the %s at %s', (body, instant, ra, dec, au) => {
    const timeMs = Date.parse(instant);
    const position = sky(
      body === 'Moon' ? moonPosition(timeMs, vec()) : sunPosition(timeMs, vec()),
    );
    // A hundredth of a degree is 36 seconds of arc. At the Moon's distance
    // that is 60 km, a quarter of the width of the 2027 path of totality.
    expect(separation(position.ra, position.dec, ra, dec)).toBeLessThan(0.01);
    expect(position.distance / (au * AU_KM)).toBeCloseTo(1, 3);
  });
});

describe('the total solar eclipse of 2 August 2027', () => {
  // NASA's prediction (Espenak): greatest eclipse at 10:06:37.7 UT at
  // 25°30.3' N, 33°11.0' E, near Luxor, with the Moon 1.0790 times the Sun's
  // apparent size, a path 257.7 km wide and 6 m 22.6 s of totality there.
  const greatest = Date.parse('2027-08-02T10:06:37.7Z');
  const luxor: Observer = { latitude: 25.505, longitude: 33.1833 };

  function hidden(observer: Observer, timeMs: number): number {
    const { position } = observerFrame(observer, timeMs);
    return sunHiddenByMoon(position, sunPosition(timeMs, vec()), moonPosition(timeMs, vec()));
  }

  it('is total at the point of greatest eclipse', () => {
    expect(hidden(luxor, greatest)).toBe(1);
  });

  it('has the Moon looking about 8% larger than the Sun there', () => {
    const { position } = observerFrame(luxor, greatest);
    const sun = sunPosition(greatest, vec());
    const moon = moonPosition(greatest, vec());
    const size = (body: Vec3, radius: number) =>
      Math.asin(radius / Math.hypot(body.x - position.x, body.y - position.y, body.z - position.z));
    expect(size(moon, MOON_RADIUS_KM) / size(sun, SUN_RADIUS_KM)).toBeCloseTo(1.079, 2);
  });

  it('lasts as long there as NASA says, to within about ten seconds', () => {
    // 6 m 22.6 s centered on greatest eclipse is 191 s either side.
    expect(hidden(luxor, greatest - 180_000)).toBe(1);
    expect(hidden(luxor, greatest + 180_000)).toBe(1);
    expect(hidden(luxor, greatest - 210_000)).toBeLessThan(1);
    expect(hidden(luxor, greatest + 210_000)).toBeLessThan(1);
  });

  it('is total inside the path and partial a few hundred km outside it', () => {
    // The path runs roughly southeast here, so north is across it.
    expect(hidden({ ...luxor, latitude: luxor.latitude + 0.5 }, greatest)).toBe(1); // 55 km
    const outside = hidden({ ...luxor, latitude: luxor.latitude + 3 }, greatest); // 330 km
    expect(outside).toBeLessThan(1);
    expect(outside).toBeGreaterThan(0.85);
  });

  it('does not happen at all from Los Angeles, or three hours early', () => {
    expect(hidden({ latitude: 34.05, longitude: -118.24 }, greatest)).toBe(0);
    expect(hidden(luxor, greatest - 3 * 3_600_000)).toBe(0);
  });
});

describe('total lunar eclipses', () => {
  // NASA's times of greatest eclipse (TD, about 70 s after UT): totality
  // lasts over an hour either way, so the difference does not matter here.
  it.each([['2025-09-07T18:12:58Z'], ['2026-03-03T11:34:52Z']])(
    "puts the Moon in the Earth's shadow at %s",
    (instant) => {
      const timeMs = Date.parse(instant);
      expect(sunHiddenByEarth(moonPosition(timeMs, vec()), sunPosition(timeMs, vec()))).toBe(1);
    },
  );

  it('leaves the Moon in sunlight hours before', () => {
    const timeMs = Date.parse('2026-03-03T06:30:00Z');
    expect(sunHiddenByEarth(moonPosition(timeMs, vec()), sunPosition(timeMs, vec()))).toBe(0);
  });

  it('treats the shadow as a little wider than the Earth', () => {
    // Straight behind the Earth at the Moon's distance, the Sun is hidden.
    const sun = { x: AU_KM, y: 0, z: 0 };
    expect(sunHiddenByEarth({ x: -384_000, y: 0, z: 0 }, sun)).toBe(1);
    expect(sunHiddenByEarth({ x: -384_000, y: EARTH_RADIUS_KM * 3, z: 0 }, sun)).toBe(0);
  });
});

describe('eclipseFrom', () => {
  const luxor: Observer = { latitude: 25.505, longitude: 33.1833 };
  const greatest = Date.parse('2027-08-02T10:06:37.7Z');

  it('sees the total solar eclipse at Luxor, and the partial phase before it', () => {
    expect(eclipseFrom(luxor, greatest)).toEqual({ kind: 'solar', covered: 1 });
    const before = eclipseFrom(luxor, greatest - 30 * 60_000);
    expect(before?.kind).toBe('solar');
    if (before?.kind === 'solar') {
      expect(before.covered).toBeGreaterThan(0.3);
      expect(before.covered).toBeLessThan(1);
    }
  });

  it('sees the lunar eclipse of March 2026 from Honolulu, with the Moon high', () => {
    const honolulu: Observer = { latitude: 21.31, longitude: -157.86 };
    expect(eclipseFrom(honolulu, Date.parse('2026-03-03T11:34:52Z'))).toEqual({
      kind: 'lunar',
      inUmbra: true,
    });
  });

  it('sees nothing when none is visible from there', () => {
    // Middle of the night in Los Angeles during the solar eclipse.
    expect(eclipseFrom({ latitude: 34.05, longitude: -118.24 }, greatest)).toBeNull();
    // An ordinary day in Luxor.
    expect(eclipseFrom(luxor, Date.parse('2027-08-10T10:00:00Z'))).toBeNull();
  });
});
