# Step 4: Walk Port

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-original-walk-trace.md` (`re/fixtures/walk/traces.tsv`), `step-003-walk-tables.md` (`src/walk/walk-tables.ts`)

**Files:**

- Rewrite: `src/walk/walk.ts`, `src/walk/walk.test.ts`, `src/walk/walk.data.test.ts`
- Delete: `src/walk/calcpath.ts`, `src/walk/calcpath-data.ts`, `src/walk/calcpath.test.ts`, `src/walk/walk-data.ts`
- Create: `src/testing/walk-recorder.ts`
- Modify: `src/engine/timers.ts`, `src/engine/timers.test.ts`, `src/story/story.ts`, `src/story/story.test.ts`, `src/story/story.data.test.ts`, `src/main.ts`
- Modify: `docs/re/walk.md` (checklist), `docs/re/story.md` (checklist rows `1008:16c2`, `1018:06bf`, `1018:0b46`), `docs/re/open-questions.md` (OQ-25 resolved, OQ-37)

**Interfaces:**

- Consumes: from `src/walk/walk-tables.ts`: `SEGMENTS: readonly WalkSegment[]` (`{ startHeading, endHeading, spot, frames: readonly WalkFrame[] }`, index = id 0..34), `STANDING_TURNS`, `WALKING_TURNS` (index = spot 0..6), `ROUTES[from - 1][to - 1]: Route | null` (`Route` = six groups of `[segment, percent]`, group `spot - 1`), `MIRRORED_FRAME = 0x8000`, types `WalkFrame = [sprite, x, y]`, `RouteChoice`, `Route`. The rest from the overview's `Shared pieces`; the trace format from the overview's `Trace format`.
- Produces, in `src/walk/walk.ts`:

```ts
export const NO_HEADING = -1;
export interface Walk {
  island: Island;
  sheet: SpriteSheet | null;    // 1068:30d2
  targetSpot: number;           // 30e0
  targetHeading: number;        // 30dc, NO_HEADING = none wanted
  routeFrom: number;            // 30d0 as (from, to); 0 = no route
  routeTo: number;
  segment: number;              // 30ce as (segment, record); 0 = none
  record: number;
  frameSegment: number;         // 30c6 as (segment, record); 0 = none
  frameRecord: number;
  wantedHeading: number;        // 30c8
  segmentHeading: number;       // 30cc
  segmentSpot: number;          // 30ca
}
export function makeWalk(island: Island): Walk;
export function loadWalk(walk: Walk): boolean;                                   // 1018:0000
export function walkReset(walk: Walk): void;                                     // 1018:0074
export function walkStep(walk: Walk): void;                                      // 1018:0094
export function routeOf(from: number, to: number): Route | null;                // 1018:03ac
export function segmentFrames(id: number): readonly WalkFrame[] | null;         // 1018:03ea
export function pickSegment(choices: readonly RouteChoice[], value: number): number;
```

  `Timers` gains `walk: number` (`1068:30d4`). `GameState` gains `walk: Walk`; `StoryState` loses `target` and `walk`; `isAtSpot(walk: Walk, spot, heading)`; `storyStep(state, game)` (no `elapsed`). `src/testing/walk-recorder.ts`: `WALK_CASES = 36`, `traceWalkCase(archive, k): string[]`.

Johnny's spot and heading stay in `world.sequence.spot` / `heading` (`1068:30e2` / `30de`), which the story already writes. Where `docs/re/walk.md` says something the code below does not do, follow `walk.md` and say so in the commit message.

## Part A: The clock counts the walk delay down

- [ ] **Action 1: Write the failing test**

In `src/engine/timers.test.ts`, replace the first test:

```ts
  it('adds 1 to the clock and counts every non-zero timer down', () => {
    // SCRANTIC 1008:16c2
    const timers = { ...makeTimers(), walk: 4, idleWait: 2, surf: 1, waves: 0 };
    clockTick(timers);
    expect(timers).toEqual({ now: 1, walk: 3, idleWait: 1, surf: 0, waves: 0 });
  });
