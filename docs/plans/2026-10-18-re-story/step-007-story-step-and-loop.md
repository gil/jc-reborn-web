# Step 7: Story Step and Main Loop

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-003-story-port.md`, `step-006-island-port.md`

**Files:**

- Create: `src/story/settings.ts`, `src/story/settings.test.ts`, `src/story/story.test.ts`, `src/story/story.data.test.ts`, `src/engine/clock.test.ts`
- Rewrite: `src/story/story.ts`, `src/engine/clock.ts`, `src/main.ts`
- Modify: `src/walk/walk.ts` (`walkTick` takes elapsed clock ticks; new `walkHold`), `src/walk/walk.data.test.ts`, `src/ads/tick.data.test.ts` (scene list from `SCENES`)
- Delete: `src/story/story-data.ts`, `src/island/legacy-island.ts`
- Modify: `docs/re/story.md` (checklist), `docs/re/open-questions.md`

**Interfaces:**

- Consumes: `docs/re/story.md` (`Story step`, `ADS by id`, `Timing`, `Settings`, `Startup and shutdown`); from step 3: `SCENES`, `ADS_FILES`, `IDLE_ENTRY`, `SCENE_TTM_LEFT`, `SceneEntry`, `StoryRandom`, `seedRandom`, `makeStoryWorld`, `newSequence(world, clock)`, `resetIslandFlags`, `applySceneFlags`, `StoryWorld` (`sequence { queue; position; slot; holiday; spot; heading }`, `memory.dayScene`, `memory.newSequence`, `days`, `startTime`, `random`), `timeSlot`, `holidayOf`, `wallClockOf`, `WallClock`; from step 6: `Timers`, `makeTimers`, `clockTick`, `Island`, `IslandSettings`, `makeIsland`, `drawIsland`, `animateIsland`, `drawHoliday`, `ttmOffset`, `drawIntro`, `DisplayIslandDevice`; earlier: `makeAdsState`, `adsStartSection`, `adsTick`, `adsSectionBusy`, `adsActiveNodeCount`, `decodeAds`, `GdiDevice`, `makeTtmEnv`, `TtmEnv`, `Display`, `FadeState`, `nextFadeState`, `fadeDone`, `applyFade`, `presentSurface`, `startLoop`, `startWalk`, `walkDraw`, `walkAnimate`, `WalkContext`.
- Produces: `src/story/story.ts`: `interface GameState { archive; display; ttm; palette; random; timers; world; island; settings; fadeState; clock: () => Date }`, `interface StoryState { started; target: { spot; heading }; adsId; ads: AdsState | null; walk: WalkContext | null; debugAds: string | null; debugNext: number }`, `makeStoryState(debugAds?)`, `storyStep(state, game, elapsedTicks)`, `currentEntry(game): SceneEntry | null`, `isAtSpot(state, world, spot, heading): boolean`, `finishEntry(state, world, entry, scene: boolean)`. `src/story/settings.ts`: `SettingsStore { read(): string | null; write(text: string): void }`, `localSettingsStore()`, `loadSettings(store, world, island)`, `saveSettings(store, world, island)`. `src/engine/clock.ts`: `STEP_MS = 50`, `CLOCK_MS = 16`, `class EngineClock` (`ticksDue(now): number`, `stepDue(now): boolean`, `resume(now)`). `src/walk/walk.ts`: `walkTick(walk, display, elapsed)`, `walkHold(walk, display)`.

This step wires the ports into the engine and deletes what the original does not do: the phase machine, the 8000-tick watchdog (OQ-1), the five-transition chain per tick, the picker fallback (OQ-6), the `jc_story_day` storage, `Math.random`, and the single 20 ms tick.

## Part A: Settings

- [ ] **Action 1: Write the failing tests**

Create `src/story/settings.test.ts`:

```ts
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
```

Run: `pnpm exec vitest run src/story/settings.test.ts`
Expected: FAIL, cannot resolve `./settings.js`.

- [ ] **Action 2: Write `src/story/settings.ts`**

```ts
import type { IslandSettings } from '../island/island.js';
import type { StoryWorld } from './sequence.js';

