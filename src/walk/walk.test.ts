import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { MIRROR } from '../gfx/gdi/sprite.js';
import { makeSurface } from '../gfx/gdi/surface.js';
import { makeIsland } from '../island/island.js';
import type { SpriteSheet } from '../island/island-device.js';
import type { ParsedArchive } from '../resource/types.js';
import type { RandomSource } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { RecordingIslandDevice } from '../testing/island-recorder.js';
import { loadWalk, makeWalk, NO_HEADING, NO_SEGMENT, pickSegment, routeOf, segmentFrames, walkReset, walkStep, type Walk } from './walk.js';
import { MIRRORED_FRAME, ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS } from './walk-tables.js';

const NO_ARCHIVE: ParsedArchive = { byName: new Map(), list: [] };
const SHEET: SpriteSheet = { name: 'JOHNWALK.BMP', images: Array.from({ length: 256 }, () => makeSurface(10, 20)) };

class ScriptedRandom implements RandomSource {
  constructor(private readonly values: number[]) {}
  next(): number {
    return this.values.shift() ?? 0;
  }
  percent(): number {
    return 0;
  }
}

function setUp(randoms: number[] = []) {
  const device = new RecordingIslandDevice(NO_ARCHIVE);
  const world = makeStoryWorld(new ScriptedRandom(randoms));
  const island = makeIsland(device, world, makeTimers(), { background: true, clouds: true, waves: true });
  const walk = makeWalk(island);
  walk.sheet = SHEET;
  walk.targetHeading = NO_HEADING;
  return { device, walk, sequence: world.sequence, timers: island.timers };
}

function step(walk: Walk): void {
  walk.island.timers.walk = 0;
  walkStep(walk);
}

describe('walk tables lookups', () => {
  it('finds a route only for two different spots 1..6', () => {
    // SCRANTIC 1018:03ac
    expect(routeOf(0, 3)).toBeNull();
    expect(routeOf(3, 0)).toBeNull();
    expect(routeOf(3, 3)).toBeNull();
    expect(routeOf(1, 2)).toBe(ROUTES[0]![1]);
  });

  it('finds frames only for segments 1..34', () => {
    // SCRANTIC 1018:03ea
    expect(segmentFrames(0)).toBeNull();
    expect(segmentFrames(35)).toBeNull();
    expect(segmentFrames(1)).toBe(SEGMENTS[1]!.frames);
  });

  it('picks the first choice whose running percent reaches the value', () => {
    // SCRANTIC 1018:0094
    const choices = ROUTES[0]![1]![0]!;
    expect(choices).toEqual([[1, 13], [1, 12], [2, 25], [4, 25], [4, 25]]);
    expect([0, 13, 14, 25, 26, 50, 51, 99].map((value) => pickSegment(choices, value))).toEqual([1, 1, 1, 1, 2, 2, 4, 4]);
  });

  it('picks no segment from the (0, 0) group, where the original reads on into the next group', () => {
    // SCRANTIC 1018:0094
    expect([0, 1, 99].map((value) => pickSegment([[0, 0]], value))).toEqual([NO_SEGMENT, NO_SEGMENT, NO_SEGMENT]);
  });
});