```

Run: `pnpm test src/engine/timers.test.ts`
Expected: FAIL (`walk` stays 4).

- [ ] **Action 2: Add the timer**

`src/engine/timers.ts`:

```ts
export interface Timers {
  now: number;
  walk: number;
  idleWait: number;
  surf: number;
  waves: number;
}

export function makeTimers(): Timers {
  return { now: 0, walk: 0, idleWait: 0, surf: 0, waves: 0 };
}

export function clockTick(timers: Timers): void {
  timers.now = (timers.now + 1) >>> 0;
  if (timers.walk !== 0) timers.walk--;
  if (timers.idleWait !== 0) timers.idleWait--;
  if (timers.surf !== 0) timers.surf--;
  if (timers.waves !== 0) timers.waves--;
}
```

Run: `pnpm test src/engine/timers.test.ts`
Expected: PASS.

## Part B: The walk

- [ ] **Action 3: Write the failing unit tests**

Replace `src/walk/walk.test.ts`:

```ts
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
import { loadWalk, makeWalk, NO_HEADING, pickSegment, routeOf, segmentFrames, walkReset, walkStep, type Walk } from './walk.js';
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
```

Run: `pnpm test src/walk/walk.test.ts`
Expected: FAIL (the old `walk.ts` has none of these exports).

- [ ] **Action 4: Write the walk**

Replace `src/walk/walk.ts`:

```ts
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { MIRROR } from '../gfx/gdi/sprite.js';
import { redrawIslandOver, type Island } from '../island/island.js';
import type { SpriteSheet } from '../island/island-device.js';
import { MIRRORED_FRAME, ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS, type Route, type RouteChoice, type WalkFrame } from './walk-tables.js';

export const NO_HEADING = -1;
const WALK_BITMAPS = 'JOHNWALK.BMP';
const FIRST_SPOT = 1;
const FRAME_DELAY = 4;
const ROUTE_PERCENT = 100;
const SPRITE_BITS = 0x7fff;
const HEADING_BITS = 7;
const OPPOSITE = 4;
const WALK_RECTS = [[SURFACE_B, SURFACE_A, 0], [SURFACE_B, SURFACE_A, 1], [SURFACE_C, SURFACE_B, 0]] as const;

export interface Walk {
  island: Island;
  sheet: SpriteSheet | null;
  targetSpot: number;
  targetHeading: number;
  routeFrom: number;
  routeTo: number;
  segment: number;
  record: number;
  frameSegment: number;
  frameRecord: number;
  wantedHeading: number;
  segmentHeading: number;
  segmentSpot: number;
}

export function makeWalk(island: Island): Walk {
  return {
    island, sheet: null, targetSpot: 0, targetHeading: 0, routeFrom: 0, routeTo: 0, segment: 0, record: 0,
    frameSegment: 0, frameRecord: 0, wantedHeading: 0, segmentHeading: 0, segmentSpot: 0,
  };
}

export function loadWalk(walk: Walk): boolean {
  if (!walk.sheet) {
    walk.sheet = walk.island.device.loadSheet(WALK_BITMAPS);
    const { sequence } = walk.island.world;
    walk.targetSpot = FIRST_SPOT;
    sequence.spot = FIRST_SPOT;
    sequence.heading = 0;
  }
  return walk.sheet !== null;
}

export function routeOf(from: number, to: number): Route | null {
  if (from === 0 || to === 0) return null;
  return ROUTES[from - 1]?.[to - 1] ?? null;
}

export function segmentFrames(id: number): readonly WalkFrame[] | null {
  return id >= 1 && id < SEGMENTS.length ? SEGMENTS[id]!.frames : null;
}

export function pickSegment(choices: readonly RouteChoice[], value: number): number {
  let i = 0;
  let left = value - choices[0]![1];
  while (left > 0) {
    i++;
    left -= choices[i]![1];
  }
  return choices[i]![0];
}

export function walkReset(walk: Walk): void {
  walk.routeFrom = 0;
  walk.routeTo = 0;
  walk.segment = 0;
  walk.wantedHeading = walk.island.world.sequence.heading;
}

