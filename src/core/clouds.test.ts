import { describe, expect, it } from 'vitest';
import {
  CLOUD_DRIFT,
  cloudCover,
  cloudsDrawnAt,
  cloudWind,
  driftClouds,
  stepToward,
} from './clouds';

describe('cloudCover', () => {
  it('is none for the dark of the picture and all for its white', () => {
    expect(cloudCover(0)).toBe(0);
    expect(cloudCover(1)).toBe(1);
    expect(cloudCover(0.45)).toBeGreaterThan(0);
    expect(cloudCover(0.45)).toBeLessThan(1);
  });
});

describe('cloudsDrawnAt', () => {
  it('draws them in full up to high latitudes and not at the poles', () => {
    expect(cloudsDrawnAt(0)).toBe(1);
    expect(cloudsDrawnAt(-50)).toBe(1);
    expect(cloudsDrawnAt(89)).toBe(0);
  });
});

describe('stepToward', () => {
  it('goes a step at a time, either way', () => {
    expect(stepToward(0.2, 1, 0.05)).toBeCloseTo(0.25);
    expect(stepToward(0.8, 0, 0.05)).toBeCloseTo(0.75);
  });

  it('lands on the target and not past it', () => {
    expect(stepToward(0.98, 1, 0.05)).toBe(1);
    expect(stepToward(0.02, 0, 0.05)).toBe(0);
  });

  it('stays there', () => {
    // It used to step back off and on again every frame, which showed as
    // every cloud flickering.
    let value = 0;
    for (let frame = 0; frame < 100; frame++) value = stepToward(value, 1, 0.05);
    expect(value).toBe(1);
    expect(stepToward(1, 1, 0.05)).toBe(1);
    expect(stepToward(0, 0, 0.05)).toBe(0);
  });
});

describe('cloudWind', () => {
  const wind = { east: 0, north: 0 };

  it('blows toward the west in the tropics and toward the east beyond them', () => {
    expect(cloudWind(10, wind).east).toBeLessThan(-0.8);
    expect(cloudWind(-10, wind).east).toBeLessThan(-0.8);
    expect(cloudWind(45, wind).east).toBeGreaterThan(0.8);
    expect(cloudWind(-45, wind).east).toBeGreaterThan(0.8);
  });

  it('leans toward the nearer pole', () => {
    expect(cloudWind(45, wind).north).toBeGreaterThan(0);
    expect(cloudWind(-45, wind).north).toBeLessThan(0);
  });

  it('is never still, and never faster than the wind', () => {
    for (let latitude = -90; latitude <= 90; latitude += 2.5) {
      const { east, north } = cloudWind(latitude, wind);
      const speed = Math.hypot(east, north);
      expect(speed).toBeGreaterThan(0.3);
      expect(speed).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe('driftClouds', () => {
  it('moves them with the wind, as far as it blows in the time', () => {
    const drift = { x: 0, y: 0 };
    driftClouds(drift, 45, 10, 10);
    expect(Math.hypot(drift.x, drift.y)).toBeCloseTo((CLOUD_DRIFT.windMs * 10) / 1000, 9);
    expect(drift.x).toBeGreaterThan(0);
  });

  it('leaves them where they are while time is stopped', () => {
    const drift = { x: 3, y: 4 };
    driftClouds(drift, 45, 0, 1 / 60);
    expect(drift).toEqual({ x: 3, y: 4 });
  });

  it('goes no faster than its limit, however fast time runs or far it jumps', () => {
    const fast = { x: 0, y: 0 };
    const jump = { x: 0, y: 0 };
    driftClouds(fast, 45, 1000 / 60, 1 / 60);
    driftClouds(jump, 45, 86_400 * 30, 1 / 60);
    const most = (CLOUD_DRIFT.windMs * CLOUD_DRIFT.fastest) / 60 / 1000;
    expect(Math.hypot(fast.x, fast.y)).toBeCloseTo(most, 9);
    expect(Math.hypot(jump.x, jump.y)).toBeCloseTo(most, 9);
  });

  it('goes back with time', () => {
    const drift = { x: 0, y: 0 };
    driftClouds(drift, 45, 5, 5);
    driftClouds(drift, 45, -5, 5);
    expect(drift.x).toBeCloseTo(0, 12);
    expect(drift.y).toBeCloseTo(0, 12);
  });

  it('stays within its period, and ignores a time that is not one', () => {
    const drift = { x: CLOUD_DRIFT.periodKm - 0.001, y: 0 };
    driftClouds(drift, 45, 60, 60);
    expect(Math.abs(drift.x)).toBeLessThan(CLOUD_DRIFT.periodKm);
    const before = { ...drift };
    driftClouds(drift, 45, Number.NaN, 1);
    expect(drift).toEqual(before);
  });
});
