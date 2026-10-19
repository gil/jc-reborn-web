import { decodeAds } from '../decode/ads-loader.js';
import { makeAdsState, type AdsState } from '../ads/state.js';
import { adsSectionBusy, adsStartSection, adsTick } from '../ads/tick.js';
import type { Timers } from '../engine/timers.js';
import { fadeDone, nextFadeState, type FadeState } from '../gfx/fade.js';
import type { Display } from '../gfx/gdi/display.js';
import { animateIsland, drawHoliday, drawIsland, ttmOffset, type Island } from '../island/island.js';
import type { ParsedArchive } from '../resource/types.js';
import type { TtmEnv } from '../ttm/page-runner.js';
import type { Palette } from '../types.js';
import { NO_HEADING, walkReset, walkStep, type Walk } from '../walk/walk.js';
import { holidayOf, timeSlot, wallClockOf, type WallClock } from './calendar.js';
import type { StoryRandom } from './random.js';
import { ADS_FILES, IDLE_ENTRY, SCENE_TTM_LEFT, SCENES, type SceneEntry } from './scene-table.js';
import { applySceneFlags, newSequence, resetIslandFlags, type StoryWorld } from './sequence.js';
import { saveSettings, type SettingsStore } from './settings.js';

const ANY_SPOT = 0;
const SPOTS = 6;
const HEADINGS = 8;
const IDLE_WAIT_BASE = 180;
const IDLE_WAIT_SPREAD = 240;
const DAY_SCENE_SOUND = 25;

export interface GameState {
  archive: ParsedArchive;
  display: Display;
  ttm: TtmEnv;
  palette: Palette;
  random: StoryRandom;
  timers: Timers;
  world: StoryWorld;
  island: Island;
  walk: Walk;
  settings: SettingsStore;
  fadeState: FadeState | null;
  clock: () => Date;
}

export interface StoryState {
  started: boolean;
  adsId: number;
  ads: AdsState | null;
  debugAds: string | null;
  debugNext: number;
}

export function makeStoryState(debugAds: string | null = null): StoryState {
  return { started: false, adsId: 0, ads: null, debugAds, debugNext: 0 };
}

export function currentEntry(game: GameState): SceneEntry | null {
  const { sequence } = game.world;
  return sequence.queue[sequence.position] ?? null;
}

export function storyStep(state: StoryState, game: GameState): void {
  let entry = currentEntry(game);
  if (!entry) {
    if (!wipeDone(game)) return;
    startSequence(state, game);
    entry = currentEntry(game);
    if (!entry) return;
  }
  animateIsland(game.island, false);
  if (state.started || isAtSpot(game.walk, entry.spotStart, entry.hdgStart)) {
    if (entry.ads === IDLE_ENTRY) idleStep(state, game, entry);
    else playStep(state, game, entry);
  } else {
    walkStep(game.walk);
  }
  drawHoliday(game.island, false);
  if (game.world.memory.dayScene === entry) {
    game.ttm.device.playSound(DAY_SCENE_SOUND);
    game.world.memory.dayScene = null;
  }
  game.display.restorePass(0);
}

export function isAtSpot(walk: Walk, spot: number, heading: number): boolean {
  if (spot !== ANY_SPOT) walk.targetSpot = spot;
  if (heading !== NO_HEADING) walk.targetHeading = heading;
  const { sequence } = walk.island.world;
  return (spot === ANY_SPOT || sequence.spot === spot) && (heading === NO_HEADING || sequence.heading === heading);
}

export function finishEntry(state: StoryState, world: StoryWorld, entry: SceneEntry, scene: boolean): void {
  const { sequence } = world;
  sequence.spot = entry.spotEnd;
  sequence.heading = entry.hdgEnd;
  state.started = false;
  sequence.position++;
  if (!scene) return;
  if (sequence.spot === ANY_SPOT) sequence.spot = (world.random.next() % SPOTS) + 1;
  if (sequence.heading === 0) sequence.heading = world.random.next() & (HEADINGS - 1);
}

function wipeDone(game: GameState): boolean {
  if (!game.fadeState) {
    game.fadeState = nextFadeState();
    return false;
  }
  game.fadeState.step++;
  if (!fadeDone(game.fadeState)) return false;
  game.fadeState = null;
  return true;
}

function startSequence(state: StoryState, game: GameState): void {
  const { world } = game;
  state.ads = null;
  state.started = false;
  const clock = wallClockOf(game.clock());
  world.memory.newSequence = true;
  if (state.debugAds) debugSequence(state, world, clock);
  else newSequence(world, clock);
  saveSettings(game.settings, world, game.island.settings);
  drawIsland(game.island);
  setTtmOffset(game, false);
}

function debugSequence(state: StoryState, world: StoryWorld, clock: WallClock): void {
  const { sequence } = world;
  const entries = SCENES.filter((entry) => ADS_FILES.get(entry.ads) === state.debugAds);
  const entry = entries[state.debugNext++ % Math.max(entries.length, 1)];
  sequence.slot = timeSlot(clock, world.startTime);
  sequence.holiday = holidayOf(clock);
  sequence.position = 0;
  sequence.queue = entry ? [entry] : [];
  resetIslandFlags(world.island);
  if (!entry) return;
  applySceneFlags(world.island, entry);
  sequence.spot = entry.spotStart;
  sequence.heading = entry.hdgStart;
}

function setTtmOffset(game: GameState, left: boolean): void {
  const offset = ttmOffset(game.island, left);
  game.ttm.islandX = offset.x;
  game.ttm.islandY = offset.y;
}

function loadAdsById(state: StoryState, game: GameState, id: number): AdsState | null {
  if (id !== state.adsId) {
    state.ads = null;
    state.adsId = id;
  }
  if (state.ads) return state.ads;
  const name = ADS_FILES.get(id);
  const resource = name ? game.archive.byName.get(name) : undefined;
  if (!resource) return null;
  state.ads = makeAdsState(decodeAds(resource.payload), game.archive, () => game.random.next());
  return state.ads;
}

function playStep(state: StoryState, game: GameState, entry: SceneEntry): void {
  if (!state.started) {
    state.started = true;
    const ads = loadAdsById(state, game, entry.ads);
    if (ads) adsStartSection(ads, entry.tag);
    setTtmOffset(game, (entry.flags & SCENE_TTM_LEFT) !== 0);
  }
  if (state.ads) adsTick(state.ads, game.ttm, game.palette, game.timers.now);
  if (!state.ads || !adsSectionBusy(state.ads, entry.tag)) finishEntry(state, game.world, entry, true);
}

function idleStep(state: StoryState, game: GameState, entry: SceneEntry): void {
  if (!state.started) {
    state.started = true;
    game.timers.idleWait = (game.random.next() % IDLE_WAIT_SPREAD) + IDLE_WAIT_BASE;
    walkReset(game.walk);
  }
  walkStep(game.walk);
  if (game.timers.idleWait === 0) finishEntry(state, game.world, entry, false);
}
