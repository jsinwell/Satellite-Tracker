import { describe, expect, it } from 'vitest';
import { debris, geostationary, gps, iss, starlink } from './__fixtures__/satellites';
import {
  apparentMagnitude,
  FAINTEST,
  faintestSeen,
  isSeen,
  magnitudeFrom,
  phaseShare,
  standardMagnitude,
  twilightLoss,
} from './brightness';
import { EARTH_RADIUS_KM } from './constants';

describe('standardMagnitude', () => {
  it('knows the space station for the brightest thing up there', () => {
    expect(standardMagnitude(iss)).toBeLessThan(-1);
    for (const other of [starlink, gps, geostationary, debris]) {
      expect(standardMagnitude(other)).toBeGreaterThan(standardMagnitude(iss) + 5);
    }
  });

  it('goes by what a thing is where it does not know it by name', () => {
    expect(standardMagnitude(starlink)).toBe(6.5);
    expect(standardMagnitude({ ...starlink, name: 'ONEWEB-0012' })).toBe(7.5);
    expect(standardMagnitude({ ...iss, name: 'SOMETHING ELSE' })).toBe(6.5);
    expect(standardMagnitude({ ...iss, name: 'CZ-5B R/B', objectType: 'rocket-body' })).toBe(4.5);
  });

  it('has debris far too faint to see', () => {
    expect(standardMagnitude(debris)).toBeGreaterThan(9);
    // A fragment is not the satellite it came off, whatever its name says.
    expect(standardMagnitude({ ...iss, name: 'ISS DEB', objectType: 'debris' })).toBeGreaterThan(9);
  });
});

describe('phaseShare', () => {
  it('is all of the light face on, a third side on, and none from behind', () => {
    expect(phaseShare(1)).toBeCloseTo(1);
    expect(phaseShare(0)).toBeCloseTo(1 / Math.PI);
    expect(phaseShare(-1)).toBeCloseTo(0);
  });

  it('falls all the way round, and takes cosines a hair out of range', () => {
    let last = 1.0001;
    for (let cosine = 1; cosine >= -1; cosine -= 0.1) {
      expect(phaseShare(cosine)).toBeLessThan(last);
      last = phaseShare(cosine);
    }
    expect(phaseShare(1.0000001)).toBeCloseTo(1);
    expect(phaseShare(-1.0000001)).toBeCloseTo(0);
  });
});

describe('apparentMagnitude', () => {
  it('is the standard magnitude at 1000 km, half lit', () => {
    expect(apparentMagnitude(4.2, 1000, 0)).toBeCloseTo(4.2);
  });

  it('is five magnitudes fainter ten times as far off', () => {
    expect(apparentMagnitude(4.2, 10_000, 0) - apparentMagnitude(4.2, 1000, 0)).toBeCloseTo(5);
  });

  it('is brighter with the Sun behind the viewer, and far fainter against it', () => {
    expect(apparentMagnitude(4.2, 1000, 1)).toBeCloseTo(4.2 - 2.5 * Math.log10(Math.PI));
    expect(apparentMagnitude(4.2, 1000, -0.9)).toBeGreaterThan(8);
    expect(Number.isFinite(apparentMagnitude(4.2, 1000, -1))).toBe(true);
  });

  // Checks on the whole thing against what is seen in the sky.
  it('has the space station outshine everything but Venus on a good pass', () => {
    const best = apparentMagnitude(standardMagnitude(iss), 420, 0.6);
    expect(best).toBeLessThan(-3.5);
    expect(best).toBeGreaterThan(-5.5);
  });

  it('has a Starlink overhead just visible, and a GPS satellite nowhere near', () => {
    const overhead = apparentMagnitude(standardMagnitude(starlink), 550, 0.3);
    expect(overhead).toBeGreaterThan(4);
    expect(overhead).toBeLessThan(FAINTEST.eye);
    expect(apparentMagnitude(standardMagnitude(gps), 20_200, 0.5)).toBeGreaterThan(10);
  });
});

describe('twilightLoss', () => {
  it('is nothing under a dark sky and everything by day', () => {
    expect(twilightLoss(-40)).toBe(0);
    expect(twilightLoss(-12)).toBe(0);
    expect(twilightLoss(30)).toBe(14);
  });

  it('grows all the way up through twilight', () => {
    let last = -1;
    for (let sun = -12; sun <= 6; sun += 0.5) {
      expect(twilightLoss(sun)).toBeGreaterThanOrEqual(last);
      last = twilightLoss(sun);
    }
    expect(twilightLoss(-6)).toBeCloseTo(3.5);
    expect(twilightLoss(-3)).toBeCloseTo(6.25);
  });

  it('sets what the eye and binoculars get to', () => {
    expect(faintestSeen('eye', -20)).toBe(6);
    expect(faintestSeen('binoculars', -20)).toBe(10);
    expect(faintestSeen('eye', -6)).toBeCloseTo(2.5);
    expect(faintestSeen('eye', 10)).toBeLessThan(-5);
  });
});

describe('isSeen', () => {
  const eye = { x: EARTH_RADIUS_KM, y: 0, z: 0 };
  const overhead = { x: EARTH_RADIUS_KM + 500, y: 0, z: 0 };
  // Off to one side, as at dusk: side on to the satellite, and on it.
  const duskSun = { x: 0, y: 1, z: 0 };

  it('goes by brightness', () => {
    expect(magnitudeFrom(5, eye, overhead, duskSun)).toBeCloseTo(5 + 5 * Math.log10(0.5));
    expect(isSeen(5, eye, overhead, duskSun, 6)).toBe(true);
    expect(isSeen(9, eye, overhead, duskSun, 6)).toBe(false);
    expect(isSeen(9, eye, overhead, duskSun, 10)).toBe(true);
  });

  it('sees nothing in the shadow of the Earth, however bright', () => {
    // The Sun under the viewer's feet: midnight, and the satellite in the dark.
    expect(isSeen(-2, eye, overhead, { x: -1, y: 0, z: 0 }, 6)).toBe(false);
  });
});