export function walkStep(walk: Walk): void {
  if (walk.island.timers.walk === 0 && !advance(walk)) return;
  drawFrame(walk);
}

function advance(walk: Walk): boolean {
  const { sequence, random } = walk.island.world;
  if (walk.routeFrom === 0 && sequence.spot !== walk.targetSpot && routeOf(sequence.spot, walk.targetSpot)) {
    walk.routeFrom = sequence.spot;
    walk.routeTo = walk.targetSpot;
  }
  if (walk.routeFrom !== 0 && walk.segment === 0) {
    const choices = routeOf(walk.routeFrom, walk.routeTo)![sequence.spot - 1];
    if (!choices) return false;
    startSegment(walk, pickSegment(choices, random.next() % ROUTE_PERCENT));
  }
  if (walk.targetHeading !== NO_HEADING && sequence.spot === walk.targetSpot && sequence.heading === walk.wantedHeading) {
    if (walk.wantedHeading === walk.targetHeading) {
      showTurn(walk, STANDING_TURNS);
      walk.targetHeading = NO_HEADING;
    } else {
      walk.wantedHeading = walk.targetHeading;
    }
  }
  if (sequence.heading !== walk.wantedHeading) {
    sequence.heading = (sequence.heading + turnStep(walk, sequence.heading - walk.wantedHeading)) & HEADING_BITS;
    showTurn(walk, sequence.spot === walk.targetSpot ? STANDING_TURNS : WALKING_TURNS);
  }
  if (walk.segment !== 0 && sequence.heading === walk.wantedHeading) {
    walk.frameSegment = walk.segment;
    walk.frameRecord = walk.record;
    walk.record++;
    if (walk.record === segmentFrames(walk.segment)!.length) endSegment(walk);
  }
  return true;
}

function startSegment(walk: Walk, id: number): void {
  const segment = SEGMENTS[id]!;
  walk.segment = segmentFrames(id) ? id : 0;
  walk.record = 0;
  walk.wantedHeading = segment.startHeading;
  walk.segmentHeading = segment.endHeading;
  walk.segmentSpot = segment.spot;
  if (walk.segment === 0) endSegment(walk);
}

function endSegment(walk: Walk): void {
  const { sequence } = walk.island.world;
  sequence.heading = walk.segmentHeading;
  sequence.spot = walk.segmentSpot;
  walk.segment = 0;
  if (sequence.spot !== walk.targetSpot) return;
  walk.routeFrom = 0;
  walk.routeTo = 0;
}

function turnStep(walk: Walk, difference: number): number {
  if (difference === OPPOSITE || difference === -OPPOSITE) return (walk.island.world.random.next() & 1) === 0 ? 1 : -1;
  return difference < -OPPOSITE || (difference > 0 && difference < OPPOSITE) ? -1 : 1;
}

function showTurn(walk: Walk, turns: readonly number[]): void {
  const { sequence } = walk.island.world;
  walk.frameSegment = turns[sequence.spot] ?? 0;
  walk.frameRecord = sequence.heading;
}

