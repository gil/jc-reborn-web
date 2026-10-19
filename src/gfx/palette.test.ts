import { describe, expect, it } from 'vitest';
import { makePalette, setPaletteColors } from './palette.js';

describe('setPaletteColors', () => {
  it('copies 16 RGB colors and makes every entry opaque', () => {
    const colors = Uint8Array.from({ length: 48 }, (_, i) => i * 5);
    const palette = makePalette();
    setPaletteColors(palette, colors);
    expect(Array.from(palette.subarray(0, 8))).toEqual([0, 5, 10, 255, 15, 20, 25, 255]);
    expect(Array.from(palette.subarray(60, 64))).toEqual([225, 230, 235, 255]);
  });
});
