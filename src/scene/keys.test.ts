import { describe, expect, it } from 'vitest';
import { isSteering, steerFrom } from './keys';

describe('steerFrom', () => {
  it('steers with WASD and the arrow keys alike', () => {
    expect(steerFrom(['KeyW', 'KeyD'])).toEqual({ right: 1, up: 1, zoomIn: 0 });
    expect(steerFrom(['ArrowDown', 'ArrowLeft'])).toEqual({ right: -1, up: -1, zoomIn: 0 });
  });

  it('zooms in with E and out with Q', () => {
    expect(steerFrom(['KeyE']).zoomIn).toBe(1);
    expect(steerFrom(['KeyQ']).zoomIn).toBe(-1);
  });

  it('cancels opposite keys, and goes no faster for the same way twice', () => {
    expect(steerFrom(['KeyA', 'KeyD']).right).toBe(0);
    expect(steerFrom(['KeyW', 'ArrowUp']).up).toBe(1);
  });

  it('ignores every other key', () => {
    const steer = steerFrom(['KeyX', 'Space', 'Escape']);
    expect(steer).toEqual({ right: 0, up: 0, zoomIn: 0 });
    expect(isSteering(steer)).toBe(false);
  });
});
