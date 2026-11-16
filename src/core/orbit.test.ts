import { describe, expect, it } from 'vitest';
import {
  debris,
  geostationary,
  gps,
  highlyElliptical,
  iss,
  starlink,
} from './__fixtures__/satellites';
import { summarizeOrbit } from './orbit';

describe('summarizeOrbit', () => {
  it('places the ISS in a ~93 minute, ~420 km circular orbit', () => {
    const orbit = summarizeOrbit(iss.elements);
    expect(orbit.periodMinutes).toBeCloseTo(92.9, 0);
    expect(orbit.perigeeKm).toBeGreaterThan(380);
    expect(orbit.apogeeKm).toBeLessThan(450);
    expect(orbit.apogeeKm - orbit.perigeeKm).toBeLessThan(20);
  });

  it('places a geostationary satellite at geostationary altitude', () => {
    const orbit = summarizeOrbit(geostationary.elements);
    expect(orbit.periodMinutes).toBeCloseTo(1436.1, 0);
    expect(orbit.perigeeKm).toBeGreaterThan(35_700);
    expect(orbit.apogeeKm).toBeLessThan(35_900);
  });

  it('gives a highly elliptical orbit a low perigee and a high apogee', () => {
    const orbit = summarizeOrbit(highlyElliptical.elements);
    expect(orbit.perigeeKm).toBeLessThan(3000);
    expect(orbit.apogeeKm).toBeGreaterThan(35_000);
  });

  it.each([
    ['the ISS', iss, 'LEO'],
    ['a Starlink satellite', starlink, 'LEO'],
    ['low-orbit debris', debris, 'LEO'],
    ['a GPS satellite', gps, 'MEO'],
    ['a geostationary satellite', geostationary, 'GEO'],
    ['a Molniya-type orbit', highlyElliptical, 'HEO'],
  ])('classifies %s as %s', (_label, record, regime) => {
    expect(summarizeOrbit(record.elements).regime).toBe(regime);
  });
});