export interface SettingsStore {
  read(): string | null;
  write(text: string): void;
}

interface IniValues {
  Background: number;
  Clouds: number;
  Waves: number;
  NumDays: number;
  Introduction: number;
  CurrentYear: number;
  CurrentMonth: number;
  CurrentDay: number;
  StartTime: number;
}

const STORAGE_KEY = 'SCRANTIC.INI';
const DEFAULTS: IniValues = {
  Background: 1, Clouds: 1, Waves: 1, NumDays: 0, Introduction: 0, CurrentYear: 0, CurrentMonth: 0, CurrentDay: 0, StartTime: 900,
};

const int8 = (value: number) => (value << 24) >> 24;
const int16 = (value: number) => (value << 16) >> 16;

export function localSettingsStore(): SettingsStore {
  return {
    read: () => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    },
    write: (text) => {
      try {
        localStorage.setItem(STORAGE_KEY, text);
      } catch {
        return;
      }
    },
  };
}

function parse(text: string | null): Partial<IniValues> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Partial<IniValues>) : {};
  } catch {
    return {};
  }
}

export function loadSettings(store: SettingsStore, world: StoryWorld, island: IslandSettings): void {
  const values = { ...DEFAULTS, ...parse(store.read()) };
  island.background = values.Background !== 0;
  island.clouds = values.Clouds !== 0;
  island.waves = values.Waves !== 0;
  world.days = {
    numDays: int8(values.NumDays),
    introduction: int8(values.Introduction),
    year: int16(values.CurrentYear),
    month: int16(values.CurrentMonth),
    day: int16(values.CurrentDay),
  };
  world.startTime = int16(values.StartTime);
}

export function saveSettings(store: SettingsStore, world: StoryWorld, island: IslandSettings): void {
  const values: IniValues = {
    Background: Number(island.background),
    Clouds: Number(island.clouds),
    Waves: Number(island.waves),
    NumDays: world.days.numDays,
    Introduction: world.days.introduction,
    CurrentYear: world.days.year,
    CurrentMonth: world.days.month,
    CurrentDay: world.days.day,
    StartTime: world.startTime,
  };
  store.write(JSON.stringify(values));
}
```

`Sounds` and `Password` are left out: the browser has its own sound toggle, and there is no password (OQ-35). If `docs/re/story.md` (`Settings`) gives a different default or byte size, follow it.

Run: `pnpm exec vitest run src/story/settings.test.ts`
Expected: PASS.

- [ ] **Action 3: Commit**

```bash
git add src/story/settings.ts src/story/settings.test.ts
git commit -m "feat(story): SCRANTIC.INI settings in local storage"
```

## Part B: Engine clock

- [ ] **Action 4: Write the failing test**

Create `src/engine/clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLOCK_MS, EngineClock, STEP_MS } from './clock.js';

describe('engine clock', () => {
  it('ticks the clock every 16 ms and catches up missed ticks', () => {
    // SCRANTIC 1040:076a 1040:07e6 1040:089a 1008:143c
    const clock = new EngineClock(0);
    expect(clock.ticksDue(CLOCK_MS - 1)).toBe(0);
    expect(clock.ticksDue(CLOCK_MS)).toBe(1);
    expect(clock.ticksDue(10 * CLOCK_MS)).toBe(9);
  });

  it('runs at most one story step per 50 ms period, however late', () => {
    // SCRANTIC 1008:0fcd
    const clock = new EngineClock(0);
    expect(clock.stepDue(STEP_MS - 1)).toBe(false);
    expect(clock.stepDue(STEP_MS)).toBe(true);
    expect(clock.stepDue(STEP_MS)).toBe(false);
    expect(clock.stepDue(10 * STEP_MS)).toBe(true);
    expect(clock.stepDue(10 * STEP_MS + 1)).toBe(false);
    expect(clock.stepDue(11 * STEP_MS)).toBe(true);
  });

  it('skips the time a hidden page was paused', () => {
    // SCRANTIC 1040:089a
    const clock = new EngineClock(0);
    clock.resume(100_000);
    expect(clock.ticksDue(100_000 + CLOCK_MS)).toBe(1);
  });
});
```

Run: `pnpm exec vitest run src/engine/clock.test.ts`
Expected: FAIL (`EngineClock` is not exported).

- [ ] **Action 5: Rewrite `src/engine/clock.ts`**

```ts
export const STEP_MS = 50;
export const CLOCK_MS = 16;

