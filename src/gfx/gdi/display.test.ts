import { describe, expect, it } from 'vitest';
import { COPY_RECT, SAVED_BITS } from './dirty.js';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from './display.js';
import type { Surface } from './surface.js';

const count = (surface: Surface, index: number) => surface.pixels.filter((value) => value === index).length;
const at = (surface: Surface, x: number, y: number) => surface.pixels[y * surface.width + x];

describe('Display', () => {
  it('starts as the original display setup leaves it', () => {
    // SCRANTIC 1038:1744
    const display = new Display();
    expect([display.source, display.target, display.screenIsB]).toEqual([SURFACE_A, SURFACE_A, false]);
    expect(display.surfaces.every((surface) => surface.width === 640 && surface.height === 480 && count(surface, 0) === 640 * 480)).toBe(true);
  });

  it('copies whole 8-pixel columns and always adds one more column', () => {
    // SCRANTIC 1038:06ce
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(3, 0, 5, 1);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(16);
    expect([at(display.surfaces[SURFACE_A]!, 0, 0), at(display.surfaces[SURFACE_A]!, 15, 0), at(display.surfaces[SURFACE_A]!, 16, 0)]).toEqual([7, 7, 0]);
  });

  it('copies nothing from a surface to itself or for an empty rect', () => {
    // SCRANTIC 1038:06ce
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.copyRect(0, 0, 8, 8);
    display.source = SURFACE_B;
    display.copyRect(0, 0, 0, 8);
    display.copyRect(0, 0, 8, 0);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(0);
  });

  it('skips copies into A while B is the screen', () => {
    // SCRANTIC 1038:06ce 1038:07e8
    const display = new Display();
    display.screenIsB = true;
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(0, 0, 8, 8);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(0);
    expect(display.shown()).toBe(display.surfaces[SURFACE_B]);
  });

  it('saves a rect from the source and restores it into the target', () => {
    // SCRANTIC 1030:01c4 1030:0250
    const display = new Display();
    display.surfaces[SURFACE_C]!.pixels[1 * 640 + 2] = 9;
    display.source = SURFACE_C;
    display.saveRect(5, 2, 1, 3, 2);
    display.target = SURFACE_B;
    display.restoreRect(5, 10, 20, 3, 2);
    expect(at(display.surfaces[SURFACE_B]!, 10, 20)).toBe(9);
    expect(count(display.surfaces[SURFACE_B]!, 9)).toBe(1);
  });

  it('blits screens opaque, index 0 included, into the target', () => {
    // SCRANTIC 1040:0286 1030:16d8
    const display = new Display();
    display.surfaces[SURFACE_A]!.pixels.fill(7);
    display.blitScreen({ width: 2, height: 1, pixels: Uint8Array.of(0, 3) }, 4, 4);
    expect([at(display.surfaces[SURFACE_A]!, 4, 4), at(display.surfaces[SURFACE_A]!, 5, 4)]).toEqual([0, 3]);
  });

  it('restores dirty rects from the restore table and puts source and target back', () => {
    // SCRANTIC 1060:03d3 1060:05f9 1038:06ce 1030:0250
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.dirty.add(0, 0, 8, 1, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
    display.surfaces[SURFACE_A]!.pixels[0] = 4;
    display.source = SURFACE_A;
    display.saveRect(1, 0, 0, 1, 1);
    display.dirty.add(30, 40, 1, 1, SAVED_BITS, SURFACE_A, SURFACE_C, 0, null, 1);
    display.target = SURFACE_C;
    display.restorePass(0);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(16);
    expect(at(display.surfaces[SURFACE_C]!, 30, 40)).toBe(4);
    expect([display.source, display.target]).toEqual([SURFACE_A, SURFACE_C]);
    expect(display.dirty.snapshot()).toEqual([]);
  });
});
