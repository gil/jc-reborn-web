import { describe, it, expect } from 'vitest';
import { makePalette, setPaletteFromVga } from './palette.js';

describe('setPaletteFromVga', () => {
  it('expands 6-bit channels to 8-bit (63→255)', () => {
    const vga = new Uint8Array(16 * 3);
    vga[0] = 63; vga[1] = 32; vga[2] = 0;        // entry 0
    vga[15 * 3 + 0] = 0; vga[15 * 3 + 1] = 0; vga[15 * 3 + 2] = 63; // entry 15
    const p = makePalette();
    setPaletteFromVga(p, vga);
    expect(p[0]).toBe(255);  // (63 << 2) | (63 >> 4)
    expect(p[1]).toBe(130);  // (32 << 2) | (32 >> 4)
    expect(p[2]).toBe(0);
    expect(p[3]).toBe(255);  // alpha
    expect(p[15 * 4 + 2]).toBe(255);
  });
});
