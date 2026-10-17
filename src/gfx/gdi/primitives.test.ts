import { describe, expect, it } from 'vitest';
import { drawCircle, drawLine, drawRect, setPixel } from './primitives.js';
import { makeDrawState, makeSurface, type DrawState, type Surface } from './surface.js';

function rows(surface: Surface): string[] {
  return Array.from({ length: surface.height }, (_, y) =>
    Array.from(surface.pixels.subarray(y * surface.width, (y + 1) * surface.width), (index) => index.toString(16)).join(''),
  );
}

function state(changes: Partial<DrawState> = {}): DrawState {
  return { ...makeDrawState(), clip: { x1: 0, y1: 0, x2: 7, y2: 5 }, ...changes };
}

describe('setPixel', () => {
  it('uses its own color, reduced to 16 colors, and honors the clip', () => {
    // SCRANTIC 1040:0d54 1040:097a
    const surface = makeSurface(4, 2);
    const clipped = state({ clipOn: true, clip: { x1: 0, y1: 0, x2: 1, y2: 1 } });
    setPixel(surface, clipped, 1, 0, 0x1a);
    setPixel(surface, clipped, 2, 0, 3);
    expect(rows(surface)).toEqual(['0a00', '0000']);
  });
});

describe('drawLine', () => {
  it('draws in the foreground and leaves out the end point', () => {
    // SCRANTIC 1030:02ef (GDI LineTo)
    const surface = makeSurface(6, 4);
    const pen = state({ foreground: 0x12 });
    drawLine(surface, pen, 0, 0, 4, 0);
    drawLine(surface, pen, 5, 3, 5, 0);
    drawLine(surface, pen, 0, 1, 2, 3);
    expect(rows(surface)).toEqual(['222200', '200002', '020002', '000002']);
  });

  it('draws nothing from a point to itself', () => {
    // SCRANTIC 1030:02ef (GDI LineTo)
    const surface = makeSurface(2, 2);
    drawLine(surface, state({ foreground: 5 }), 1, 1, 1, 1);
    expect(rows(surface)).toEqual(['00', '00']);
  });
});

describe('drawRect', () => {
  it('draws only the outline when the fill flag is off', () => {
    // SCRANTIC 1038:1bd8
    const surface = makeSurface(6, 5);
    drawRect(surface, state({ foreground: 4, background: 9, fill: false }), 1, 1, 4, 3);
    expect(rows(surface)).toEqual(['000000', '044440', '040040', '044440', '000000']);
  });

  it('draws only the outline when the width or height is under 2', () => {
    // SCRANTIC 1038:1bd8
    const surface = makeSurface(4, 4);
    drawRect(surface, state({ foreground: 4, background: 9 }), 1, 0, 1, 3);
    expect(rows(surface)).toEqual(['0400', '0400', '0400', '0000']);
  });

  it('fills the whole rect with the brush when foreground equals background', () => {
    // SCRANTIC 1038:1bd8 (PATCOPY)
    const surface = makeSurface(5, 4);
    drawRect(surface, state({ foreground: 6, background: 6 }), 1, 1, 3, 2);
    expect(rows(surface)).toEqual(['00000', '06660', '06660', '00000']);
  });

  it('outlines in the foreground and fills the inside with the background brush', () => {
    // SCRANTIC 1038:1bd8 1038:1d31 (GDI Rectangle)
    const surface = makeSurface(6, 5);
    drawRect(surface, state({ foreground: 4, background: 0x12 }), 0, 0, 6, 5);
    expect(rows(surface)).toEqual(['444444', '421214', '412124', '421214', '444444']);
  });
});

describe('drawCircle', () => {
  it('fits the circle in the rect from center minus radius to center plus radius, right and bottom excluded', () => {
    // SCRANTIC 1040:0688 (GDI Ellipse)
    const surface = makeSurface(8, 8);
    drawCircle(surface, state({ foreground: 1, background: 2, clip: { x1: 0, y1: 0, x2: 7, y2: 7 } }), 3, 4, 4);
    expect(rows(surface)).toEqual([
      '00000000',
      '00111100',
      '01222210',
      '01222210',
      '01222210',
      '01222210',
      '00111100',
      '00000000',
    ]);
  });

  it('draws nothing with radius 0', () => {
    // SCRANTIC 1040:0688 (GDI Ellipse, empty rect)
    const surface = makeSurface(4, 4);
    drawCircle(surface, state({ foreground: 1, background: 2 }), 0, 2, 2);
    expect(surface.pixels.every((index) => index === 0)).toBe(true);
  });
});
