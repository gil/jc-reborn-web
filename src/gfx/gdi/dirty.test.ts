import { describe, expect, it } from 'vitest';
import { COPY_RECT, DirtyLists, LIST_SLOTS, NO_SOURCE, SAVED_BITS, type DirtyRect } from './dirty.js';

const A = 0xa1;
const B = 0xb2;

function rect(x: number, y: number, w: number, h: number, changes: Partial<DirtyRect> = {}): DirtyRect {
  return { x, y, w, h, source: B, target: A, kind: COPY_RECT, age: 0, area: w * h, saved: 0, ...changes };
}

describe('DirtyLists.add', () => {
  it('turns kind 1 rects into 8-pixel columns', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(13, 5, 10, 4, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(1, 5, 2, 4)]]]);
  });

  it('cuts kind 1 rects to the screen while the clip is off and drops rects fully outside', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(640, 0, 5, 5, COPY_RECT, B, A, 0, null);
    lists.add(-10, 0, 9, 5, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([]);
    lists.add(630, 470, 20, 20, COPY_RECT, B, A, 0, null);
    lists.add(-5, -3, 20, 10, COPY_RECT, B, A, 1, null);
    expect(lists.snapshot()).toEqual([
      [0, [rect(78, 470, 2, 10)]],
      [1, [rect(0, 0, 2, 7, { age: 1 })]],
    ]);
  });

  it('cuts kind 1 rects to the clip rect while the clip is on', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(90, 140, 30, 30, COPY_RECT, B, A, 0, { x1: 100, y1: 100, x2: 199, y2: 149 });
    expect(lists.snapshot()).toEqual([[0, [rect(12, 140, 3, 10)]]]);
  });

  it('merges when the union wastes at most 20 cells and keeps far rects apart', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(8, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(400, 400, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(50, 400, 1, 8), rect(0, 0, 2, 8)]]]);
  });

  it('merges a union whose 16-bit area wraps negative', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(632, 472, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(0, 0, 80, 480, { area: 38400 - 65536 })]]]);
  });

  it('stores kind 4 rects in pixels with no source and never merges them', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 99);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 98);
    const saved = (value: number) => rect(5, 6, 7, 8, { source: NO_SOURCE, kind: SAVED_BITS, saved: value });
    expect(lists.snapshot()).toEqual([[0, [saved(98), saved(99)]]]);
  });

  it('ignores a new key once all 20 slots are taken', () => {
    // SCRANTIC 1060:05a7
    const lists = new DirtyLists(640, 480);
    for (let age = 0; age <= LIST_SLOTS; age++) lists.add(0, 0, 8, 8, COPY_RECT, B, A, age, null);
    expect(lists.snapshot()).toHaveLength(LIST_SLOTS);
  });
});

describe('DirtyLists.replay and restorePass', () => {
  it('replays head to tail in pixels and empties the list', () => {
    // SCRANTIC 1060:05f9
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(400, 400, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.replay(B, A, 0)).toEqual([
      { kind: 'copy', source: B, target: A, x: 400, y: 400, w: 8, h: 8 },
      { kind: 'copy', source: B, target: A, x: 0, y: 0, w: 8, h: 8 },
    ]);
    expect(lists.snapshot()).toEqual([]);
  });

  it('replays saved bits with their buffer', () => {
    // SCRANTIC 1060:05f9
    const lists = new DirtyLists(640, 480);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 99);
    expect(lists.replay(NO_SOURCE, A, 0)).toEqual([{ kind: 'bits', target: A, saved: 99, x: 5, y: 6, w: 7, h: 8 }]);
  });

  it('ages every rect left after the pass, so age 1 rects replay one pass later', () => {
    // SCRANTIC 1060:03d3
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 1, null);
    expect(lists.restorePass([[B, A]], true)).toEqual([]);
    expect(lists.restorePass([[B, A]], true)).toEqual([{ kind: 'copy', source: B, target: A, x: 0, y: 0, w: 8, h: 8 }]);
  });
});

describe('DirtyLists.overlaps', () => {
  it('reports a kind 1 rect of that target and age overlapping in columns', () => {
    // SCRANTIC 1060:04b2
    const lists = new DirtyLists(640, 480);
    lists.add(16, 10, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.overlaps(20, 12, 4, 4, A, 0)).toBe(COPY_RECT);
    expect(lists.overlaps(40, 12, 4, 4, A, 0)).toBe(0);
    expect(lists.overlaps(20, 12, 4, 4, A, 1)).toBe(0);
  });
});
