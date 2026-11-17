import { describe, expect, it } from 'vitest';
import { SKY_FOV, SKY_FOV_RANGE, zoomFov } from './standing';

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
});
