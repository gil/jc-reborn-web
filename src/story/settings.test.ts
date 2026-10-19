import { describe, expect, it } from 'vitest';
import { StoryRandom } from './random.js';
import { makeStoryWorld } from './sequence.js';
import { loadSettings, saveSettings, type SettingsStore } from './settings.js';

function memoryStore(text: string | null = null): SettingsStore & { text: string | null } {
  return { text, read() { return this.text; }, write(value) { this.text = value; } };
}

const islandSettings = () => ({ background: false, clouds: false, waves: false });

describe('settings', () => {
  it('uses the original defaults when nothing is stored', () => {
    // SCRANTIC 1008:0c5c 1068:00b6
    const world = makeStoryWorld(new StoryRandom());
    const island = islandSettings();
    loadSettings(memoryStore(), world, island);
    expect(island).toEqual({ background: true, clouds: true, waves: true });
    expect(world.days).toEqual({ numDays: 0, introduction: 0, year: 0, month: 0, day: 0 });
    expect(world.startTime).toBe(900);
  });

  it('round-trips the day counters and start time', () => {
    // SCRANTIC 1008:0c5c 1008:0dc8
    const store = memoryStore();
    const world = makeStoryWorld(new StoryRandom());
    world.days = { numDays: 4, introduction: 5, year: 1992, month: 6, day: 2 };
    world.startTime = 1230;
    saveSettings(store, world, { background: true, clouds: false, waves: true });
    const loaded = makeStoryWorld(new StoryRandom());
    const island = islandSettings();
    loadSettings(store, loaded, island);
    expect(loaded.days).toEqual(world.days);
    expect(loaded.startTime).toBe(1230);
    expect(island).toEqual({ background: true, clouds: false, waves: true });
  });

  it('keeps NumDays and Introduction to a byte, as the original globals are', () => {
    // SCRANTIC 1008:0c5c 1068:2d9b 1068:2d9a
    const world = makeStoryWorld(new StoryRandom());
    loadSettings(memoryStore('{"NumDays":300,"Introduction":200}'), world, islandSettings());
    expect(world.days.numDays).toBe(44);
    expect(world.days.introduction).toBe(-56);
  });

  it('falls back to the defaults on unreadable text', () => {
    const world = makeStoryWorld(new StoryRandom());
    loadSettings(memoryStore('not json'), world, islandSettings());
    expect(world.startTime).toBe(900);
  });
});