function drawFrame(walk: Walk): void {
  const frame = segmentFrames(walk.frameSegment)?.[walk.frameRecord];
  if (!frame || !walk.sheet) return;
  const sprite = frame[0] & SPRITE_BITS;
  const image = walk.sheet.images[sprite];
  if (!image) return;
  const { island } = walk;
  const x = island.x + frame[1];
  const y = island.y + frame[2];
  island.device.drawSprite(walk.sheet, sprite, x, y, frame[0] & MIRRORED_FRAME ? MIRROR : 0);
  redrawIslandOver(island, image, x, y, false);
  for (const [source, target, age] of WALK_RECTS) island.device.addDirtyRect(x, y, image.width, image.height, source, target, age);
  island.timers.walk = FRAME_DELAY;
}
```

Delete the jc_reborn walk:

```bash
git rm src/walk/calcpath.ts src/walk/calcpath-data.ts src/walk/calcpath.test.ts src/walk/walk-data.ts src/walk/walk.data.test.ts
```

(`src/walk/walk.data.test.ts` tests the old API; Part D writes the new one.)

Run: `pnpm test src/walk/walk.test.ts`
Expected: PASS (14 tests). `tsc` still fails in `src/story/story.ts`; Part C fixes it.

## Part C: The story drives the walk

- [ ] **Action 5: Point the story tests at the new walk**

In `src/story/story.test.ts`, replace the first test (`stores the walk target ...`) and add the imports it needs (`makeTimers` from `../engine/timers.js`, `makeIsland` from `../island/island.js`, `RecordingIslandDevice` from `../testing/island-recorder.js`, `makeWalk` from `../walk/walk.js`, `type ParsedArchive` from `../resource/types.js`):

```ts
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
```

In `src/story/story.data.test.ts`, `makeGame()`: after `drawIsland(island);` add `const walk = makeWalk(island);` and `loadWalk(walk);`, put `walk` into the returned object after `island`, and import `loadWalk`, `makeWalk` from `../walk/walk.js`. In `step()`, call `storyStep(story, game);`.

- [ ] **Action 6: Wire the walk into the story**

In `src/story/story.ts`:

1. Replace `import { startWalk, walkHold, walkTick, type WalkContext } from '../walk/walk.js';` with `import { NO_HEADING, walkReset, walkStep, type Walk } from '../walk/walk.js';`. Delete the constant `ANY_HEADING`; use `NO_HEADING` where it was used.
2. `GameState`: add `walk: Walk;` after `island: Island;`.
3. `StoryState`: delete `target` and `walk`. `makeStoryState` returns `{ started: false, adsId: 0, ads: null, debugAds, debugNext: 0 }`.
4. `storyStep`:

```ts
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
```

5. `startSequence`: delete `state.walk = null;`. `playStep`: delete `state.walk = null;`.
6. `idleStep`:

```ts
function idleStep(state: StoryState, game: GameState, entry: SceneEntry): void {
  if (!state.started) {
    state.started = true;
    game.timers.idleWait = (game.random.next() % IDLE_WAIT_SPREAD) + IDLE_WAIT_BASE;
    walkReset(game.walk);
  }
  walkStep(game.walk);
  if (game.timers.idleWait === 0) finishEntry(state, game.world, entry, false);
}
```

7. Delete `newWalk`, the local `walkStep`, and `holdJohnny`.

`1018:06bf` resets nothing of the walk when a sequence starts or an ADS entry ends (`docs/re/walk.md`, `Story interface`); do not add a reset.

- [ ] **Action 7: Load the walk at startup**

In `src/main.ts`:

1. Import `loadWalk`, `makeWalk` from `./walk/walk.js`.
2. After `drawIsland(island);` add:

```ts
const walk = makeWalk(island);
loadWalk(walk);
```

3. Add `walk` to `game` after `island`.
4. Replace the loop's tick function body with:

```ts
    const now = performance.now();
    for (let ticks = engineClock.ticksDue(now); ticks > 0; ticks--) clockTick(timers);
    if (!engineClock.stepDue(now) || now < firstStepAt) return;
    storyStep(story, game);
```

and delete `let ticksSinceStep = 0;`.

`1008:143c` calls `1010:0136` (the first call only loads the island sheets) and then `1018:0000`; keep that order.

- [ ] **Action 8: Run the build and the tests**

Run: `pnpm exec tsc --noEmit`
Expected: no errors. Fix any leftover reference to `state.target`, `state.walk`, `WalkContext`, `calcPath`, or `storyStep(..., elapsed)`: `rg -n "state\.target|state\.walk|WalkContext|calcPath|walkData|ticksSinceStep" src`.

Run: `pnpm test src/walk src/story src/engine`
Expected: all pass. `src/story/story.data.test.ts` plays every scene table entry to its end with the new walk; if an entry no longer ends, compare its walk with `docs/re/walk.md` before changing anything.

- [ ] **Action 9: Commit**

```bash
git add src/walk src/engine/timers.ts src/engine/timers.test.ts src/story/story.ts src/story/story.test.ts src/story/story.data.test.ts src/main.ts
git commit -m "feat(walk): port the original walk step and route tables; delete the jc_reborn path search"
```

## Part D: Equal to the original

- [ ] **Action 10: Write the walk recorder**

Create `src/testing/walk-recorder.ts`:

```ts
import { clockTick, makeTimers } from '../engine/timers.js';
import { drawIsland, makeIsland } from '../island/island.js';
import type { ParsedArchive } from '../resource/types.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { isAtSpot } from '../story/story.js';
import { loadWalk, makeWalk, walkReset, walkStep, type Walk } from '../walk/walk.js';
import { RecordingIslandDevice } from './island-recorder.js';

