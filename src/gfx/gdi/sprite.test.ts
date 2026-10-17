import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from '../../types.js';
import { drawSprite, drawSpriteStretched, FLIP_VERTICAL, MIRROR, spriteSurface } from './sprite.js';
import { makeDrawState, makeSurface, type Surface } from './surface.js';

function image(width: number, height: number, pixels: number[]): Surface {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

function filled(width: number, height: number, index: number): Surface {
  const surface = makeSurface(width, height);
  surface.pixels.fill(index);
  return surface;
}

function rows(surface: Surface): string[] {
  return Array.from({ length: surface.height }, (_, y) =>
    Array.from(surface.pixels.subarray(y * surface.width, (y + 1) * surface.width), (index) => index.toString(16)).join(''),
  );
}

describe('spriteSurface', () => {
  it('keeps the sprite size and turns see-through pixels back into index 0', () => {
    const surface = spriteSurface({ width: 2, height: 1, indexed: Uint8Array.of(TRANSPARENT, 4) });
    expect([surface.width, surface.height, Array.from(surface.pixels)]).toEqual([2, 1, [0, 4]]);
  });
});

describe('drawSprite', () => {
  it('leaves the destination where the index is 0 and replaces it everywhere else', () => {
    // SCRANTIC 1038:0ae4 (mask AND NOT, image OR) 1040:035c
    const surface = filled(4, 3, 5);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 0, 0, 2]), 1, 1);
    expect(rows(surface)).toEqual(['5555', '5155', '5525']);
  });

  it('mirrors left to right with flag 2', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(4, 1);
    drawSprite(surface, makeDrawState(), image(4, 1, [1, 2, 3, 4]), 0, 0, MIRROR);
    expect(rows(surface)).toEqual(['4321']);
  });

  it('flips upside down with flag 1', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(1, 3);
    drawSprite(surface, makeDrawState(), image(1, 3, [1, 2, 3]), 0, 0, FLIP_VERTICAL);
    expect(rows(surface)).toEqual(['3', '2', '1']);
  });

  it('does both with flag 3 when there is no pre-mirrored copy', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(2, 2);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 2, 3, 4]), 0, 0, FLIP_VERTICAL | MIRROR);
    expect(rows(surface)).toEqual(['43', '21']);
  });

  it('only mirrors with flag 3 when the image has a pre-mirrored copy', () => {
    // SCRANTIC 1038:0ae4 1040:054e
    const surface = makeSurface(2, 2);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 2, 3, 4]), 0, 0, FLIP_VERTICAL | MIRROR, true);
    expect(rows(surface)).toEqual(['21', '43']);
  });

  it('honors the clip', () => {
    // SCRANTIC 1038:0ae4 1038:1ade
    const surface = makeSurface(3, 1);
    const state = { ...makeDrawState(), clipOn: true, clip: { x1: 1, y1: 0, x2: 1, y2: 0 } };
    drawSprite(surface, state, image(3, 1, [7, 8, 9]), 0, 0);
    expect(rows(surface)).toEqual(['080']);
  });
});

describe('drawSpriteStretched', () => {
  it('scales the image to the given size', () => {
    // SCRANTIC 1030:03d7
    const surface = makeSurface(4, 2);
    drawSpriteStretched(surface, makeDrawState(), image(2, 1, [1, 2]), 0, 0, 0, 4, 2);
    expect(rows(surface)).toEqual(['1122', '1122']);
  });

  it('mirrors with flag 2 while scaling', () => {
    // SCRANTIC 1030:03d7
    const surface = makeSurface(4, 1);
    drawSpriteStretched(surface, makeDrawState(), image(2, 1, [1, 2]), 0, 0, MIRROR, 4, 1);
    expect(rows(surface)).toEqual(['2211']);
  });
});
