import { describe, expect, it } from 'vitest';
import { clockTick, makeTimers } from '../engine/timers.js';
import { Display } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { DisplayIslandDevice } from '../island/island-device.js';
import { drawIsland, makeIsland } from '../island/island.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { loadWalk, makeWalk } from '../walk/walk.js';
import { StoryRandom } from './random.js';
import { ADS_FILES, SCENES } from './scene-table.js';
import { makeStoryWorld } from './sequence.js';
import { currentEntry, makeStoryState, storyStep, type GameState, type StoryState } from './story.js';

const STEP_LIMIT = 20_000;
const STEP_MS = 50;
const TICK_MS = 16;
const stepsTaken = new WeakMap<GameState, number>();

function makeGame(): GameState {
  const archive = loadArchive();
  const display = new Display();
  display.screenIsB = true;
  const draw = makeDrawState();
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  const timers = makeTimers();
  const island = makeIsland(new DisplayIslandDevice(display, archive), world, timers, { background: true, clouds: true, waves: true });
  drawIsland(island);
  const walk = makeWalk(island);
  loadWalk(walk);
  const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => random.next() });
  let saved: string | null = null;
  return {
    archive, display, ttm: makeTtmEnv(device, draw), palette: makePalette(), random, timers, world, island, walk,
    settings: { read: () => saved, write: (text) => { saved = text; } },
    fadeState: null,
    clock: () => new Date(1992, 5, 1, 10, 0),
  };
}

function step(story: StoryState, game: GameState): void {
  const n = stepsTaken.get(game) ?? 0;
  stepsTaken.set(game, n + 1);
  const ticks = Math.floor((STEP_MS * (n + 1)) / TICK_MS) - Math.floor((STEP_MS * n) / TICK_MS);
  for (let i = 0; i < ticks; i++) clockTick(game.timers);
  storyStep(story, game);
}

describe.skipIf(!hasCorpus)('story on the real data', () => {
  it('wipes for 16 steps, then builds a sequence and works through it', { timeout: 300_000 }, () => {
    // SCRANTIC 1018:06bf 1018:0540 1018:0673
    const game = makeGame();
    const story = makeStoryState();
    for (let i = 0; i < 16; i++) step(story, game);
    expect(game.world.sequence.queue).toEqual([]);
    step(story, game);
    expect(game.world.sequence.queue.length).toBeGreaterThan(0);
    let finished = 0;
    let position = game.world.sequence.position;
    for (let i = 0; i < 6000 && finished < 3; i++) {
      step(story, game);
      if (game.world.sequence.position !== position) {
        finished++;
        position = game.world.sequence.position;
      }
    }
    expect(finished).toBeGreaterThanOrEqual(3);
  });

  it('plays every scene table entry of every ADS file to its end, with no watchdog', { timeout: 900_000 }, () => {
    // SCRANTIC 1018:06bf 1048:0766
    const stuck: string[] = [];
    for (const name of new Set(ADS_FILES.values())) {
      const game = makeGame();
      const story = makeStoryState(name);
      for (const entry of SCENES.filter((scene) => ADS_FILES.get(scene.ads) === name)) {
        let steps = 0;
        while (currentEntry(game) !== entry && steps < STEP_LIMIT) {
          step(story, game);
          steps++;
        }
        while (currentEntry(game) === entry && steps < STEP_LIMIT) {
          step(story, game);
          steps++;
        }
        if (steps >= STEP_LIMIT) stuck.push(`${name} tag ${entry.tag} (entry ${entry.index})`);
      }
    }
    expect(stuck).toEqual([]);
  });
});
