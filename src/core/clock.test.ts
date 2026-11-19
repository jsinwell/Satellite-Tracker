import { describe, expect, it } from 'vitest';
import { holdable, realTimeClock, simTimeAt, withRate, withSimTime } from './clock';

const T0 = Date.UTC(2026, 10, 15);

describe('clock', () => {
  it('shows the present and advances in real time by default', () => {
    const clock = realTimeClock(T0);
    expect(simTimeAt(clock, T0)).toBe(T0);
    expect(simTimeAt(clock, T0 + 5000)).toBe(T0 + 5000);
  });

  it('advances simulated time at the configured rate', () => {
    const clock = withRate(realTimeClock(T0), T0, 100);
    expect(simTimeAt(clock, T0 + 1000)).toBe(T0 + 100_000);
  });

  it('does not jump when the rate changes mid-flight', () => {
    const fast = withRate(realTimeClock(T0), T0, 1000);
    const before = simTimeAt(fast, T0 + 2000);
    const slowed = withRate(fast, T0 + 2000, 1);
    expect(simTimeAt(slowed, T0 + 2000)).toBe(before);
    expect(simTimeAt(slowed, T0 + 3000)).toBe(before + 1000);
  });

  it('holds still while paused', () => {
    const paused = withRate(realTimeClock(T0), T0 + 500, 0);
    expect(simTimeAt(paused, T0 + 60_000)).toBe(T0 + 500);
  });

  it('runs backwards at a negative rate', () => {
    const reversed = withRate(realTimeClock(T0), T0, -10);
    expect(simTimeAt(reversed, T0 + 1000)).toBe(T0 - 10_000);
  });

  it('jumps to a given instant while keeping the rate', () => {
    const fast = withRate(realTimeClock(T0), T0, 10);
    const jumped = withSimTime(fast, T0 + 1000, T0 - 86_400_000);
    expect(simTimeAt(jumped, T0 + 1000)).toBe(T0 - 86_400_000);
    expect(simTimeAt(jumped, T0 + 2000)).toBe(T0 - 86_400_000 + 10_000);
  });
});

describe('holdable', () => {
  it('reads afresh each time until it is held', () => {
    let wall = 100;
    const time = holdable(() => wall);
    expect(time.now()).toBe(100);
    wall = 105;
    expect(time.now()).toBe(105);
  });

  it('stands still while held, at the reading taken when it was', () => {
    let wall = 100;
    const time = holdable(() => wall);
    time.hold();
    wall = 107;
    expect(time.now()).toBe(100);
    wall = 250;
    expect(time.now()).toBe(100);
  });

  it('catches up when released', () => {
    let wall = 100;
    const time = holdable(() => wall);
    time.hold();
    wall = 116;
    time.release();
    expect(time.now()).toBe(116);
  });

  it('takes a new reading each time it is held', () => {
    let wall = 100;
    const time = holdable(() => wall);
    time.hold();
    wall = 116;
    time.hold();
    expect(time.now()).toBe(116);
    wall = 132;
    expect(time.now()).toBe(116);
  });

  it('can be released without having been held', () => {
    const time = holdable(() => 7);
    time.release();
    expect(time.now()).toBe(7);
  });
});
