import { describe, expect, it } from 'vitest';
import type { WallClock } from './calendar.js';
import { StoryRandom } from './random.js';
import { SCENE_CLOSES, SCENE_OPENS, SCENES } from './scene-table.js';
import {
  advanceDays, applySceneFlags, buildQueue, fitsIsland, makeStoryWorld, newSequence, pickScene,
  KIND_CLOSING, MODE_NIGHT, MODE_NO_ISLAND, NO_PLACE, NO_TIDE,
} from './sequence.js';

const clock = (day: number): WallClock => ({ year: 1992, month: 6, day, hour: 10, minute: 0 });

describe('island flags', () => {
  it('turns entry flags and place bits into island settings', () => {
    // SCRANTIC 1010:1c41
    const world = makeStoryWorld(new StoryRandom());
    expect(world.island).toEqual({ place: NO_PLACE, lowTide: NO_TIDE, mode: 0, still: false, noRaft: false, holidayShown: true });
    applySceneFlags(world.island, SCENES[13]!);
    expect(world.island).toMatchObject({ lowTide: 0, noRaft: true, place: 0x04 | 0x08 });
    applySceneFlags(world.island, SCENES[11]!);
    expect(world.island.mode).toBe(MODE_NIGHT);
    expect(world.island.still).toBe(true);
    applySceneFlags(world.island, SCENES[69]!);
    expect(world.island.mode).toBe(MODE_NO_ISLAND);
  });

  it('accepts any place while none is chosen and rejects clashing ones', () => {
    // SCRANTIC 1018:0eb5
    expect(fitsIsland(NO_PLACE, 0x20)).toBe(true);
    expect(fitsIsland(0x02, 0x20)).toBe(false);
    expect(fitsIsland(0x01, 0x10)).toBe(false);
    expect(fitsIsland(0, 0x20)).toBe(true);
  });
});

describe('day counters', () => {
  it('starts a fresh install on day one', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    advanceDays(world, clock(1));
    expect(world.days).toEqual({ numDays: 1, introduction: 1, year: 1992, month: 6, day: 1 });
  });

  it('moves Introduction on after a day scene was picked, and NumDays on the next date', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    advanceDays(world, clock(1));
    world.memory.newSequence = true;
    world.memory.dayScenePicked = true;
    advanceDays(world, clock(1));
    expect(world.days).toMatchObject({ numDays: 1, introduction: 2 });
    expect(world.memory).toMatchObject({ newSequence: false, dayScenePicked: false });
    advanceDays(world, clock(2));
    expect(world.days).toMatchObject({ numDays: 2, introduction: 2, day: 2 });
  });

  it('starts over after day 11', () => {
    // SCRANTIC 1018:0b87
    const world = makeStoryWorld(new StoryRandom());
    world.days = { numDays: 11, introduction: 12, year: 1992, month: 6, day: 1 };
    advanceDays(world, clock(2));
    expect(world.days).toMatchObject({ numDays: 1, introduction: 1 });
  });
});

describe('scene picks and queues', () => {
  it('picks only entries of the kind, slot, and budget', () => {
    // SCRANTIC 1018:0d50
    const world = makeStoryWorld(new StoryRandom());
    for (let i = 0; i < 200; i++) {
      const entry = pickScene(world, KIND_CLOSING, 13, 0)!;
      expect(entry.flags & SCENE_CLOSES).not.toBe(0);
      expect(entry.day).toBe(0);
      expect(entry.fromSlot <= 13 && 13 < entry.toSlot).toBe(true);
    }
  });

  it('ends every queue with its closing scene and makes a whole-sequence scene the only entry', () => {
    // SCRANTIC 1018:089b
    for (let seed = 0; seed < 100; seed++) {
      const random = new StoryRandom();
      random.discard(seed * 37);
      const world = makeStoryWorld(random);
      advanceDays(world, clock(1));
      const queue = buildQueue(world, seed % 16);
      const closing = queue[queue.length - 1]!;
      expect(closing.flags & SCENE_CLOSES).not.toBe(0);
      expect(world.memory.lastClosing).toBe(closing);
      if (closing.flags & SCENE_OPENS) expect(queue.length).toBe(1);
    }
  });

  it('puts Johnny at the first entry and empties the old queue', () => {
    // SCRANTIC 1018:0540 1018:0673
    const world = makeStoryWorld(new StoryRandom());
    world.sequence.position = 5;
    world.memory.newSequence = true;
    newSequence(world, clock(1));
    expect(world.sequence.position).toBe(0);
    expect(world.sequence.spot).toBe(world.sequence.queue[0]!.spotStart);
    expect(world.sequence.heading).toBe(world.sequence.queue[0]!.hdgStart);
  });
});
