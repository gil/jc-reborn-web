import { describe, expect, it } from 'vitest';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeSurface } from '../gfx/gdi/surface.js';
import { walkAnimate, walkDraw, walkInit } from './walk.js';

const sprites = Array.from({ length: 256 }, () => {
  const image = makeSurface(2, 2);
  image.pixels.fill(5);
  return image;
});

describe('walk on the display', () => {
  it('moves without drawing, then draws the frame on B with the TTM sprite rects', () => {
    // SCRANTIC 1050:0a85
    const display = new Display();
    const ws = walkInit(0, 0, 0, 0);
    expect(walkAnimate(ws)).toBe(80);
    expect(display.surfaces[SURFACE_B]!.pixels.includes(5)).toBe(false);
    walkDraw(ws, display, sprites, [], 0, 0);
    expect(display.surfaces[SURFACE_B]!.pixels.includes(5)).toBe(true);
    const lists = display.dirty.snapshot().map(([, rects]) => [rects[0]!.source, rects[0]!.target, rects[0]!.age, rects[0]!.h]);
    expect(lists).toEqual([
      [SURFACE_B, SURFACE_A, 0, 4],
      [SURFACE_B, SURFACE_A, 1, 4],
      [SURFACE_C, SURFACE_B, 0, 4],
    ]);
    expect(walkAnimate(ws)).toBe(0);
  });
});