describe('walk step', () => {
  it('starts the route from Johnny spot and first turns one heading toward the segment', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence, timers } = setUp([26]);
    sequence.spot = 1;
    sequence.heading = 0;
    walk.targetSpot = 2;
    step(walk);
    expect(walk).toMatchObject({ routeFrom: 1, routeTo: 2, segment: 2, record: 0, wantedHeading: 6, segmentHeading: 5, segmentSpot: 6 });
    expect(sequence.heading).toBe(7);
    expect([walk.frameSegment, walk.frameRecord]).toEqual([WALKING_TURNS[1], 7]);
    expect(timers.walk).toBe(4);
    step(walk);
    expect(sequence.heading).toBe(6);
    expect([walk.frameSegment, walk.frameRecord, walk.record]).toEqual([2, 0, 1]);
  });

  it('only redraws the frame while the delay runs', () => {
    // SCRANTIC 1018:0094 1008:16c2
    const { walk, sequence, timers, device } = setUp([26]);
    sequence.spot = 1;
    walk.targetSpot = 2;
    step(walk);
    device.events.length = 0;
    timers.walk = 2;
    walkStep(walk);
    expect(sequence.heading).toBe(7);
    expect([walk.frameSegment, walk.frameRecord]).toEqual([WALKING_TURNS[1], 7]);
    expect(device.events.map(([event]) => event)).toEqual(['sprite', 'dirty', 'dirty', 'dirty']);
    expect(timers.walk).toBe(4);
  });

  it('walks every frame of the segment, then lands on its end spot and heading', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence } = setUp([26]);
    sequence.spot = 1;
    sequence.heading = 6;
    walk.targetSpot = 2;
    expect(SEGMENTS[2]!.frames).toHaveLength(20);
    for (let record = 0; record < 20; record++) {
      expect(sequence.spot).toBe(1);
      step(walk);
      expect([walk.frameSegment, walk.frameRecord]).toEqual([2, record]);
    }
    expect([sequence.spot, sequence.heading, walk.segment]).toEqual([6, 5, 0]);
    expect([walk.routeFrom, walk.routeTo]).toEqual([1, 2]);
  });

  it('drops the route on landing on the target spot', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence } = setUp([99]);
    sequence.spot = 1;
    sequence.heading = 6;
    walk.targetSpot = 2;
    const frames = SEGMENTS[4]!.frames.length;
    for (let i = 0; i < frames; i++) step(walk);
    expect([sequence.spot, sequence.heading, walk.routeFrom, walk.segment]).toEqual([2, 7, 0, 0]);
  });

  it('turns at the target to the target heading with the standing turn set, then wants no heading', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence } = setUp();
    sequence.spot = 3;
    sequence.heading = 1;
    walk.targetSpot = 3;
    walk.targetHeading = 3;
    walk.wantedHeading = 1;
    step(walk);
    expect([sequence.heading, walk.wantedHeading, walk.frameSegment, walk.frameRecord]).toEqual([2, 3, STANDING_TURNS[3], 2]);
    step(walk);
    expect([sequence.heading, walk.targetHeading]).toEqual([3, 3]);
    step(walk);
    expect([walk.targetHeading, walk.frameSegment, walk.frameRecord]).toEqual([NO_HEADING, STANDING_TURNS[3], 3]);
  });

  it('turns toward a wanted heading left over from before, and picks a side at random when it is opposite', () => {
    // SCRANTIC 1018:0094
    for (const [random, heading] of [[0, 2], [1, 0]] as const) {
      const { walk, sequence } = setUp([random]);
      sequence.spot = 3;
      sequence.heading = 1;
      walk.targetSpot = 3;
      walk.targetHeading = 3;
      walk.wantedHeading = 5;
      step(walk);
      expect([sequence.heading, walk.wantedHeading]).toEqual([heading, 5]);
    }
  });

  it('draws Johnny on the current target, redraws the island over him, and adds three rects of his size', () => {
    // SCRANTIC 1018:0094 1010:1551
    const { walk, device, timers } = setUp();
    walk.island.x = 7;
    walk.island.y = 5;
    walk.frameSegment = 2;
    walk.frameRecord = 0;
    timers.walk = 1;
    walkStep(walk);
    const [word, x, y] = SEGMENTS[2]!.frames[0]!;
    const at = [7 + x, 5 + y];
    expect(device.events).toEqual([
      ['sprite', SURFACE_A, 'JOHNWALK.BMP', word & 0x7fff, ...at, word & MIRRORED_FRAME ? MIRROR : 0, 0, 0, 0, 639, 479],
      ['dirty', SURFACE_B, SURFACE_A, 0, ...at, 10, 20],
      ['dirty', SURFACE_B, SURFACE_A, 1, ...at, 10, 20],
      ['dirty', SURFACE_C, SURFACE_B, 0, ...at, 10, 20],
    ]);
  });

  it('draws nothing and keeps the delay when there is no frame yet', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence, device, timers } = setUp();
    sequence.spot = 1;
    walk.targetSpot = 1;
    step(walk);
    expect(device.events).toEqual([]);
    expect(timers.walk).toBe(0);
  });

  it('returns before drawing when the route has no choices for Johnny spot', () => {
    // SCRANTIC 1018:0094
    const { walk, sequence, device, timers } = setUp();
    sequence.spot = 0;
    walk.targetSpot = 2;
    walk.routeFrom = 1;
    walk.routeTo = 2;
    walk.frameSegment = 2;
    step(walk);
    expect(device.events).toEqual([]);
    expect(timers.walk).toBe(0);
  });

  it('drops a route left over from an old target on reaching its end spot, then routes to the new target', () => {
    // SCRANTIC 1018:0094 (OQ-37: the original picks from the next group's words)
    const { walk, sequence } = setUp([26]);
    sequence.spot = 2;
    sequence.heading = 6;
    walk.targetSpot = 1;
    walk.routeFrom = 1;
    walk.routeTo = 2;
    step(walk);
    expect([walk.routeFrom, walk.segment, walk.lostRoutes]).toEqual([0, 0, 1]);
    step(walk);
    expect([walk.routeFrom, walk.routeTo, walk.lostRoutes]).toEqual([2, 1, 1]);
    expect(walk.segment).not.toBe(NO_SEGMENT);
  });

  it('drops the route and segment and wants the current heading on reset', () => {
    // SCRANTIC 1018:0074
    const { walk, sequence } = setUp();
    Object.assign(walk, { routeFrom: 1, routeTo: 2, segment: 4, record: 3, wantedHeading: 6 });
    sequence.heading = 2;
    walkReset(walk);
    expect(walk).toMatchObject({ routeFrom: 0, routeTo: 0, segment: 0, wantedHeading: 2 });
  });
});

describe('walk loading', () => {
  it('loads JOHNWALK.BMP once and puts Johnny at spot 1 facing 0', () => {
    // SCRANTIC 1018:0000
    const { walk, sequence, device } = setUp();
    walk.sheet = null;
    sequence.spot = 4;
    sequence.heading = 6;
    expect(loadWalk(walk)).toBe(false);
    expect(device.events).toEqual([['sheet', 'JOHNWALK.BMP']]);
    expect([sequence.spot, sequence.heading, walk.targetSpot]).toEqual([1, 0, 1]);
    walk.sheet = SHEET;
    sequence.spot = 4;
    expect(loadWalk(walk)).toBe(true);
    expect(sequence.spot).toBe(4);
  });
});
