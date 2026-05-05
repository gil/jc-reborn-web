import type { Palette } from '../types.js';

export function makePalette(): Palette {
  return new Uint8Array(16 * 4);
}

export function setPaletteFromVga(pal: Palette, vga: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    pal[i * 4 + 0] = vga[i * 3 + 0]! << 2; // R: VGA 0-63 → 0-252
    pal[i * 4 + 1] = vga[i * 3 + 1]! << 2; // G
    pal[i * 4 + 2] = vga[i * 3 + 2]! << 2; // B
    pal[i * 4 + 3] = 0xff;
  }
}
