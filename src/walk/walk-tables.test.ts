import { describe, expect, it } from 'vitest';
import { ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS } from './walk-tables.js';

const SPOTS = 6;
const HEADINGS = 8;
const FULL = 100;
const turnSets = new Set([...STANDING_TURNS, ...WALKING_TURNS].filter((id) => id !== 0));
const UNVISITED_SPOT_INDEX = 1;
const SPOT_5_INDEX = 4;
const SPOT_6_INDEX = 5;

function isEmptyGroup(fromIndex: number, toIndex: number, spotIndex: number): boolean {
  if (spotIndex === toIndex) return true;
  const between5And6 = [fromIndex, toIndex].sort().join() === [SPOT_5_INDEX, SPOT_6_INDEX].join();
  return between5And6 && spotIndex === UNVISITED_SPOT_INDEX;
}

describe('walk tables', () => {
  it('has a route for every pair of different spots and none for a spot to itself', () => {
    // SCRANTIC 1018:03ac 1068:0a94
    for (let from = 1; from <= SPOTS; from++) {
      for (let to = 1; to <= SPOTS; to++) expect(ROUTES[from - 1]![to - 1] === null, `${from}->${to}`).toBe(from === to);
    }
  });

  it('gives the target spot of a route, and spot 2 between spots 5 and 6, the single choice (0, 0), and every other spot choices that reach 100 percent', () => {
    // SCRANTIC 1018:0094 1068:0362
    ROUTES.forEach((row, from) => row.forEach((route, to) => {
      if (!route) return;
      expect(route).toHaveLength(SPOTS);
      route.forEach((choices, spot) => {
        if (isEmptyGroup(from, to, spot)) expect(choices, `${from + 1}->${to + 1} at ${spot + 1}`).toEqual([[0, 0]]);
        else expect(choices.reduce((sum, [, percent]) => sum + percent, 0), `${from + 1}->${to + 1} at ${spot + 1}`).toBeGreaterThanOrEqual(FULL);
      });
    }));
  });

  it('routes only through walking segments, never through a turn set', () => {
    // SCRANTIC 1018:0094 1018:03ea
    ROUTES.forEach((row, from) => row.forEach((route, to) => route?.forEach((choices, spot) => {
      if (isEmptyGroup(from, to, spot)) return;
      for (const [segment] of choices) {
        expect(turnSets.has(segment), `${from + 1}->${to + 1} at ${spot + 1}: ${segment}`).toBe(false);
        expect(SEGMENTS[segment]!.frames.length).toBeGreaterThan(0);
      }
    })));
  });

  it('has one frame per heading in every turn set, and no headings or spot of its own', () => {
    // SCRANTIC 1068:0347 1068:034e
    for (const id of turnSets) {
      expect(SEGMENTS[id]).toMatchObject({ startHeading: 0, endHeading: 0, spot: 0 });
      expect(SEGMENTS[id]!.frames).toHaveLength(HEADINGS);
    }
  });

  it('numbers 34 segments after the empty segment 0', () => {
    // SCRANTIC 1018:03ea
    expect(SEGMENTS).toHaveLength(35);
    expect(SEGMENTS[0]).toEqual({ startHeading: 0, endHeading: 0, spot: 0, frames: [] });
  });
});
