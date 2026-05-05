import { describe, it, expect, vi } from 'vitest';
import { adsRandomPickOp } from './scheduler.js';

describe('adsRandomPickOp', () => {
  it('picks second op when random > first weight fraction', () => {
    const ops = [{ slot: 1, tag: 1, weight: 10 }, { slot: 2, tag: 2, weight: 90 }];
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 0.5 * 100 = 50 >= 10, picks slot 2
    expect(adsRandomPickOp(ops).slot).toBe(2);
    vi.restoreAllMocks();
  });

  it('picks first op when random falls in its weight range', () => {
    const ops = [{ slot: 1, tag: 1, weight: 10 }, { slot: 2, tag: 2, weight: 90 }];
    vi.spyOn(Math, 'random').mockReturnValue(0.05); // 0.05 * 100 = 5 < 10, picks slot 1
    expect(adsRandomPickOp(ops).slot).toBe(1);
    vi.restoreAllMocks();
  });

  it('returns last op when random = 0.999...', () => {
    const ops = [{ slot: 1, tag: 1, weight: 50 }, { slot: 2, tag: 2, weight: 50 }];
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    expect(adsRandomPickOp(ops).slot).toBe(2);
    vi.restoreAllMocks();
  });
});
