import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../testing/corpus.js';
import { wipeShapes } from './fade.js';

const TYPES = ['ellipse', 'rect', 'right-to-left', 'left-to-right', 'top-to-bottom', 'bottom-to-top'];

describe.skipIf(!hasFixture('graphics/wipes.tsv'))('wipes match the original SCRANTIC.SCR', () => {
  it('draws the same shapes in the same order for every wipe and area', () => {
    // SCRANTIC 1020:0512 1020:05a0 1020:0637 1020:0688 1020:06d2 1020:071c
    const wrong = readFixtureRows('graphics/wipes.tsv').flatMap(([name, x, y, w, h, shapesText]) => {
      const ours = wipeShapes(TYPES.indexOf(name!), Number(x), Number(y), Number(w), Number(h)).map((s) => [s.kind, s.left, s.top, s.right, s.bottom]);
      return JSON.stringify(ours) === shapesText ? [] : [`${name} at ${x},${y}`];
    });
    expect(wrong).toEqual([]);
  });
});
