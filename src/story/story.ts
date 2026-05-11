import { decodeAds } from '../decode/ads-loader.js';
import { makeAdsState, adsPlayWalk, adsActiveThreadCount, type AdsState } from '../ads/scheduler.js';
import { islandInit, islandInitHoliday, islandAnimate, type IslandRuntime, type IslandState } from '../island/island.js';
import type { TtmContext } from '../ttm/interpreter.js';
import type { ParsedArchive } from '../resource/types.js';
import type { Layer } from '../types.js';
import { clearSavedZones } from '../gfx/zone.js';
import {
  storyScenes, type StoryScene,
  FINAL, FIRST, ISLAND, LEFT_ISLAND, VARPOS_OK, LOWTIDE_OK, NORAFT, HOLIDAY_NOK,
} from './story-data.js';
import { type FadeState, nextFadeState, fadeDone } from '../gfx/fade.js';

export interface GameState {
  adsState: AdsState;
  islandRt: IslandRuntime;
  islandState: IslandState;
  holidayLayer: Layer | null;
  bgAnimTimer: number;
  background: Uint8Array | null;
  ttmCtx: TtmContext;
  archive: ParsedArchive;
  fadeState: FadeState | null;
}

type StoryPhase =
  | { kind: 'walking' }
  | { kind: 'playing' }
  | { kind: 'fading'; remaining: number }
  | { kind: 'advance' };

export interface StoryState {
  phase: StoryPhase;
  queue: StoryScene[];
  finalScene: StoryScene | null;
  prevSpot: number;
  prevHdg: number;
  currentScene: StoryScene | null;
  currentDay: number;
  debugAds: string | null;
}

function loadCurrentDay(): number {
  try {
    const stored = localStorage.getItem('jc_story_day');
    const storedDate = localStorage.getItem('jc_story_date');
    const today = new Date().toDateString();
    let day = stored ? parseInt(stored, 10) : 1;
    if (storedDate !== today) {
      day = (day % 11) + 1;
      localStorage.setItem('jc_story_day', String(day));
      localStorage.setItem('jc_story_date', today);
    }
    if (day < 1 || day > 11) { day = 1; localStorage.setItem('jc_story_day', '1'); }
    return day;
  } catch { return 1; }
}

function calcIslandDateTime(state: IslandState): IslandState {
  const d = new Date();
  const hour = d.getHours() % 8;
  const night = hour === 0 || hour === 7;

  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const mmdd = mm + dd;

  let holiday = 0;
  if (mmdd > '1028' && mmdd < '1101') holiday = 1;       // Halloween
  else if (mmdd > '0314' && mmdd < '0318') holiday = 2;  // St Patrick
  else if (mmdd > '1222' && mmdd < '1226') holiday = 3;  // Christmas
  else if (mmdd > '1228' || mmdd < '0102') holiday = 4;  // New Year

  return { ...state, night, holiday };
}

function calcIslandFromScene(scene: StoryScene, day: number, base: IslandState): IslandState {
  const lowTide = !!(scene.flags & LOWTIDE_OK) && Math.random() < 0.5;

  let xPos = 0, yPos = 0;
  if (scene.flags & VARPOS_OK) {
    if (Math.random() < 0.5) {
      xPos = -222 + Math.floor(Math.random() * 109);
      yPos = -44  + Math.floor(Math.random() * 128);
    } else if (Math.random() < 0.5) {
      xPos = -114 + Math.floor(Math.random() * 134);
      yPos = -14  + Math.floor(Math.random() * 99);
    } else {
      xPos = -114 + Math.floor(Math.random() * 119);
      yPos = -73  + Math.floor(Math.random() * 60);
    }
  } else if (scene.flags & LEFT_ISLAND) {
    xPos = -272; yPos = 0;
  }

  let raft = 5;
  if (scene.flags & NORAFT) {
    raft = 0;
  } else {
    if (day <= 2) raft = 1;
    else if (day <= 5) raft = day - 1;
    else raft = 5;
  }

  let holiday = base.holiday;
  if (scene.flags & HOLIDAY_NOK) holiday = 0;

  return { ...base, lowTide, xPos, yPos, raft, holiday };
}

function buildSequence(state: StoryState, game: GameState): void {
  state.currentDay = loadCurrentDay();
  const baseIsland = calcIslandDateTime(game.islandState);

  const candidates = state.debugAds
    ? storyScenes.filter(s => s.adsName === state.debugAds)
    : storyScenes;

  const finalScene = pickSceneFrom(candidates, FINAL, 0, state.currentDay);
  state.finalScene = finalScene;

  const queue: StoryScene[] = [];

  if (!(finalScene.flags & FIRST)) {
    const count = 6 + Math.floor(Math.random() * 14);
    let wantedFlags = 0;
    let unwantedFlags = FINAL;

    const newIslandState = (finalScene.flags & ISLAND)
      ? calcIslandFromScene(finalScene, state.currentDay, baseIsland)
      : baseIsland;

    if (newIslandState.lowTide) wantedFlags |= LOWTIDE_OK;
    if (newIslandState.xPos || newIslandState.yPos) wantedFlags |= VARPOS_OK;

    for (let i = 0; i < count; i++) {
      const scene = pickSceneFrom(candidates, wantedFlags, unwantedFlags, state.currentDay);
      queue.push(scene);
      unwantedFlags |= FIRST;
    }
  }

  queue.push(finalScene);
  state.queue = queue;
  state.prevSpot = -1;
  state.prevHdg = -1;
  state.phase = { kind: 'advance' };

  const finalSceneForIsland = state.finalScene!;
  if (finalSceneForIsland.flags & ISLAND) {
    const newIslandState = calcIslandFromScene(finalSceneForIsland, state.currentDay, baseIsland);
    game.islandState = newIslandState;
    game.islandRt = islandInit(game.archive, newIslandState);
    game.holidayLayer = islandInitHoliday(game.archive, newIslandState);
    game.bgAnimTimer = 8;
    game.background = game.islandRt.bgLayer.indexed;
  } else {
    game.background = null;
    game.holidayLayer = null;
  }
}

