import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from '../../types.js';
import { activeClip, makeDrawState, makeSurface, plot, rawIndices } from './surface.js';

describe('makeDrawState', () => {
  it('starts like the original display setup: colors 0, fill on, clip off over the whole screen', () => {
    // SCRANTIC 1038:1744
    expect(makeDrawState()).toEqual({
      foreground: 0,
      background: 0,
      fill: true,
      clipOn: false,
      clip: { x1: 0, y1: 0, x2: 639, y2: 479 },
    });
  });
});

describe('makeSurface', () => {
  it('is 640x480 filled with index 0', () => {
    // SCRANTIC 1038:1744
    const surface = makeSurface();
    expect([surface.width, surface.height, surface.pixels.length]).toEqual([640, 480, 640 * 480]);
    expect(surface.pixels.every((index) => index === 0)).toBe(true);
  });
});

describe('activeClip', () => {
  it('is the whole surface while the clip is off', () => {
    // SCRANTIC 1038:1ade
    const state = { ...makeDrawState(), clip: { x1: 10, y1: 20, x2: 30, y2: 40 } };
    expect(activeClip(makeSurface(), state)).toEqual({ x1: 0, y1: 0, x2: 639, y2: 479 });
  });

  it('is the inclusive clip rect, cut to the surface, while the clip is on', () => {
    // SCRANTIC 1038:1ade
    const state = { ...makeDrawState(), clipOn: true, clip: { x1: -5, y1: 20, x2: 700, y2: 40 } };
    expect(activeClip(makeSurface(), state)).toEqual({ x1: 0, y1: 20, x2: 639, y2: 40 });
  });
});

describe('plot', () => {
  it('writes inside the clip and drops everything outside', () => {
    const surface = makeSurface(4, 4);
    const clip = { x1: 1, y1: 1, x2: 2, y2: 2 };
    plot(surface, clip, 1, 1, 7);
    plot(surface, clip, 2, 2, 7);
    plot(surface, clip, 0, 1, 7);
    plot(surface, clip, 3, 2, 7);
    expect(Array.from(surface.pixels)).toEqual([0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0]);
  });
});

describe('rawIndices', () => {
  it('turns the decoders see-through marker back into index 0', () => {
    expect(Array.from(rawIndices(Uint8Array.of(3, TRANSPARENT, 0)))).toEqual([3, 0, 0]);
  });
});