export class EngineClock {
  private nextTick: number;
  private nextStep: number;

  constructor(now: number) {
    this.nextTick = now + CLOCK_MS;
    this.nextStep = now + STEP_MS;
  }

  ticksDue(now: number): number {
    let ticks = 0;
    for (; this.nextTick <= now; this.nextTick += CLOCK_MS) ticks++;
    return ticks;
  }

  stepDue(now: number): boolean {
    if (now < this.nextStep) return false;
    while (this.nextStep <= now) this.nextStep += STEP_MS;
    return true;
  }

  resume(now: number): void {
    this.nextTick = now + CLOCK_MS;
    this.nextStep = now + STEP_MS;
  }
}
```

Run: `pnpm exec vitest run src/engine/clock.test.ts`
Expected: PASS. (`src/main.ts` stops compiling until Part E; do not run `tsc` yet.)

## Part C: Walk bridge

- [ ] **Action 6: Change `src/walk/walk.ts`**

Replace `walkTick` and add `walkHold`:

```ts
export function walkTick(walk: WalkContext, display: Display, elapsed: number): void {
  if (walk.done) return;
  walk.timer -= elapsed;
  if (walk.timer <= 0) {
    walk.timer = walkAnimate(walk.ws);
    walk.done = walk.timer === 0;
  }
  // Drawn on the tick the walk ends too: the story waits out the arrival rest with Johnny on screen.
  walkDraw(walk.ws, display, walk.sprites, walk.bgSprites, walk.dx, walk.dy);
}

export function walkHold(walk: WalkContext, display: Display): void {
  if (!walk.ws.hasArrived) walkAnimate(walk.ws);
  walkDraw(walk.ws, display, walk.sprites, walk.bgSprites, walk.dx, walk.dy);
}
```

In `src/walk/walk.data.test.ts`, change `walkTick(walk, display);` to `walkTick(walk, display, 1);`.

The walk timers (6 per frame, 80 at arrival) now count 16 ms clock ticks instead of 20 ms engine ticks. That is chunk 8's to check; log it in OQ-25 (Action 14).

## Part D: The story step

- [ ] **Action 7: Write the failing tests**

Create `src/story/story.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { StoryRandom } from './random.js';
import { SCENES } from './scene-table.js';
import { makeStoryWorld } from './sequence.js';
import { finishEntry, isAtSpot, makeStoryState } from './story.js';

