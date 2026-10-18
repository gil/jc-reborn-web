import { describe, expect, it } from 'vitest';
import { CLOCK_MS, EngineClock, STEP_MS } from './clock.js';

describe('engine clock', () => {
  it('ticks the clock every 16 ms and catches up missed ticks', () => {
    // SCRANTIC 1040:076a 1040:07e6 1040:089a 1008:143c
    const clock = new EngineClock(0);
    expect(clock.ticksDue(CLOCK_MS - 1)).toBe(0);
    expect(clock.ticksDue(CLOCK_MS)).toBe(1);
    expect(clock.ticksDue(10 * CLOCK_MS)).toBe(9);
  });

  it('runs at most one story step per 50 ms period, however late', () => {
    // SCRANTIC 1008:0fcd
    const clock = new EngineClock(0);
    expect(clock.stepDue(STEP_MS - 1)).toBe(false);
    expect(clock.stepDue(STEP_MS)).toBe(true);
    expect(clock.stepDue(STEP_MS)).toBe(false);
    expect(clock.stepDue(10 * STEP_MS)).toBe(true);
    expect(clock.stepDue(10 * STEP_MS + 1)).toBe(false);
    expect(clock.stepDue(11 * STEP_MS)).toBe(true);
  });

  it('skips the time a hidden page was paused', () => {
    // SCRANTIC 1040:089a
    const clock = new EngineClock(0);
    clock.resume(100_000);
    expect(clock.ticksDue(100_000 + CLOCK_MS)).toBe(1);
  });
});
