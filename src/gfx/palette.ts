import type { Palette } from '../types.js';

export function makePalette(): Palette {
  return new Uint8Array(16 * 4);
}

export function setPaletteFromVga(pal: Palette, vga: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    const r = vga[i * 3 + 0]!;
    const g = vga[i * 3 + 1]!;
    const b = vga[i * 3 + 2]!;
    pal[i * 4 + 0] = (r << 2) | (r >> 4);
    pal[i * 4 + 1] = (g << 2) | (g >> 4);
    pal[i * 4 + 2] = (b << 2) | (b >> 4);
    pal[i * 4 + 3] = 0xff;
  }
}