describe('story step pieces', () => {
  it('stores the walk target and says whether Johnny is already there', () => {
    // SCRANTIC 1018:0b46
    const state = makeStoryState();
    const world = makeStoryWorld(new StoryRandom());
    world.sequence.spot = 3;
    world.sequence.heading = 5;
    expect(isAtSpot(state, world, 3, 5)).toBe(true);
    expect(isAtSpot(state, world, 4, 5)).toBe(false);
    expect(state.target).toEqual({ spot: 4, heading: 5 });
    expect(isAtSpot(state, world, 0, 5)).toBe(true);
    expect(state.target).toEqual({ spot: 4, heading: 5 });
    expect(isAtSpot(state, world, 0, 6)).toBe(false);
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
```

Create `src/story/story.data.test.ts`:

```ts
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
import { StoryRandom } from './random.js';
import { ADS_FILES, SCENES } from './scene-table.js';
import { makeStoryWorld } from './sequence.js';
import { currentEntry, makeStoryState, storyStep, type GameState, type StoryState } from './story.js';

const STEP_LIMIT = 20_000;
const TICKS_PER_STEP = 3;

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
  const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => random.next() });
  let saved: string | null = null;
  return {
    archive, display, ttm: makeTtmEnv(device, draw), palette: makePalette(), random, timers, world, island,
    settings: { read: () => saved, write: (text) => { saved = text; } },
    fadeState: null,
    clock: () => new Date(1992, 5, 1, 10, 0),
  };
}

function step(story: StoryState, game: GameState): void {
  for (let i = 0; i < TICKS_PER_STEP; i++) clockTick(game.timers);
  storyStep(story, game, TICKS_PER_STEP);
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
```

Run: `pnpm exec vitest run src/story/story.test.ts`
Expected: FAIL (`makeStoryState` is not exported).

- [ ] **Action 8: Rewrite `src/story/story.ts`**

```ts
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
import { startWalk, walkHold, walkTick, type WalkContext } from '../walk/walk.js';
import { holidayOf, timeSlot, wallClockOf, type WallClock } from './calendar.js';
import type { StoryRandom } from './random.js';
import { ADS_FILES, IDLE_ENTRY, SCENE_TTM_LEFT, SCENES, type SceneEntry } from './scene-table.js';
import { applySceneFlags, newSequence, resetIslandFlags, type StoryWorld } from './sequence.js';
import { saveSettings, type SettingsStore } from './settings.js';

const ANY_SPOT = 0;
const ANY_HEADING = -1;
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
  settings: SettingsStore;
  fadeState: FadeState | null;
  clock: () => Date;
}

export interface StoryState {
  started: boolean;
  target: { spot: number; heading: number };
  adsId: number;
  ads: AdsState | null;
  walk: WalkContext | null;
  debugAds: string | null;
  debugNext: number;
}

export function makeStoryState(debugAds: string | null = null): StoryState {
  return { started: false, target: { spot: ANY_SPOT, heading: ANY_HEADING }, adsId: 0, ads: null, walk: null, debugAds, debugNext: 0 };
}

export function currentEntry(game: GameState): SceneEntry | null {
  const { sequence } = game.world;
  return sequence.queue[sequence.position] ?? null;
}

export function storyStep(state: StoryState, game: GameState, elapsed: number): void {
  let entry = currentEntry(game);
  if (!entry) {
    if (!wipeDone(game)) return;
    startSequence(state, game);
    entry = currentEntry(game);
    if (!entry) return;
  }
  animateIsland(game.island, false);
  if (state.started || isAtSpot(state, game.world, entry.spotStart, entry.hdgStart)) {
    if (entry.ads === IDLE_ENTRY) idleStep(state, game, entry);
    else playStep(state, game, entry);
  } else {
    walkStep(state, game, elapsed);
  }
  drawHoliday(game.island, false);
  if (game.world.memory.dayScene === entry) {
    game.ttm.device.playSound(DAY_SCENE_SOUND);
    game.world.memory.dayScene = null;
  }
  game.display.restorePass(0);
}

export function isAtSpot(state: StoryState, world: StoryWorld, spot: number, heading: number): boolean {
  if (spot !== ANY_SPOT) state.target.spot = spot;
  if (heading !== ANY_HEADING) state.target.heading = heading;
  const { sequence } = world;
  return (spot === ANY_SPOT || sequence.spot === spot) && (heading === ANY_HEADING || sequence.heading === heading);
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
  state.walk = null;
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
    state.walk = null;
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
    state.walk = null;
  }
  holdJohnny(state, game);
  if (game.timers.idleWait === 0) finishEntry(state, game.world, entry, false);
}

function newWalk(game: GameState, toSpot: number, toHeading: number): WalkContext | null {
  const { sequence } = game.world;
  const { island } = game;
  return startWalk(game.archive, island.background?.images ?? [], sequence.spot - 1, sequence.heading, toSpot - 1, toHeading, island.x + 1, island.y);
}

