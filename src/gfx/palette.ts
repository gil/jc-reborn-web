import type { Palette } from '../types.js';

export function makePalette(): Palette {
  return new Uint8Array(16 * 4);
}

export function setPaletteColors(pal: Palette, colors: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    pal[i * 4 + 0] = colors[i * 3 + 0]!;
    pal[i * 4 + 1] = colors[i * 3 + 1]!;
    pal[i * 4 + 2] = colors[i * 3 + 2]!;
    pal[i * 4 + 3] = 0xff;
  }
}