export const WALK_CASES = 36;
const LEGS = 6;
const IDLE_BEATS = 8;
const LEG_BEATS = 1500;
const STEP_MS = 50;
const TICK_MS = 16;
const SPOTS = 6;
const HEADINGS = 8;
const DISCARD_STEP = 1009;

function beatTicks(beat: number): number {
  return Math.floor((STEP_MS * (beat + 1)) / TICK_MS) - Math.floor((STEP_MS * beat) / TICK_MS);
}

function legTarget(k: number, leg: number): [spot: number, heading: number] {
  const spot = leg === 0 ? 1 + (k % SPOTS) : (k + 3 * leg) % (SPOTS + 1);
  return [spot, (3 * k + 5 * leg + 1) % HEADINGS];
}

function stateRow(walk: Walk, random: StoryRandom): (string | number)[] {
  const { sequence } = walk.island.world;
  return [
    sequence.spot, sequence.heading, walk.targetSpot, walk.targetHeading, walk.wantedHeading, walk.segmentHeading, walk.segmentSpot,
    walk.routeFrom ? `${walk.routeFrom},${walk.routeTo}` : 0,
    walk.segment ? `${walk.segment}:${walk.record}` : 0,
    walk.frameSegment ? `${walk.frameSegment}:${walk.frameRecord}` : 0,
    walk.island.timers.walk, random.writeIndex,
  ];
}

export function traceWalkCase(archive: ParsedArchive, k: number): string[] {
  const device = new RecordingIslandDevice(archive);
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  const timers = makeTimers();
  const island = makeIsland(device, world, timers, { background: true, clouds: true, waves: true });
  drawIsland(island);
  Object.assign(world.island, { mode: 0, place: 0xffff, lowTide: k % 2, still: false, noRaft: false, holidayShown: true });
  world.sequence.holiday = 0;
  world.sequence.slot = 0;
  world.days.numDays = 1;
  random.discard(DISCARD_STEP * k);
  device.restart();
  drawIsland(island);
  const walk = makeWalk(island);
  loadWalk(walk);
  world.sequence.spot = 1 + Math.floor(k / SPOTS);
  world.sequence.heading = k % HEADINGS;
  device.events.length = 0;

  const rows: string[] = [];
  const flush = (beat: number) => {
    for (const [event, ...values] of device.events) rows.push([k, beat, event, values.join(' ')].join('\t'));
    rows.push([k, beat, 'state', stateRow(walk, random).join(' ')].join('\t'));
    device.events.length = 0;
  };
  let beats = 0;
  const startBeat = () => {
    for (let i = beatTicks(beats); i > 0; i--) clockTick(timers);
    return beats++;
  };

  flush(-1);
  for (let leg = 0; leg < LEGS; leg++) {
    if (leg % 2 === 1) {
      world.sequence.spot = 1 + ((k + leg) % SPOTS);
      world.sequence.heading = (2 * k + leg) % HEADINGS;
    } else if (leg > 0) {
      for (let i = 0; i < IDLE_BEATS; i++) {
        const beat = startBeat();
        if (i === 0) {
          device.events.push(['reset', leg]);
          walkReset(walk);
        }
        walkStep(walk);
        flush(beat);
      }
    }
    const [spot, heading] = legTarget(k, leg);
    let arrived = false;
    for (let i = 0; i < LEG_BEATS && !arrived; i++) {
      const beat = startBeat();
      arrived = isAtSpot(walk, spot, heading);
      device.events.push(['at', leg, spot, heading, arrived ? 1 : 0]);
      if (!arrived) walkStep(walk);
      flush(beat);
    }
    if (!arrived) rows.push([k, beats - 1, 'stuck', leg].join('\t'));
  }
  return rows;
}
```

`device.restart()` before the second `drawIsland` matches the Python harness resetting `overlap_calls` to 0 there.

- [ ] **Action 11: Write the data tests**

Replace `src/walk/walk.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTimers } from '../engine/timers.js';
import { Display, SURFACE_C } from '../gfx/gdi/display.js';
import { DisplayIslandDevice } from '../island/island-device.js';
import { animateIsland, drawIsland, makeIsland } from '../island/island.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { traceWalkCase, WALK_CASES } from '../testing/walk-recorder.js';
import { loadWalk, makeWalk, walkStep } from './walk.js';