function walkStep(state: StoryState, game: GameState, elapsed: number): void {
  const { sequence } = game.world;
  const toSpot = state.target.spot === ANY_SPOT ? sequence.spot : state.target.spot;
  const toHeading = state.target.heading === ANY_HEADING ? sequence.heading : state.target.heading;
  if (sequence.spot !== ANY_SPOT) state.walk ??= newWalk(game, toSpot, toHeading);
  if (state.walk) walkTick(state.walk, game.display, elapsed);
  if (state.walk && !state.walk.done) return;
  sequence.spot = toSpot;
  sequence.heading = toHeading;
  state.walk = null;
}

function holdJohnny(state: StoryState, game: GameState): void {
  const { sequence } = game.world;
  if (sequence.spot === ANY_SPOT) return;
  state.walk ??= newWalk(game, sequence.spot, sequence.heading);
  if (state.walk) walkHold(state.walk, game.display);
}
```

Check against `docs/re/story.md` (`Story step`) before trusting it:

- the order of the end-of-entry random draws (spot, then heading), and that idle entries draw none;
- the idle wait draw (`rand % 240 + 180`) comes after the pending bit is cleared, before `1018:0074`;
- the sound-25 test compares the entry read at the start of the step;
- if `story.md` found a writer of `1068:334a` (pause) or `1068:1dbc == 2` (forced new sequence), port it at the top of `storyStep`; if not, leave it out and say why in the checklist row of `1018:06bf`.

`walkStep`, `holdJohnny`, and `newWalk` are the walk bridge: everything about how Johnny walks and stands is chunk 8's (`1018:0074`, `1018:0094`), and OQ-25 lists each made-up part (Action 14).

Run: `pnpm exec vitest run src/story/story.test.ts`
Expected: PASS.

## Part E: Main loop and clean-up

- [ ] **Action 9: Rewrite `src/main.ts`**

```ts
import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { makePalette, setPaletteColors } from './gfx/palette.js';
import { Display } from './gfx/gdi/display.js';
import { makeDrawState } from './gfx/gdi/surface.js';
import { applyFade } from './gfx/fade.js';
import { presentSurface } from './gfx/present.js';
import { adsActiveNodeCount } from './ads/tick.js';
import { startLoop } from './engine/loop.js';
import { EngineClock } from './engine/clock.js';
import { clockTick, makeTimers } from './engine/timers.js';
import { DisplayIslandDevice } from './island/island-device.js';
import { drawIntro, drawIsland, makeIsland } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import { GdiDevice } from './ttm/gdi-device.js';
import { makeTtmEnv } from './ttm/page-runner.js';
import { seedRandom, StoryRandom } from './story/random.js';
import { ADS_FILES } from './story/scene-table.js';
import { makeStoryWorld } from './story/sequence.js';
import { loadSettings, localSettingsStore } from './story/settings.js';
import { currentEntry, makeStoryState, storyStep, type GameState } from './story/story.js';
import { initSound, playSample } from './audio/sound.js';
import { initSoundIcon } from './ui/sound-icon.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initCrt } from './ui/crt.js';
import { initHud, hudUpdate } from './debug/hud.js';

const INTRO_HOLD_MS = 2000;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const controls = initSoundIcon(canvas);
initFullscreen(canvas, controls);
initCrt(canvas, controls);
initHud();
initSound(); // fire-and-forget: pre-fetches WAV bytes; AudioContext created on first icon click

const { map: mapBuf, archive: arcBuf } = await fetchData();
const archive = indexArchive(parseMap(mapBuf), arcBuf);

const pal = makePalette();
setPaletteColors(pal, decodePal(archive.list.find((r) => r.type === '.PAL')!.payload).colors);

const display = new Display();
display.screenIsB = true;
const draw = makeDrawState();
const random = new StoryRandom();
seedRandom(random, Math.floor(Date.now() / 1000));
const device = new GdiDevice(display, draw, archive, { playSound: playSample, random: () => random.next() });

