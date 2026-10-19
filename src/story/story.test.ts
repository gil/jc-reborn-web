import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { makeIsland } from '../island/island.js';
import type { ParsedArchive } from '../resource/types.js';
import { RecordingIslandDevice } from '../testing/island-recorder.js';
import { makeWalk } from '../walk/walk.js';
import { StoryRandom } from './random.js';
import { SCENES } from './scene-table.js';
import { makeStoryWorld } from './sequence.js';
import { finishEntry, isAtSpot, makeStoryState } from './story.js';

describe('story step pieces', () => {
  it('stores the walk target and says whether Johnny is already there', () => {
    // SCRANTIC 1018:0b46
    const world = makeStoryWorld(new StoryRandom());
    const noArchive: ParsedArchive = { byName: new Map(), list: [] };
    const walk = makeWalk(makeIsland(new RecordingIslandDevice(noArchive), world, makeTimers(), { background: true, clouds: true, waves: true }));
    world.sequence.spot = 3;
    world.sequence.heading = 5;
    expect(isAtSpot(walk, 3, 5)).toBe(true);
    expect(isAtSpot(walk, 4, 5)).toBe(false);
    expect([walk.targetSpot, walk.targetHeading]).toEqual([4, 5]);
    expect(isAtSpot(walk, 0, 5)).toBe(true);
    expect([walk.targetSpot, walk.targetHeading]).toEqual([4, 5]);
    expect(isAtSpot(walk, 0, 6)).toBe(false);
  });

  it('moves Johnny to the end spot and on to the next entry', () => {
    // SCRANTIC 1018:06bf
    const state = makeStoryState();
    const world = makeStoryWorld(new StoryRandom());
    state.started = true;
    finishEntry(state, world, SCENES[2]!, true);
    expect(world.sequence).toMatchObject({ spot: 1, heading: 2, position: 1 });
    expect(state.started).toBe(false);
  });

  it('picks a random spot and heading for scene entries that end anywhere, not for idle entries', () => {
    // SCRANTIC 1018:06bf
    const world = makeStoryWorld(new StoryRandom());
    finishEntry(makeStoryState(), world, SCENES[4]!, true);
    expect(world.sequence.spot).toBeGreaterThanOrEqual(1);
    expect(world.sequence.spot).toBeLessThanOrEqual(6);
    const idle = { ...SCENES[54]!, spotEnd: 0, hdgEnd: 0 };
    finishEntry(makeStoryState(), world, idle, false);
    expect([world.sequence.spot, world.sequence.heading]).toEqual([0, 0]);
  });
});
