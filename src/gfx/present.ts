import type { Palette } from '../types.js';
import type { Surface } from './gdi/surface.js';

export function presentSurface(out: Uint8ClampedArray, surface: Surface, palette: Palette): void {
  for (let p = 0; p < surface.pixels.length; p++) {
    const color = surface.pixels[p]! * 4;
    const o = p * 4;
    out[o] = palette[color]!;
    out[o + 1] = palette[color + 1]!;
    out[o + 2] = palette[color + 2]!;
    out[o + 3] = 255;
  }
}
