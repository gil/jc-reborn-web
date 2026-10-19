import { describe, expect, it } from 'vitest';
import { CLOCK_MS, EngineClock, TIME_STEP_MS } from './clock.js';

function ticksPerJump(jumps: number): number[] {
  const clock = new EngineClock(0);
  return Array.from({ length: jumps }, (_, i) => clock.ticksDue((i + 1) * TIME_STEP_MS));
}

describe('engine clock', () => {
  it('ticks the clock every 16 ms of Windows time and catches up missed ticks', () => {
    // SCRANTIC 1040:076a 1040:07e6 1040:089a 1008:143c
    const clock = new EngineClock(0);
    expect(clock.ticksDue(CLOCK_MS)).toBe(0);
    expect(clock.ticksDue(TIME_STEP_MS - 1)).toBe(0);
    expect(clock.ticksDue(TIME_STEP_MS)).toBe(3);
    expect(clock.ticksDue(10 * TIME_STEP_MS)).toBe(31);
  });

  it('delivers the ticks in bursts of 3 or 4 at each 55 ms jump, 4 in 7 jumps of 16', () => {
    // SCRANTIC 1040:089a (GetCurrentTime moves in 55 ms jumps on Windows 3.x, OQ-36)
    const bursts = ticksPerJump(16);
    expect(new Set(bursts)).toEqual(new Set([3, 4]));
    expect(bursts.filter((ticks) => ticks === 4)).toHaveLength(7);
  });

  it('runs one story step per 55 ms jump, at most one however late', () => {
    // SCRANTIC 1008:0fcd (a 50 ms WM_TIMER fires on the next 55 ms jump)
    const clock = new EngineClock(0);
    expect(clock.stepDue(TIME_STEP_MS - 1)).toBe(false);
    expect(clock.stepDue(TIME_STEP_MS)).toBe(true);
    expect(clock.stepDue(TIME_STEP_MS + 50)).toBe(false);
    expect(clock.stepDue(2 * TIME_STEP_MS)).toBe(true);
    expect(clock.stepDue(10 * TIME_STEP_MS)).toBe(true);
    expect(clock.stepDue(10 * TIME_STEP_MS + 1)).toBe(false);
    expect(clock.stepDue(11 * TIME_STEP_MS)).toBe(true);
  });

  it('skips the time a hidden page was paused', () => {
    // SCRANTIC 1040:089a
    const clock = new EngineClock(0);
    clock.resume(100_000);
    expect(clock.ticksDue(100_000 + TIME_STEP_MS)).toBe(3);
    expect(clock.stepDue(100_000 + TIME_STEP_MS)).toBe(true);
  });
});
