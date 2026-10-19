import { describe, expect, it } from 'vitest';
import { makePalette } from './palette.js';
import { presentSurface } from './present.js';

describe('presentSurface', () => {
  it('turns palette indices into opaque RGBA, index 0 included', () => {
    const palette = makePalette();
    palette.set([10, 20, 30, 255], 3 * 4);
    palette.set([168, 0, 168, 255], 0);
    const out = new Uint8ClampedArray(2 * 4);
    presentSurface(out, { width: 2, height: 1, pixels: Uint8Array.of(0, 3) }, palette);
    expect([...out]).toEqual([168, 0, 168, 255, 10, 20, 30, 255]);
  });
});