function pickSceneFrom(list: StoryScene[], wantedFlags: number, unwantedFlags: number, currentDay: number): StoryScene {
  const candidates = list.filter(s =>
    (s.flags & wantedFlags) === wantedFlags &&
    !(s.flags & unwantedFlags) &&
    (s.dayNo === 0 || s.dayNo === currentDay),
  );
  if (!candidates.length) {
    const fallback = list.filter(s =>
      !(s.flags & unwantedFlags) && (s.dayNo === 0 || s.dayNo === currentDay),
    );
    return fallback[Math.floor(Math.random() * fallback.length)]!;
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

function startScene(scene: StoryScene, game: GameState): void {
  console.log(`[STORY] scene ${scene.adsName}[${scene.adsTagNo}] spot${scene.spotStart}→${scene.spotEnd}`);
  const raw = game.archive.byName.get(scene.adsName);
  if (!raw) { console.warn(`ADS not found: ${scene.adsName}`); return; }
  const ads = decodeAds(raw.payload);
  clearSavedZones();
  game.adsState = makeAdsState(ads, game.archive, scene.adsTagNo);

  game.ttmCtx.dx = (scene.flags & ISLAND)
    ? game.islandState.xPos + (scene.flags & LEFT_ISLAND ? 272 : 0)
    : 0;
  game.ttmCtx.dy = (scene.flags & ISLAND) ? game.islandState.yPos : 0;
}

function sceneIsDone(game: GameState): boolean {
  return game.adsState.stopRequested && adsActiveThreadCount(game.adsState) === 0;
}

export function storyInit(_archive: ParsedArchive, game: GameState, debugAds: string | null = null): StoryState {
  const state: StoryState = {
    phase: { kind: 'advance' },
    queue: [],
    finalScene: null,
    prevSpot: -1,
    prevHdg: -1,
    currentScene: null,
    currentDay: 1,
    debugAds,
  };
  buildSequence(state, game);
  return state;
}

export function storyTick(state: StoryState, game: GameState): void {
  switch (state.phase.kind) {
    case 'advance': {
      if (!state.queue.length) {
        state.phase = { kind: 'fading', remaining: 100 };
        game.fadeState = nextFadeState();
        return;
      }
      const scene = state.queue.shift()!;
      state.currentScene = scene;

      if (state.prevSpot !== -1) {
        console.log(`[STORY] → walking spot${state.prevSpot}→${scene.spotStart}`);
        adsPlayWalk(
          game.adsState,
          game.archive,
          game.islandRt.sprites,
          state.prevSpot, state.prevHdg,
          scene.spotStart, scene.hdgStart,
          game.islandState.xPos, game.islandState.yPos,
        );
        state.phase = { kind: 'walking' };
      } else {
        startScene(scene, game);
        state.phase = { kind: 'playing' };
      }
      break;
    }

    case 'walking': {
      const wc = game.adsState.walkCtx;
      if (wc === null || wc.done) {
        // Walk done — clear the walk context, then start the queued scene.
        // adsTick kept the walk layer visible one extra frame (done=true) so
        // startScene can prime new threads before the layer disappears.
        game.adsState.walkCtx = null;
        if (state.currentScene) {
          startScene(state.currentScene, game);
        }
        state.phase = { kind: 'playing' };
      }
      break;
    }

    case 'playing': {
      if (sceneIsDone(game)) {
        const scene = state.currentScene!;
        console.log(`[STORY] → advance (scene done: ${scene.adsName}[${scene.adsTagNo}])`);
        if (!(scene.flags & FINAL)) {
          state.prevSpot = scene.spotEnd;
          state.prevHdg = scene.hdgEnd;
        }
        state.phase = { kind: 'advance' };
      }
      break;
    }

    case 'fading': {
      if (game.fadeState && !fadeDone(game.fadeState)) {
        game.fadeState.step++;
      }
      state.phase.remaining -= 1;
      if (state.phase.remaining <= 0) {
        game.fadeState = null;
        if (state.debugAds) state.prevSpot = -1;
        buildSequence(state, game);
      }
      break;
    }
  }
}

// Island wave animation — call each game tick with elapsed ticks
export function storyAnimateBg(_state: StoryState, game: GameState, elapsed: number): void {
  if (!game.background) return;
  game.bgAnimTimer -= elapsed;
  while (game.bgAnimTimer <= 0) {
    islandAnimate(game.islandRt);
    game.bgAnimTimer += 8;
  }
}