describe.skipIf(!hasFixture('walk/traces.tsv'))('walk matches the original SCRANTIC.SCR', () => {
  it('picks, turns, moves, and draws the same way in every case', { timeout: 120_000 }, () => {
    // SCRANTIC 1018:0000 1018:0074 1018:0094 1018:03ac 1018:03ea 1018:0b46 1010:1551 1008:16c2
    const archive = loadArchive();
    const original = new Map<number, string[]>();
    for (const [k, beat, event, values] of readFixtureRows('walk/traces.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, beat, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: WALK_CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceWalkCase(archive, k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('walk on the display', () => {
  it('draws Johnny on B over the island and presents him through the restore pass', () => {
    // SCRANTIC 1018:0094 1010:040e 1060:03d3
    const display = new Display();
    display.screenIsB = true;
    const world = makeStoryWorld(new StoryRandom());
    const island = makeIsland(new DisplayIslandDevice(display, loadArchive()), world, makeTimers(), { background: true, clouds: true, waves: true });
    drawIsland(island);
    drawIsland(island);
    display.restorePass(0);
    const walk = makeWalk(island);
    expect(loadWalk(walk)).toBe(true);
    walk.targetSpot = 2;
    animateIsland(island, false);
    walkStep(walk);
    display.restorePass(0);
    const c = display.surfaces[SURFACE_C]!.pixels;
    expect(display.window.pixels.some((index, p) => index !== c[p])).toBe(true);
  });
});
```

Run: `pnpm test src/walk/walk.data.test.ts`
Expected: 2 passed. If the trace test fails, read the first wrong row of each case: find the rule in `docs/re/walk.md` (or in `re/out/functions/1018_0094_walk_step.asm`) that the port gets wrong and fix the port, not the trace. Fix one rule at a time and rerun.

- [ ] **Action 12: Run everything and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, with `src/walk/walk.data.test.ts`, `src/walk/walk-tables.data.test.ts`, and `src/story/story.data.test.ts` not skipped.

```bash
git add src/testing/walk-recorder.ts src/walk/walk.data.test.ts
git commit -m "test(walk): the walk port matches the original walk trace"
```

## Part E: Docs and the browser

- [ ] **Action 13: Update the checklists**

Run: `rg -n "^export function|^function" src/walk/walk.ts src/story/story.ts src/engine/timers.ts`

In `docs/re/walk.md`, `Side-by-side checklist`, set:

| Original | Ours | Status |
| --- | --- | --- |
| `1018:0000` | `src/walk/walk.ts:<line>` `loadWalk` (called from `src/main.ts` after the first `drawIsland`) | fixed |
| `1018:004d` | none (nothing to free in JavaScript) | match |
| `1018:0074` | `src/walk/walk.ts:<line>` `walkReset` | fixed |
| `1018:0094` | `src/walk/walk.ts:<line>` `walkStep` (`advance`, `drawFrame`) | fixed |
| `1018:03ac` | `src/walk/walk.ts:<line>` `routeOf` (`src/walk/walk-tables.ts` `ROUTES`) | fixed |
| `1018:03ea` | `src/walk/walk.ts:<line>` `segmentFrames` (`src/walk/walk-tables.ts` `SEGMENTS`) | fixed |

with the real line numbers. Keep the `Name` column.

In `docs/re/story.md`, `Side-by-side checklist`: the `1008:16c2` row drops "`30d4` is chunk 8's" and says the walk delay is `Timers.walk`; the `1018:06bf` and `1018:0b46` rows get their new `file:line` (`storyStep`, `isAtSpot`), `1018:0b46` noting that the target lives in `Walk`.

- [ ] **Action 14: Resolve OQ-25 and log OQ-37**

In `docs/re/open-questions.md`, move `### OQ-25: Walk drawing bridge` from `Workarounds without a known root cause` to `Resolved` (after the last resolved entry), replace its `Resolve in` line with:

```markdown
- **Resolution:** `src/walk/walk.ts` ports `1018:0000`, `1018:0074`, `1018:0094`, `1018:03ac`, and `1018:03ea` with the original tables (`src/walk/walk-tables.ts`, generated from `1068:02e1`..`165f`). The story calls `walkStep` and `walkReset` where `1018:06bf` calls `1018:0094` and `1018:0074`, and `isAtSpot` stores the target in the walk (`1018:0b46`). Spots are 1..6; a segment is picked from the route by percent with the story's random generator; Johnny turns one heading per frame; the frame delay is 4 clock ticks (`Timers.walk`, `1068:30d4`); there is no rest on arrival; the frame is drawn on every story step at the island offset plus the frame's x and y, only the palm trunk is redrawn over it (`1010:1551` mode 0), and the three dirty rects have the image's size. `src/walk/walk.data.test.ts` matches the original walk trace (`re/fixtures/walk/traces.tsv`). The jc_reborn walk (`calcpath.ts`, `calcpath-data.ts`, `walk-data.ts`, `walkHold`, the 6 and 80 tick timers, the palm sprites 12 and 13) is deleted.
```

and set its status to `- **Status:** resolved (chunk 8)`.

Add to `Not reviewed on purpose`, after OQ-36:

```markdown
### OQ-37: Walk guards where the original reads through a bad pointer

- **Where:** `src/walk/walk.ts` (`drawFrame`, `showTurn`, `pickSegment`)
- **What it does:** draws nothing when there is no frame, no JOHNWALK sheet, or the sprite index is past the sheet's end; a turn at a spot with no turn set leaves no frame; a percent pick that runs past its group's last choice throws.
- **Original:** `1018:0094` adds `heading × 6` to the frame list of turn set 0 (a null address) at spot 0, reads the bitmap list at `1068:30d2` without a check, and would read the next group's marker as a percent. With the shipped data none of this happens: `1018:0094` never runs with Johnny at spot 0 (`docs/re/walk.md`, `Story interface`), every frame's sprite exists (`src/walk/walk-tables.data.test.ts`), every group the walk can reach adds up to at least 100 (`src/walk/walk-tables.test.ts`), and `1008:143c` stops when JOHNWALK.BMP does not load.
- **Status:** open, by choice
```

- [ ] **Action 15: Commit**

```bash
git add docs/re/walk.md docs/re/story.md docs/re/open-questions.md
git commit -m "docs(re): walk ported; OQ-25 resolved, OQ-37 logged"
```

- [ ] **Action 16: Browser check**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open `http://localhost:5173/` (and `/?skipIntro=true` to get there faster) and watch at least two sequences. Ask them to confirm:

- Johnny walks between scenes with smooth frames (about 10 per second) and no jumps between segments.
- He turns in place, one heading at a time, before walking and at the end.
- He stays on screen while idle and between the walk and the next scene; he does not vanish or blink.
- He walks behind the palm trunk where the path passes it, and in front of everything else.
- No trails or leftover Johnny frames on the sand.

You cannot see the canvas yourself; do not mark this action done without their answer. A crash or a blank screen gets fixed now. Anything else wrong goes into `docs/re/walk.md` as an observation and into a new open question (OQ-38) with what was seen and which rule it may come from.

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

If anything changed, commit it:

```bash
git add docs/re/walk.md docs/re/open-questions.md src
git commit -m "docs(re): walk browser check"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
