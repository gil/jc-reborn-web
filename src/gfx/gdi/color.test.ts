import { describe, expect, it } from 'vitest';
import { brushColorAt, colorIndex } from './color.js';

describe('colorIndex', () => {
  it('keeps the low nibble in 16-color mode', () => {
    // SCRANTIC 1040:097a
    expect(colorIndex(0x1f)).toBe(15);
    expect(colorIndex(7)).toBe(7);
  });
});

describe('brushColorAt', () => {
  it('paints colors below 16 solid', () => {
    // SCRANTIC 1038:1d31
    expect([brushColorAt(5, 0, 0), brushColorAt(5, 3, 7)]).toEqual([5, 5]);
  });

  it('paints colors from 16 as a two-color checkerboard of their nibbles', () => {
    // SCRANTIC 1038:1d31
    const rows = [0, 1, 2].map((y) => [0, 1, 2, 3].map((x) => brushColorAt(0x12, x, y)));
    expect(rows).toEqual([
      [2, 1, 2, 1],
      [1, 2, 1, 2],
      [2, 1, 2, 1],
    ]);
  });
});
