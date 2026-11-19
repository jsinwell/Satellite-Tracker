import { describe, expect, it } from 'vitest';
import { mixFov, SKY_FOV, SKY_FOV_RANGE, zoomFov } from './standing';

describe('zoomFov', () => {
  it('widens above 1 and narrows below it', () => {
    expect(zoomFov(SKY_FOV, 1.2)).toBeCloseTo(84);
    expect(zoomFov(SKY_FOV, 0.5)).toBeCloseTo(35);
  });

  it('comes back to where it started after equal steps each way', () => {
    expect(zoomFov(zoomFov(SKY_FOV, 1.25), 1 / 1.25)).toBeCloseTo(SKY_FOV);
  });

  it('stays within its range', () => {
    expect(zoomFov(SKY_FOV, 100)).toBe(SKY_FOV_RANGE[1]);
    expect(zoomFov(SKY_FOV, 0.01)).toBe(SKY_FOV_RANGE[0]);
  });

  it('goes narrower than the range only when told how narrow', () => {
    expect(zoomFov(SKY_FOV_RANGE[0], 0.5)).toBe(SKY_FOV_RANGE[0]);
    expect(zoomFov(SKY_FOV_RANGE[0], 0.5, 0.01)).toBeCloseTo(SKY_FOV_RANGE[0] / 2);
    expect(zoomFov(0.02, 0.1, 0.01)).toBe(0.01);
    expect(zoomFov(0.02, 1e6, 0.01)).toBe(SKY_FOV_RANGE[1]);
  });
});

describe('mixFov', () => {
  it('starts and ends where it is told', () => {
    expect(mixFov(70, 0.2, 0)).toBeCloseTo(70);
    expect(mixFov(70, 0.2, 1)).toBeCloseTo(0.2);
  });

  it('is halfway when as many times narrower than one end as wider than the other', () => {
    const half = mixFov(80, 0.2, 0.5);
    expect(80 / half).toBeCloseTo(half / 0.2);
    expect(half).toBeCloseTo(4);
  });
});
