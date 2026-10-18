import { describe, expect, it } from 'vitest';
import { clockTick, makeTimers } from './timers.js';

describe('clock callback', () => {
  it('adds 1 to the clock and counts every non-zero timer down', () => {
    // SCRANTIC 1008:16c2
    const timers = { ...makeTimers(), idleWait: 2, surf: 1, waves: 0 };
    clockTick(timers);
    expect(timers).toEqual({ now: 1, idleWait: 1, surf: 0, waves: 0 });
  });

  it('wraps the clock at 32 bits', () => {
    // SCRANTIC 1008:16c2
    const timers = { ...makeTimers(), now: 0xffffffff };
    clockTick(timers);
    expect(timers.now).toBe(0);
  });
});
