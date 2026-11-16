import type { SatelliteRecord } from '../catalog';

/**
 * Real element sets captured from CelesTrak on 2026-11-16, one per kind of
 * orbit the app distinguishes. Tests propagate them close to their epochs.
 */
export const iss: SatelliteRecord = {
  noradId: 25544,
  name: 'ISS (ZARYA)',
  intlDesignator: '1998-067A',
  objectType: 'payload',
  owner: 'ISS',
  launchDate: '1998-11-20',
  elements: {
    epoch: '2026-11-15T21:58:28.277184Z',
    meanMotion: 15.49402183,
    eccentricity: 0.00073617,
    inclination: 51.6321,
    raan: 269.2481,
    argOfPericenter: 30.2971,
    meanAnomaly: 329.8442,
    bstar: 0.00017269123,
    meanMotionDot: 0.00009214,
    meanMotionDdot: 0,
  },
};

export const geostationary: SatelliteRecord = {
  noradId: 41866,
  name: 'GOES 16',
  intlDesignator: '2016-071A',
  objectType: 'payload',
  owner: 'US',
  launchDate: '2016-11-19',
  elements: {
    epoch: '2026-11-15T22:04:29.038656Z',
    meanMotion: 1.00271494,
    eccentricity: 0.00024772,
    inclination: 0.7139,
    raan: 83.4973,
    argOfPericenter: 169.6292,
    meanAnomaly: 28.3249,
    bstar: 0,
    meanMotionDot: -7.7e-7,
    meanMotionDdot: 0,
  },
};

export const gps: SatelliteRecord = {
  noradId: 24876,
  name: 'NAVSTAR 43 (USA 132)',
  intlDesignator: '1997-035A',
  objectType: 'payload',
  owner: 'US',
  launchDate: '1997-07-23',
  elements: {
    epoch: '2026-11-15T18:28:25.969728Z',
    meanMotion: 2.00564861,
    eccentricity: 0.01067601,
    inclination: 56.0867,
    raan: 92.6498,
    argOfPericenter: 59.5442,
    meanAnomaly: 301.4938,
    bstar: 0,
    meanMotionDot: 3.6e-7,
    meanMotionDdot: 0,
  },
};

export const highlyElliptical: SatelliteRecord = {
  noradId: 40296,
  name: 'MERIDIAN 7',
  intlDesignator: '2014-069A',
  objectType: 'payload',
  owner: 'CIS',
  launchDate: '2014-10-30',
  elements: {
    epoch: '2026-11-15T05:29:01.872960Z',
    meanMotion: 2.00604503,
    eccentricity: 0.65982568,
    inclination: 63.4445,
    raan: 200.7322,
    argOfPericenter: 269.4949,
    meanAnomaly: 20.6146,
    bstar: 0,
    meanMotionDot: 0.00000233,
    meanMotionDdot: 0,
  },
};

export const starlink: SatelliteRecord = {
  noradId: 44714,
  name: 'STARLINK-1008',
  intlDesignator: '2019-074B',
  objectType: 'payload',
  owner: 'US',
  launchDate: '2019-11-11',
  elements: {
    epoch: '2026-11-16T00:00:02.000160Z',
    meanMotion: 15.70330272,
    eccentricity: 0.00020516,
    inclination: 53.1441,
    raan: 49.3473,
    argOfPericenter: 356.6839,
    meanAnomaly: 316.8684,
    bstar: -0.00036615613,
    meanMotionDot: -0.00045869,
    meanMotionDdot: 0,
  },
};

export const debris: SatelliteRecord = {
  noradId: 29733,
  name: 'FENGYUN 1C DEB',
  intlDesignator: '1999-025X',
  objectType: 'debris',
  owner: 'PRC',
  launchDate: '1999-05-10',
  elements: {
    epoch: '2026-11-15T22:26:31.495200Z',
    meanMotion: 12.96991875,
    eccentricity: 0.05655297,
    inclination: 99.1993,
    raan: 329.4012,
    argOfPericenter: 140.716,
    meanAnomaly: 295.3953,
    bstar: 0.00090211887,
    meanMotionDot: 0.00000513,
    meanMotionDdot: 0,
  },
};

export const fixtures: SatelliteRecord[] = [
  iss,
  geostationary,
  gps,
  highlyElliptical,
  starlink,
  debris,
];
