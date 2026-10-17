import { describe, expect, it } from 'vitest';
import { applyFade, fadeDone, nextFadeState, WIPE_TICKS, wipeShapes, type FadeState } from './fade.js';

const W = 640;
const H = 480;
const ELLIPSE = 0;
const RECT = 1;
const RIGHT_TO_LEFT = 2;
const LEFT_TO_RIGHT = 3;
const TOP_TO_BOTTOM = 4;
const BOTTOM_TO_TOP = 5;

function frame(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H * 4).fill(200);
}

const isBlack = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4] === 0;

describe('nextFadeState', () => {
  it('cycles through the six wipes in the original order', () => {
    // SCRANTIC 1020:0364 1068:361a
    const types = Array.from({ length: 7 }, () => nextFadeState().type);
    expect(types).toEqual([ELLIPSE, RECT, RIGHT_TO_LEFT, LEFT_TO_RIGHT, TOP_TO_BOTTOM, BOTTOM_TO_TOP, ELLIPSE]);
  });

  it('runs every wipe over the same number of ticks', () => {
    const state = nextFadeState();
    expect([state.step, state.maxSteps]).toEqual([0, WIPE_TICKS]);
    expect(fadeDone({ ...state, step: WIPE_TICKS })).toBe(true);
  });
});

describe('wipeShapes', () => {
  it('draws the original shapes for a 640x480 screen', () => {
    // SCRANTIC 1020:0512 1020:05a0 1020:0637 1020:0688 1020:06d2 1020:071c
    const ends = (type: number) => {
      const shapes = wipeShapes(type, 0, 0, W, H);
      return [shapes.length, shapes[0], shapes.at(-1)];
    };
    expect(ends(ELLIPSE)).toEqual([25, { kind: 'ellipse', left: 318, top: 238, right: 322, bottom: 242 }, { kind: 'ellipse', left: -6, top: -86, right: 646, bottom: 566 }]);
    expect(ends(RECT)).toEqual([60, { kind: 'rect', left: 314, top: 236, right: 326, bottom: 244 }, { kind: 'rect', left: -40, top: 0, right: 680, bottom: 480 }]);
    expect(ends(RIGHT_TO_LEFT)).toEqual([107, { kind: 'rect', left: 634, top: 0, right: 640, bottom: 480 }, { kind: 'rect', left: -2, top: 0, right: 4, bottom: 480 }]);
    expect(ends(LEFT_TO_RIGHT)).toEqual([107, { kind: 'rect', left: 0, top: 0, right: 6, bottom: 480 }, { kind: 'rect', left: 636, top: 0, right: 642, bottom: 480 }]);
    expect(ends(TOP_TO_BOTTOM)).toEqual([240, { kind: 'rect', left: 0, top: 0, right: 640, bottom: 2 }, { kind: 'rect', left: 0, top: 478, right: 640, bottom: 480 }]);
    expect(ends(BOTTOM_TO_TOP)).toEqual([240, { kind: 'rect', left: 0, top: 478, right: 640, bottom: 480 }, { kind: 'rect', left: 0, top: 0, right: 640, bottom: 2 }]);
  });
});

describe('applyFade', () => {
  const state = (type: number, step: number): FadeState => ({ type, step, maxSteps: WIPE_TICKS });

  it('leaves the frame alone before the first tick', () => {
    const px = frame();
    applyFade(px, state(RIGHT_TO_LEFT, 0));
    expect(isBlack(px, 639, 0)).toBe(false);
  });

  it('shows the share of shapes that matches the ticks so far', () => {
    // SCRANTIC 1020:0637
    const px = frame();
    applyFade(px, state(RIGHT_TO_LEFT, WIPE_TICKS / 2));
    expect([isBlack(px, 316, 100), isBlack(px, 315, 100), isBlack(px, 639, 479)]).toEqual([true, false, true]);
  });

  it('paints an ellipse as a filled black circle', () => {
    // SCRANTIC 1020:0512 (GDI Ellipse, black pen and brush)
    const px = frame();
    applyFade(px, state(ELLIPSE, 1));
    expect([isBlack(px, 320, 240), isBlack(px, 0, 0)]).toEqual([true, false]);
  });

  it('turns the whole frame black once the wipe is done', () => {
    // SCRANTIC 1020:0364 (FillRect with the black brush)
    const px = frame();
    applyFade(px, state(ELLIPSE, WIPE_TICKS));
    expect([isBlack(px, 0, 0), isBlack(px, 639, 479), px[3]]).toEqual([true, true, 255]);
  });
});