const world = makeStoryWorld(random);
const timers = makeTimers();
const islandDevice = new DisplayIslandDevice(display, archive);
const island = makeIsland(islandDevice, world, timers, { background: true, clouds: true, waves: true });
const settings = localSettingsStore();
loadSettings(settings, world, island.settings);

const params = new URLSearchParams(location.search);
const skipIntro = params.get('skipIntro') === 'true';
if (!skipIntro) drawIntro(islandDevice);
drawIsland(island);

const game: GameState = {
  archive, display, ttm: makeTtmEnv(device, draw), palette: pal, random, timers, world, island, settings,
  fadeState: null,
  clock: () => new Date(),
};
const story = makeStoryState(params.get('ads'));

const img = ctx.createImageData(SCREEN_W, SCREEN_H);
const engineClock = new EngineClock(performance.now());
const firstStepAt = performance.now() + (skipIntro ? 0 : INTRO_HOLD_MS);
let ticksSinceStep = 0;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) engineClock.resume(performance.now());
});

startLoop(
  () => {
    const now = performance.now();
    for (let ticks = engineClock.ticksDue(now); ticks > 0; ticks--) {
      clockTick(timers);
      ticksSinceStep++;
    }
    if (!engineClock.stepDue(now) || now < firstStepAt) return;
    storyStep(story, game, ticksSinceStep);
    ticksSinceStep = 0;
  },
  () => {
    presentSurface(img.data, display.window, pal);
    if (game.fadeState) applyFade(img.data, game.fadeState);
    ctx.putImageData(img, 0, 0);
    const entry = currentEntry(game);
    hudUpdate(story.ads ? adsActiveNodeCount(story.ads) : 0, entry ? (ADS_FILES.get(entry.ads) ?? 'idle') : '-');
  },
);
```

The startup order follows `1008:143c`: intro into B and onto the window, the random seed (`1018:1ed4`), the first `1010:0136` (loads only). The 2 s hold before the first step is OQ-32.

- [ ] **Action 10: Update the ADS data test and delete the old files**

In `src/ads/tick.data.test.ts`, replace the import `import { storyScenes } from '../story/story-data.js';` with `import { ADS_FILES, SCENES } from '../story/scene-table.js';`, and replace the whole second `describe` block with:

```ts
describe.skipIf(!hasCorpus)('ADS tick on the display', () => {
  it('plays some page in the first 100 ticks of every scene table entry', { timeout: 120_000 }, () => {
    // SCRANTIC 1048:0874 1048:1acb 1060:03d3
    const archive = loadArchive();
    const scenes = new Set(SCENES.filter((entry) => ADS_FILES.has(entry.ads)).map((entry) => `${ADS_FILES.get(entry.ads)} ${entry.tag}`));
    for (const key of scenes) {
      const [adsName, tag] = key.split(' ') as [string, string];
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const random = () => 0x1234;
      const env = makeTtmEnv(new GdiDevice(display, draw, archive, { playSound: () => {}, random }), draw);
      const state = makeAdsState(decodeAds(archive.byName.get(adsName)!.payload), archive, random);
      adsStartSection(state, Number(tag));
      let ran = false;
      for (let now = 1; now <= 100; now++) {
        if (adsTick(state, env, makePalette(), now)) ran = true;
        display.restorePass(0);
      }
      expect(ran, key).toBe(true);
    }
  });
});
```

Run: `git rm src/story/story-data.ts src/island/legacy-island.ts`

Run: `rg -n "story-data|legacy-island|storyScenes|islandRt|pumpMs|msPerTick|playingTicks|WATCHDOG|jc_story" src`
Expected: no output.

- [ ] **Action 11: Type check and run every test**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass. `src/story/story.data.test.ts` is slow (minutes). If its second test reports a stuck entry, find that section in `docs/re/ads.md` (`Emulated`): a section that the original also never ends with its random picks is a finding for OQ-1, not a bug; one the original ends is a bug in the bridge or the step. Do not add a time limit.

- [ ] **Action 12: Commit**

```bash
git add src docs
git commit -m "feat(story): port the story step and main loop; delete the phase machine and watchdog"
```

## Part F: Findings and open questions

- [ ] **Action 13: Update the checklist**

In `docs/re/story.md`, `Side-by-side checklist` (line numbers from `rg -n "^export function|^function|^export class" src/story/story.ts src/story/settings.ts src/engine/clock.ts src/engine/timers.ts src/main.ts src/island/island.ts`):

| Original | Ours | Status |
| --- | --- | --- |
| `1008:0c5c` | `src/story/settings.ts:<line>` `loadSettings` | fixed |
| `1008:0dc8` | `src/story/settings.ts:<line>` `saveSettings` (after each new sequence, OQ-33) | fixed |
| `1008:0fcd` | `src/main.ts` loop and `src/engine/clock.ts:<line>` `EngineClock.stepDue` | fixed |
| `1008:143c` | `src/main.ts` startup, `src/island/island.ts:<line>` `drawIntro` | fixed |
| `1008:157b` | `none (nothing to free in JavaScript)` | match |
| `1008:15c8` | `src/main.ts` loop (one `storyStep` per step); `1068:30bc` is never set, `Island.speed` stays 0 | fixed |
| `1008:16c2` | `src/engine/timers.ts:<line>` `clockTick` | fixed |
| `1040:076a`, `1040:07e6`, `1040:089a` | `src/engine/clock.ts:<line>` `EngineClock` (16 ms, catch-up, resume) | fixed |
| `1040:079e`, `1040:085a` | `none (no timer is ever removed while running)` | match |
| `1018:0540` | `src/story/story.ts:<line>` `startSequence` + `src/story/sequence.ts` `newSequence` | fixed |
| `1018:0673` | `src/story/story.ts:<line>` `wipeDone` + `startSequence` (`state.ads = null`) | fixed |
| `1018:06bf` | `src/story/story.ts:<line>` `storyStep` | fixed |
| `1018:0b46` | `src/story/story.ts:<line>` `isAtSpot` | fixed |
| `1018:0c62` | `src/story/story.ts:<line>` `loadAdsById` | fixed |
| `1018:0d11` | `src/story/story.ts` `loadAdsById` / `startSequence` (drop the cached state) | fixed |
| `1020:00ba` | `src/story/story.ts` `storyStep` (`playSound(25)`); playback out of scope | match |

Check that every row of the checklist now has a status other than `open`, or an open-questions entry naming its address.

- [ ] **Action 14: Update the open questions**

In `docs/re/open-questions.md`:

- Move OQ-1 to `Resolved`: `**Resolution:** 1018:06bf has no time limit; an entry ends when 1048:0766 says its section is idle, or when an idle entry's wait (1068:334c) runs out. The watchdog is deleted. src/story/story.data.test.ts plays every scene table entry of every ADS file to its end with the ported random generator.` Add what Action 11 saw (for example how long `ACTIVITY.ADS` tag 6 ran). `**Status:** resolved (chunk 7)`.
- OQ-21: replace `Status: open` with `**Resolution:** kept by choice (user, 2026-10-18): a wipe takes WIPE_TICKS = 16 story steps, 0.8 s at the original's 50 ms step; the story does nothing else meanwhile, as 1020:0364 blocks 1018:0540.` and `**Status:** resolved (chunk 7), by choice`. Move it to `Not reviewed on purpose`.
- Move OQ-26 to `Resolved`: one `StoryRandom` (`1018:1e60`) seeded by dropping `time() & 0xffff` numbers (`1018:1ed4`) serves the story, the island, ADS random blocks (`makeAdsState`), and TTM `0x2022` (`GdiDevice`); pinned against the original in `src/story/random.data.test.ts`.
- Move OQ-28 to `Resolved`: `storyStep` follows `1018:06bf` (island step, walk or entry, holiday redraw, sound 25, restore pass); clock ticks run between steps.
- Move OQ-29 to `Resolved`: a story step every 50 ms (`1008:0fcd` `SetTimer`), at most one per period; the clock and its countdowns every 16 ms (`1040:076a(13)`, `1040:07e6(.., 4)`, `1008:16c2`), caught up after a slow frame (`EngineClock`).
- Move OQ-30 to `Resolved`: `loadAdsById` keeps the ADS state while consecutive entries use the same id, and every new sequence drops it (`1018:0c62`, `1018:0673`).
- Update OQ-25 (keep it open, **Resolve in:** chunk 8): add that the story now calls the walk through a bridge in `src/story/story.ts` (`walkStep`, `holdJohnny`, `newWalk`): spots 1..6 become 0..5; a target spot or heading of "any" means the current one; with Johnny at spot 0 he is moved without walking; idle entries draw his standing frame each step (`walkHold`); the walk offset is the island offset plus one (`1018:0094` draws at the island offset plus the frame's x, and `walkDraw` subtracts one); the walk timers (6, 80) now count 16 ms clock ticks; the 80-tick arrival rest is jc_reborn's and has no counterpart in `1018:06bf`.
- Add under `Not reviewed on purpose`, after OQ-35:

```markdown
### OQ-32: The intro is held 2 s before the first story step

- **Where:** `src/main.ts` (`INTRO_HOLD_MS`)
- **What it does:** shows `INTRO.SCR` for 2 s before the first step, which starts the first wipe.
- **Original:** `1008:143c` draws `INTRO.SCR` and the first `WM_TIMER`, 50 ms later, runs `1018:0540`, which wipes at once. On a 1991 PC the loading around it kept the intro on screen for a while.
- **Why not reviewed:** user's choice (2026-10-18): in a browser the original timing makes the intro a flash.
- **Status:** open, by choice

### OQ-33: Settings are saved after each new sequence

- **Where:** `src/story/story.ts` (`startSequence`), `src/story/settings.ts`
- **What it does:** writes the `SCRANTIC.INI` values to local storage every time a sequence starts.
- **Original:** `1008:0dc8` writes them once, on `WM_DESTROY`.
- **Why not reviewed:** a browser tab can close without warning; the values only change in `1018:0b87`, which runs at the start of a sequence, so saving there loses nothing.
- **Status:** open, by choice

### OQ-36: The clock ticks evenly every 16 ms

- **Where:** `src/engine/clock.ts`
- **What it does:** one clock tick per 16 ms of real time, one story step per 50 ms.
- **Original:** `1040:089a` compares slot times with `GetCurrentTime`, which on Windows 3.x moves in 55 ms jumps, so the 16 ms callback fired three or four times in a burst; `WM_TIMER` came at the same 55 ms granularity. The average rates match ours.
- **Why not reviewed:** the bursts depend on the PC's timer chip, not on `SCRANTIC.SCR`.
- **Status:** open, by choice
```

- [ ] **Action 15: Commit**

```bash
git add docs/re/story.md docs/re/open-questions.md
git commit -m "docs(re): story step and main loop checked against the original"
```

## Part G: Browser check

- [ ] **Action 16: Smoke test in the browser**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open these and report what they see:

- `/`: the intro for 2 s, a wipe, then the island (ocean or night screen by the time of day, the raft, maybe clouds); Johnny walks to a spot and scenes play; scenes end on their own; after a few minutes a new sequence starts with a wipe. Compared with before: different scene order and timing, island position and clouds now from the original.
- `/?ads=STAND.ADS` and `/?ads=JOHNNY.ADS` (from `/debug.html`, "send"): one entry per sequence, each followed by a wipe.
- `/debug.html`: still works as before.
- Reload the page: the day counters persist (`localStorage` key `SCRANTIC.INI`).

You cannot see the canvas yourself; do not mark this action done without their answer. Anything wrong goes into the matching open question, or is fixed if it is a crash, a blank screen, or a scene that never ends.

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

- [ ] **Action 17: Commit any fixes**

If the browser check led to changes:

```bash
git add src docs
git commit -m "fix(story): <what the browser check found>"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
