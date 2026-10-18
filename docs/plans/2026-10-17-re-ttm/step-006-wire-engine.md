# Step 6: Wire the Engine to the Display Model

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-004-page-runner.md`, `step-005-display-window-and-gdi-device.md`

**Files:**

- Create: `src/gfx/present.ts`, `src/gfx/present.test.ts`, `src/island/island.data.test.ts`, `src/walk/walk.test.ts`, `src/ads/scheduler.data.test.ts`
- Modify: `src/island/island.ts`, `src/walk/walk.ts`, `src/ads/scheduler.ts`, `src/story/story.ts`, `src/main.ts`, `src/debug-main.ts`, `src/types.ts`
- Delete: `src/gfx/layer.ts`, `src/gfx/primitives.ts`, `src/gfx/primitives.test.ts`, `src/gfx/sprite.ts`, `src/gfx/sprite.test.ts`, `src/gfx/clip.ts`, `src/gfx/zone.ts`, `src/gfx/compositor.ts`, `src/ttm/interpreter.ts`, `src/ttm/interpreter.test.ts`, `src/ttm/thread.ts`, `src/ttm/bmp-slots.ts`
- Modify: `docs/re/open-questions.md` (OQ-9, OQ-10, OQ-20 resolved; OQ-22, OQ-24, OQ-25, OQ-26, OQ-28 added), `docs/re/ttm.md` (`ADS side`)

**Interfaces:**

- Consumes:
  - `src/ttm/state.ts` (step 4): `interface TtmSlot { id; ttm: TtmResource | null; bitmaps; palettes; zones }`, `interface TtmThread { slot; isRunning: 0 | 1 | 2; sceneSlot; sceneTag; sceneTimer; sceneIterations; delay; timer; tagPage; page; nextPage (-1 = none); replay; purged; paletteSlot; bmpSlot; zoneSlot; foreground; background; clipOn; clip }`, `makeTtmSlot(id, ttm)`, `makeThread(slot?)` (delay 0, timer 0, page 0, nextPage -1, replay false, foreground/background 15, clip on whole screen), `loadThreadDrawState(thread, draw)`, `resetDrawClip(draw)`.
  - `src/ttm/page-runner.ts` (step 4): `interface TtmEnv { device: TtmDevice; draw: DrawState; islandX; islandY; pendingPalette; mirrorNextLoad; keepDrawings }`, `interface PageResult { ran: boolean; delay: number | null; gotoPage: number | null; purge: boolean }`, `makeTtmEnv(device, draw)`, `runTtmPage(env, thread, page): PageResult`, `activatePendingPalette(env, palette)`.
  - `src/ttm/gdi-device.ts` (step 5): `new GdiDevice(display, draw, archive, { playSound(sample), random() })`.
  - `src/gfx/gdi/display.ts` (chunk 4 + step 5): `Display` with `surfaces`, `window`, `dirty`, `source`, `target`, `screenIsB`, `copyRect`, `blitScreen(image, x, y)`, `restorePass(which)`; `SURFACE_A = 0`, `SURFACE_B = 1`, `SURFACE_C = 2`. `src/gfx/gdi/dirty.ts`: `COPY_RECT`, `DirtyLists.add(x, y, w, h, kind, source, target, age, clip | null)`, `overlaps(x, y, w, h, target, age): number` (non-zero when a kind-1 rect of that target and age overlaps), `snapshot()`. `src/gfx/gdi/sprite.ts`: `MIRROR = 2`, `drawSprite(surface, state, image, x, y, flags = 0, hasMirroredCopy = false)`, `spriteSurface(sprite)`. `src/gfx/gdi/surface.ts`: `makeDrawState()`, `makeSurface(w?, h?)`, `rawIndices(indexed)`. `src/gfx/gdi/primitives.ts`: `drawLine/drawRect/drawCircle(surface, state, ...)`.
  - `src/gfx/fade.ts`: `applyFade(px: Uint8ClampedArray, fade: FadeState)`.
- Produces:
  - `src/gfx/present.ts`: `presentSurface(out: Uint8ClampedArray, surface: Surface, palette: Palette): void`.
  - `src/island/island.ts`: `interface IslandSprite { image: Surface; x: number; y: number }`, `interface IslandRuntime { sprites: Surface[]; holiday: IslandSprite | null; state: IslandState; counter1; counter2 }`, `islandInit(display, archive, state): IslandRuntime` (draws into C), `islandAnimate(rt, display)`, `islandRedrawHoliday(rt, display)`, `showBackground(display)`, `clearBackground(display)`, `showScreen(display, archive, name): boolean`. `IslandState` and `randomIslandState()` unchanged.
  - `src/walk/walk.ts`: `walkAnimate(ws): number` (state only), `walkDraw(ws, display, sprites: Surface[], bgSprites: Surface[], dx, dy): void`.
  - `src/ads/scheduler.ts`: `adsTick(state, env: TtmEnv, palette: Palette, display: Display): number`; `WalkContext` without `layer`; `AdsState` without `lingeringLayers`; `adsThreadLayers` removed; `adsPlayWalk(state, archive, bgSprites: Surface[], ...)`.
  - `src/story/story.ts`: `GameState { adsState; islandRt: IslandRuntime | null; islandState; bgAnimTimer; ttm: TtmEnv; display: Display; palette: Palette; archive; fadeState }`, `storyRedrawHoliday(game)`.

## Scope

This step switches drawing only. Thread lifecycle (chunk 6), story and island logic (chunk 7), and walking (chunk 8) keep their current logic except where a line below changes it. Every made-up connection gets an open question in Part G. Parts B to E change signatures that depend on each other, so `pnpm exec tsc --noEmit` only passes again at the end of Part E; run the module tests with Vitest as you go and commit once at the end of Part E.

## Part A: Presenting to the canvas

- [x] **Action 1: Write the failing test**

Create `src/gfx/present.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makePalette } from './palette.js';
import { presentSurface } from './present.js';

describe('presentSurface', () => {
  it('turns palette indices into opaque RGBA, index 0 included', () => {
    const palette = makePalette();
    palette.set([10, 20, 30, 255], 3 * 4);
    palette.set([168, 0, 168, 255], 0);
    const out = new Uint8ClampedArray(2 * 4);
    presentSurface(out, { width: 2, height: 1, pixels: Uint8Array.of(0, 3) }, palette);
    expect([...out]).toEqual([168, 0, 168, 255, 10, 20, 30, 255]);
  });
});
```

- [x] **Action 2: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/present.test.ts`
Expected: FAIL, `Cannot find module './present.js'`.

- [x] **Action 3: Write it**

Create `src/gfx/present.ts`:

```ts
import type { Palette } from '../types.js';
import type { Surface } from './gdi/surface.js';

export function presentSurface(out: Uint8ClampedArray, surface: Surface, palette: Palette): void {
  for (let p = 0; p < surface.pixels.length; p++) {
    const color = surface.pixels[p]! * 4;
    const o = p * 4;
    out[o] = palette[color]!;
    out[o + 1] = palette[color + 1]!;
    out[o + 2] = palette[color + 2]!;
    out[o + 3] = 255;
  }
}
```

- [x] **Action 4: Run it and commit**

Run: `pnpm exec vitest run src/gfx/present.test.ts`
Expected: PASS.

```bash
git add src/gfx/present.ts src/gfx/present.test.ts
git commit -m "feat(gfx): present a surface to RGBA"
```

## Part B: Island on the display

- [x] **Action 5: Write the failing data test**

Create `src/island/island.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { islandAnimate, islandInit, islandRedrawHoliday, showBackground, type IslandState } from './island.js';

const STATE: IslandState = { lowTide: true, night: false, raft: 3, holiday: 3, xPos: -50, yPos: 20 };

function shownIsland() {
  const display = new Display();
  display.screenIsB = true;
  const rt = islandInit(display, loadArchive(), STATE);
  return { display, rt };
}

describe.skipIf(!hasCorpus)('island on the display', () => {
  it('draws the island into C and shows it through B on the window', () => {
    // SCRANTIC 1060:03d3 1038:06ce
    const { display } = shownIsland();
    expect(display.surfaces[SURFACE_B]!.pixels.every((index) => index === 0)).toBe(true);
    expect(display.surfaces[SURFACE_C]!.pixels.some((index) => index !== 0)).toBe(true);
    showBackground(display);
    display.restorePass(0);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
  });

  it('draws waves on B, presents them, and keeps them in C', () => {
    // SCRANTIC 1010:040e 1060:03d3
    const { display, rt } = shownIsland();
    showBackground(display);
    display.restorePass(0);
    const before = display.surfaces[SURFACE_C]!.pixels.slice();
    for (let i = 0; i < 12; i++) {
      islandAnimate(rt, display);
      display.restorePass(0);
    }
    expect(display.surfaces[SURFACE_C]!.pixels).not.toEqual(before);
    expect(display.surfaces[SURFACE_B]!.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
    expect(display.window.pixels).toEqual(display.surfaces[SURFACE_C]!.pixels);
  });

  it('redraws the holiday sprite on B only when a presented rect overlaps it', () => {
    // SCRANTIC 1010:1e50 1060:04b2
    const { display, rt } = shownIsland();
    const holiday = rt.holiday!;
    const b = display.surfaces[SURFACE_B]!;
    islandRedrawHoliday(rt, display);
    expect(b.pixels.every((index) => index === 0)).toBe(true);
    display.dirty.add(holiday.x, holiday.y, 8, 8, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
    islandRedrawHoliday(rt, display);
    expect(b.pixels.some((index) => index !== 0)).toBe(true);
  });
});
```

- [x] **Action 6: Rewrite the island drawing**

Replace `src/island/island.ts` with the code below. The island logic (positions, sprite numbers, random choices, counters) is unchanged; only where it draws changes.

```ts
import { decodeBmp } from '../decode/bmp.js';
import { decodeScr } from '../decode/scr.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { SURFACE_A, SURFACE_B, SURFACE_C, type Display } from '../gfx/gdi/display.js';
import { drawSprite, MIRROR, spriteSurface } from '../gfx/gdi/sprite.js';
import { makeDrawState, rawIndices, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export interface IslandState {
  lowTide: boolean;
  night: boolean;
  raft: number;     // 0=none, 1-5
  holiday: number;  // 0=none, 1=Halloween, 2=StPatrick, 3=Xmas, 4=NewYear
  xPos: number;
  yPos: number;
}

export function randomIslandState(): IslandState {
  const r = Math.random;
  const lowTide = r() < 0.33;
  // xPos/yPos ranges from story.c:135-144 (medium zoom — most common)
  const xPos = -114 + Math.floor(r() * 134);
  const yPos = -14  + Math.floor(r() * 99);
  return { lowTide, night: false, raft: 0, holiday: 0, xPos, yPos };
}

export interface IslandSprite {
  image: Surface;
  x: number;
  y: number;
}

export interface IslandRuntime {
  sprites: Surface[];   // all sprites from BACKGRND.BMP
  holiday: IslandSprite | null;
  state: IslandState;
  counter1: number;
  counter2: number;
}

const HIGH_TIDE_WAVES = [[270, 306, 3], [364, 319, 6], [518, 303, 9]] as const;
const LOW_TIDE_WAVES = [[129, 340, 39], [233, 323, 30], [367, 356, 33], [558, 323, 36]] as const;
const HOLIDAYS = [[410, 298, 0], [333, 286, 1], [404, 267, 2], [361, 155, 3]] as const;
const unclipped = makeDrawState();

function drawOn(surface: Surface, image: Surface | undefined, x: number, y: number, flags = 0): void {
  if (image) drawSprite(surface, unclipped, image, x, y, flags);
}

function loadSprites(archive: ParsedArchive, name: string): Surface[] {
  const resource = archive.byName.get(name);
  return resource ? decodeBmp(resource.payload).sprites.map(spriteSurface) : [];
}

function drawScreenIntoBackground(display: Display, payload: Uint8Array): void {
  const screen = decodeScr(payload);
  const { target } = display;
  display.target = SURFACE_C;
  display.blitScreen({ width: screen.width, height: screen.height, pixels: rawIndices(screen.indexed) }, 0, 0);
  display.target = target;
}

export function islandInit(display: Display, archive: ParsedArchive, state: IslandState): IslandRuntime {
  const background = display.surfaces[SURFACE_C]!;
  background.pixels.fill(0);
  const screen = archive.byName.get(state.night ? 'NIGHT.SCR' : `OCEAN0${Math.floor(Math.random() * 3)}.SCR`);
  if (screen) drawScreenIntoBackground(display, screen.payload);

  if (state.raft > 0) {
    const raft = loadSprites(archive, 'MRAFT.BMP')[state.raft - 1];
    const x = (state.lowTide ? 529 : 512) + state.xPos;
    const y = (state.lowTide ? 281 : 266) + state.yPos;
    drawOn(background, raft, x, y);
  }

  const sprites = loadSprites(archive, 'BACKGRND.BMP');
  const rt: IslandRuntime = { sprites, holiday: null, state, counter1: 0, counter2: 0 };

  // Clouds (grDx=grDy=0 in C — no island offset)
  const windDir = Math.random() < 0.5;
  const r = Math.random;
  const numClouds = Math.floor(r() * 6);
  for (let i = 0; i < numClouds; i++) {
    const cloudNo = Math.floor(r() * 3);
    const [maxW, maxH] = cloudNo === 0 ? [640 - 129, 100 - 36]
      : cloudNo === 1 ? [640 - 192, 100 - 57]
      : [640 - 264, 100 - 76];
    const cx = Math.floor(r() * maxW);
    const cy = Math.floor(r() * maxH) + 25;
    drawOn(background, sprites[15 + cloudNo], cx, cy, windDir ? MIRROR : 0);
  }

  const onIsland = (x: number, y: number, sprNo: number) => drawOn(background, sprites[sprNo], x + state.xPos, y + state.yPos);
  onIsland(288, 279, 0);   // island body
  onIsland(442, 148, 13);  // trunk
  onIsland(365, 122, 12);  // leafs
  onIsland(396, 279, 14);  // palm shadow
  if (state.lowTide) {
    onIsland(249, 303, 1); // low tide shore
    onIsland(150, 328, 2); // rock
  }

  for (let i = 0; i < 4; i++) {
    const [x, y, sprNo] = nextWave(rt);
    drawOn(background, sprites[sprNo], x, y);
  }

  rt.holiday = placeHoliday(archive, state);
  if (rt.holiday) drawOn(background, rt.holiday.image, rt.holiday.x, rt.holiday.y);
  return rt;
}

function nextWave(rt: IslandRuntime): [number, number, number] {
  let wave: readonly [number, number, number];
  if (rt.state.lowTide) {
    rt.counter2 = (rt.counter2 + 1) % 4;
    wave = LOW_TIDE_WAVES[rt.counter2]!;
  } else {
    rt.counter2 = (rt.counter2 + 1) % 3;
    wave = HIGH_TIDE_WAVES[rt.counter2]!;
  }
  const placed: [number, number, number] = [wave[0] + rt.state.xPos, wave[1] + rt.state.yPos, wave[2] + rt.counter1];
  if (rt.counter2 === 0) rt.counter1 = (rt.counter1 + 1) % 2;
  return placed;
}

// Called every 8 ticks (delay set in adsInitIsland).
export function islandAnimate(rt: IslandRuntime, display: Display): void {
  const [x, y, sprNo] = nextWave(rt);
  const image = rt.sprites[sprNo];
  if (!image) return;
  drawOn(display.surfaces[SURFACE_B]!, image, x, y);
  display.dirty.add(x, y, image.width, image.height, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
  display.dirty.add(x, y, image.width, image.height, COPY_RECT, SURFACE_B, SURFACE_C, 0, null);
}

function placeHoliday(archive: ParsedArchive, state: IslandState): IslandSprite | null {
  if (!state.holiday) return null;
  const [x, y, sprNo] = HOLIDAYS[state.holiday - 1]!;
  const image = loadSprites(archive, 'HOLIDAY.BMP')[sprNo];
  return image ? { image, x: x + state.xPos, y: y + state.yPos } : null;
}

export function islandRedrawHoliday(rt: IslandRuntime, display: Display): void {
  const holiday = rt.holiday;
  if (!holiday) return;
  if (!display.dirty.overlaps(holiday.x, holiday.y, holiday.image.width, holiday.image.height, SURFACE_A, 0)) return;
  drawOn(display.surfaces[SURFACE_B]!, holiday.image, holiday.x, holiday.y);
}

export function showBackground(display: Display): void {
  const { source, target } = display;
  display.source = SURFACE_C;
  display.target = SURFACE_B;
  display.copyRect(0, 0, SCREEN_W, SCREEN_H);
  display.source = source;
  display.target = target;
  display.dirty.add(0, 0, SCREEN_W, SCREEN_H, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
}

export function clearBackground(display: Display): void {
  display.surfaces[SURFACE_C]!.pixels.fill(0);
  showBackground(display);
}

export function showScreen(display: Display, archive: ParsedArchive, name: string): boolean {
  const resource = archive.byName.get(name);
  if (!resource) return false;
  display.surfaces[SURFACE_C]!.pixels.fill(0);
  drawScreenIntoBackground(display, resource.payload);
  showBackground(display);
  return true;
}
```

The old `drawSpriteFlip` mirrored left to right, which is `MIRROR` in the model.

- [x] **Action 7: Run the island test**

Run: `pnpm exec vitest run src/island`
Expected: all pass.

## Part C: Walk on the display

- [x] **Action 8: Write the failing test**

Create `src/walk/walk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeSurface } from '../gfx/gdi/surface.js';
import { walkAnimate, walkDraw, walkInit } from './walk.js';

const sprites = Array.from({ length: 256 }, () => {
  const image = makeSurface(2, 2);
  image.pixels.fill(5);
  return image;
});

describe('walk on the display', () => {
  it('moves without drawing, then draws the frame on B with the TTM sprite rects', () => {
    // SCRANTIC 1050:0a85
    const display = new Display();
    const ws = walkInit(0, 0, 0, 0);
    expect(walkAnimate(ws)).toBe(80);
    expect(display.surfaces[SURFACE_B]!.pixels.includes(5)).toBe(false);
    walkDraw(ws, display, sprites, [], 0, 0);
    expect(display.surfaces[SURFACE_B]!.pixels.includes(5)).toBe(true);
    const lists = display.dirty.snapshot().map(([, rects]) => [rects[0]!.source, rects[0]!.target, rects[0]!.age, rects[0]!.h]);
    expect(lists).toEqual([
      [SURFACE_B, SURFACE_A, 0, 4],
      [SURFACE_B, SURFACE_A, 1, 4],
      [SURFACE_C, SURFACE_B, 0, 4],
    ]);
    expect(walkAnimate(ws)).toBe(0);
  });
});
```

`walkInit(0, 0, 0, 0)` starts and ends at spot A facing south: the first `walkAnimate` arrives at once (80) and the next one reports done (0).

- [x] **Action 9: Split moving from drawing**

In `src/walk/walk.ts`:

Replace the first three import lines (`drawSprite`/`drawSpriteFlip`, `clearLayer`, `Layer`/`Sprite`) with:

```ts
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { SURFACE_A, SURFACE_B, SURFACE_C, type Display } from '../gfx/gdi/display.js';
import { drawSprite, MIRROR } from '../gfx/gdi/sprite.js';
import { makeDrawState, type Surface } from '../gfx/gdi/surface.js';
```

Replace the comment and signature of `walkAnimate`:

```ts
// Returns delay ticks: 6 while walking/turning, 80 when just arrived, 0 when done.
// Modifies ws in place.
export function walkAnimate(ws: WalkState): number {
```

Delete the drawing at the end of `walkAnimate` (from `// Draw current frame` through the `if (ws.isBehindTree) { ... }` block), keeping the final `return ws.hasArrived ? 80 : 6;`.

Add after `walkAnimate`:

```ts
const DRAWN_LISTS = [
  [SURFACE_B, SURFACE_A, 0],
  [SURFACE_B, SURFACE_A, 1],
  [SURFACE_C, SURFACE_B, 0],
] as const;
const unclipped = makeDrawState();

export function walkDraw(ws: WalkState, display: Display, sprites: Surface[], bgSprites: Surface[], dx: number, dy: number): void {
  const [mirrored = 0, x = 0, y = 0, sprNo = 0] = walkData[ws.dataIdx]!;
  drawMarked(display, sprites[sprNo], x - 1 + dx, y + dy, mirrored ? MIRROR : 0);
  // Redraw palm tree on top when Johnny is behind it
  if (ws.isBehindTree) {
    drawMarked(display, bgSprites[13], 442 + dx, 148 + dy, 0);
    drawMarked(display, bgSprites[12], 365 + dx, 122 + dy, 0);
  }
}

function drawMarked(display: Display, image: Surface | undefined, x: number, y: number, flags: number): void {
  if (!image) return;
  drawSprite(display.surfaces[SURFACE_B]!, unclipped, image, x, y, flags);
  for (const [source, target, age] of DRAWN_LISTS) {
    display.dirty.add(x, y, image.width, image.height + 2, COPY_RECT, source, target, age, null);
  }
}
```

- [x] **Action 10: Run the walk tests**

Run: `pnpm exec vitest run src/walk`
Expected: all pass. If the drawn frame of spot A lands off screen (no pixel 5 on B), pass `dx`/`dy` that bring it on screen in the test, not a change to `walkDraw`.

## Part D: Scheduler adapter

The scheduler keeps its ADS logic (chunk 6). Only thread state, ticking, and drawing change.

- [x] **Action 11: Write the failing data test**

Create `src/ads/scheduler.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { Display } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { storyScenes } from '../story/story-data.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { adsTick, makeAdsState } from './scheduler.js';

const TICKS = 100;

describe.skipIf(!hasCorpus)('ADS scheduler adapter on the real data', () => {
  it('plays the first ticks of every story scene on the display, never pausing for 0 ticks', { timeout: 120_000 }, () => {
    // SCRANTIC 1048:1acb 1048:196e 1060:03d3
    const archive = loadArchive();
    for (const scene of storyScenes) {
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0x1234 });
      const env = makeTtmEnv(device, draw);
      const state = makeAdsState(decodeAds(archive.byName.get(scene.adsName)!.payload), archive, scene.adsTagNo);
      for (let tick = 0; tick < TICKS; tick++) {
        expect(adsTick(state, env, makePalette(), display), `${scene.adsName} ${scene.adsTagNo} tick ${tick}`).toBeGreaterThanOrEqual(1);
        display.restorePass(0);
      }
    }
  });
});
```

- [x] **Action 12: Switch the scheduler**

In `src/ads/scheduler.ts`:

Replace the imports (the first 12 lines) with:

```ts
import { ADS, ADS_ARG_COUNTS } from './opcodes.js';
import type { AdsResource } from '../decode/ads-loader.js';
import type { ParsedArchive } from '../resource/types.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import { decodeBmp } from '../decode/bmp.js';
import type { Display } from '../gfx/gdi/display.js';
import { spriteSurface } from '../gfx/gdi/sprite.js';
import type { Surface } from '../gfx/gdi/surface.js';
import { activatePendingPalette, runTtmPage, type TtmEnv } from '../ttm/page-runner.js';
import { loadThreadDrawState, makeThread, makeTtmSlot, resetDrawClip, type TtmSlot, type TtmThread } from '../ttm/state.js';
import type { Palette } from '../types.js';
import { walkInit, walkAnimate, walkDraw, type WalkState } from '../walk/walk.js';
```

Replace `interface WalkContext` with:

```ts
export interface WalkContext {
  ws: WalkState;
  sprites: Surface[];    // JOHNWALK.BMP images
  bgSprites: Surface[];  // BACKGRND.BMP images (for palm tree occlusion)
  dx: number;
  dy: number;
  timer: number;
  done: boolean;
}
```

In `interface AdsState`, delete the `lingeringLayers` line. In `makeAdsState`, replace the slot and thread setup and the state literal's `threads` and `lingeringLayers` lines so that it reads:

```ts
  const maxSlot = Math.max(0, ...ads.subResources.map(s => s.slot));
  const ttmSlots: TtmSlot[] = Array.from({ length: maxSlot + 1 }, (_, id) => makeTtmSlot(id, null));
  for (const sub of ads.subResources) {
    const raw = archive.byName.get(sub.name);
    if (!raw) { console.warn(`ADS sub-resource not found: ${sub.name}`); continue; }
    ttmSlots[sub.slot] = makeTtmSlot(sub.slot, decodeTtm(raw.payload));
  }
```

```ts
    threads: Array.from({ length: MAX_THREADS }, () => makeThread()),
```

(and no `lingeringLayers` entry).

Replace `adsAddScene` and `findTtmTag` with:

```ts
function adsAddScene(state: AdsState, slotNo: number, tag: number, arg3: number): void {
  if (isSceneRunning(state, slotNo, tag)) return;

  const thread = state.threads.find(t => !t.isRunning);
  if (!thread) { console.warn('no free TTM thread'); return; }

  const slot = state.ttmSlots[slotNo];
  if (!slot) { console.warn(`no TTM slot ${slotNo}`); return; }

  const tagPage = slotNo === 0 ? 0 : tagPageOf(slot, tag);
  Object.assign(thread, makeThread(slot), { isRunning: 1, sceneSlot: slotNo, sceneTag: tag, tagPage, page: tagPage });

  const signed = (arg3 << 16) >> 16;
  if (signed < 0) thread.sceneTimer = -signed;
  else if (arg3 > 0) thread.sceneIterations = arg3 - 1;

  console.log(`[ADS] start slot=${slotNo} tag=${tag} iters=${thread.sceneIterations}`);
}

function tagPageOf(slot: TtmSlot, tag: number): number {
  return slot.ttm?.tags.find(t => t.id === tag)?.page ?? 0;
}

function restartThread(t: TtmThread): void {
  const { slot, sceneSlot, sceneTag, sceneIterations, tagPage } = t;
  Object.assign(t, makeThread(slot), { isRunning: 1, sceneSlot, sceneTag, sceneIterations, tagPage, page: tagPage });
}
```

In `adsStopScene`, delete the `state.lingeringLayers.push(t.layer);` line.

Replace the whole `adsTick` function (and the `// ------- per-frame tick` comment above it stays) with:

```ts
export function adsTick(state: AdsState, env: TtmEnv, palette: Palette, display: Display): number {
  for (const t of state.threads) {
    if (t.isRunning === 1 && !t.slot.ttm) {
      console.warn(`[ADS] pre-tick sweep: freeing leaked nil-slot thread slot=${t.sceneSlot} tag=${t.sceneTag} timer=${t.timer}`);
      t.isRunning = 0;
    }
  }

  for (const t of state.threads) {
    if (t.isRunning === 1) runThread(env, t);
  }
  activatePendingPalette(env, palette);
  resetDrawClip(env.draw);

  let mini = 300;
  if (state.walkCtx && !state.walkCtx.done) mini = Math.min(mini, state.walkCtx.timer);
  for (const t of state.threads) {
    if (t.isRunning) mini = Math.min(mini, t.timer);
  }
  mini = mini === 300 ? 1 : Math.max(1, mini);

  const wc = state.walkCtx;
  if (wc && !wc.done) {
    wc.timer -= mini;
    if (wc.timer <= 0) {
      wc.timer = walkAnimate(wc.ws);
      wc.done = wc.timer === 0;
    }
    if (!wc.done) walkDraw(wc.ws, display, wc.sprites, wc.bgSprites, wc.dx, wc.dy);
  }

  for (const t of state.threads) {
    if (!t.isRunning) continue;
    t.timer -= mini;
    if (t.sceneTimer > 0) {
      t.sceneTimer -= mini;
      if (t.sceneTimer <= 0) t.isRunning = 2;
    }
  }

  for (let i = 0; i < state.threads.length; i++) {
    const t = state.threads[i]!;
    if (!t.isRunning || t.timer > 0) continue;
    if (t.isRunning === 1) {
      advancePage(t);
    } else if (t.sceneIterations > 0) {
      t.sceneIterations--;
      console.log(`[ADS] restart slot=${t.sceneSlot} tag=${t.sceneTag} iters_left=${t.sceneIterations}`);
      restartThread(t);
    } else {
      const slot = t.sceneSlot, tag = t.sceneTag;
      adsStopScene(state, i);
      if (!state.stopRequested) adsPlayTriggeredChunks(state, slot, tag);
    }
  }

  if (state.stopRequested) {
    state.ticksSinceStopRequest++;
    if (state.ticksSinceStopRequest > STOP_REQUEST_GRACE_TICKS) {
      const live = state.threads.filter(t => t.isRunning);
      if (live.length) {
        const desc = live.map(t => `slot=${t.sceneSlot} tag=${t.sceneTag}`).join(', ');
        console.warn(`[ADS] grace expired: force-stopping ${live.length} orphan thread(s): ${desc}`);
        for (let i = 0; i < state.threads.length; i++) {
          if (state.threads[i]!.isRunning) adsStopScene(state, i);
        }
      }
    }
  }

  return mini;
}

function runThread(env: TtmEnv, t: TtmThread): void {
  loadThreadDrawState(t, env.draw);
  const result = runTtmPage(env, t, t.page);
  if (!result.ran) {
    t.isRunning = 2;
    return;
  }
  t.replay = true;
  if (result.delay !== null && result.delay !== t.delay) {
    t.delay = result.delay;
    t.timer = result.delay;
  }
  if (result.purge) {
    t.nextPage = t.tagPage;
    if (t.sceneTimer <= 0) t.isRunning = 2;
  } else if (result.gotoPage !== null) {
    t.nextPage = result.gotoPage;
  }
}

function advancePage(t: TtmThread): void {
  t.timer = t.delay;
  t.replay = false;
  t.page = t.nextPage >= 0 ? t.nextPage : t.page + 1;
  t.nextPage = -1;
}
```

Delete `adsThreadLayers`. Replace `adsPlayWalk` with:

```ts
export function adsPlayWalk(
  state: AdsState,
  archive: ParsedArchive,
  bgSprites: Surface[],
  fromSpot: number, fromHdg: number,
  toSpot: number, toHdg: number,
  dx: number, dy: number,
): void {
  const raw = archive.byName.get('JOHNWALK.BMP');
  if (!raw) { console.warn('JOHNWALK.BMP not found'); return; }
  state.walkCtx = {
    ws: walkInit(fromSpot, fromHdg, toSpot, toHdg),
    sprites: decodeBmp(raw.payload).sprites.map(spriteSurface),
    bgSprites,
    dx, dy,
    timer: 0,
    done: false,
  };
}
```

Delete the comments that only described the deleted code: the `// Lingering layers shown...` and `// (a) Advance threads...` blocks went with the old `adsTick`; check `rg -n "lingering|layer" src/ads/scheduler.ts` prints nothing.

- [x] **Action 13: Run the scheduler tests**

Run: `pnpm exec vitest run src/ads`
Expected: all pass (the data test may take up to a minute). A failure names the scene and tick; fix the adapter, not the test.

## Part E: Story, main, and debug page

- [x] **Action 14: Story**

In `src/story/story.ts`:

Replace the imports from `decodeScr` through `clearSavedZones` (the lines importing `decodeScr`, `scheduler`, `island`, `TtmContext`, `ParsedArchive`, `Layer`, `clearSavedZones`) with:

```ts
import { makeAdsState, adsPlayWalk, adsActiveThreadCount, type AdsState } from '../ads/scheduler.js';
import {
  clearBackground, islandAnimate, islandInit, islandRedrawHoliday, showBackground, showScreen,
  type IslandRuntime, type IslandState,
} from '../island/island.js';
import type { Display } from '../gfx/gdi/display.js';
import type { TtmEnv } from '../ttm/page-runner.js';
import type { ParsedArchive } from '../resource/types.js';
import type { Palette } from '../types.js';
```

(keep the `decodeAds`, `story-data`, and `fade` imports). Replace `GameState` with:

```ts
export interface GameState {
  adsState: AdsState;
  islandRt: IslandRuntime | null;
  islandState: IslandState;
  bgAnimTimer: number;
  ttm: TtmEnv;
  display: Display;
  palette: Palette;
  archive: ParsedArchive;
  fadeState: FadeState | null;
}
```

At the end of `buildSequence`, replace the `if (finalSceneForIsland.flags & ISLAND) { ... } else { ... }` block with:

```ts
  if (finalSceneForIsland.flags & ISLAND) {
    const newIslandState = calcIslandFromScene(finalSceneForIsland, state.currentDay, baseIsland);
    game.islandState = newIslandState;
    game.islandRt = islandInit(game.display, game.archive, newIslandState);
    game.bgAnimTimer = 8;
    showBackground(game.display);
  } else {
    game.islandRt = null;
    clearBackground(game.display);
  }
```

In `startScene`, replace everything from `clearSavedZones();` to the end of the function with:

```ts
  game.adsState = makeAdsState(ads, game.archive, scene.adsTagNo);

  game.ttm.islandX = (scene.flags & ISLAND)
    ? game.islandState.xPos + (scene.flags & LEFT_ISLAND ? 272 : 0)
    : 0;
  game.ttm.islandY = (scene.flags & ISLAND) ? game.islandState.yPos : 0;
  game.ttm.keepDrawings = false;
  game.ttm.mirrorNextLoad = false;

  if (scene.dayNo !== 0) game.ttm.device.playSound(17);
```

(the `const ads = decodeAds(raw.payload);` line before it stays; the old `game.adsState = makeAdsState(...)` line is part of the replaced range).

In `storyInit`, replace from `const introRaw = ...` to the closing `}` of its `else` with:

```ts
  if (!skipIntro && showScreen(game.display, game.archive, 'INTRO.SCR')) {
    game.islandRt = null;
    for (const t of game.adsState.threads) t.isRunning = 0;
    state.phase = { kind: 'splash', startMs: performance.now(), fading: false };
  } else {
    buildSequence(state, game);
  }
```

In the `advance` case, change the `adsPlayWalk` argument `game.islandRt.sprites` to `game.islandRt?.sprites ?? []`. In the `playing` watchdog log, change `ip=${t.ip}` to `page=${t.page}`.

Replace `storyAnimateBg` (and its comment) with:

```ts
// Island wave animation — call each game tick with elapsed ticks
export function storyAnimateBg(state: StoryState, game: GameState, elapsed: number): void {
  if (state.phase.kind === 'splash' || !game.islandRt) return;
  game.bgAnimTimer -= elapsed;
  while (game.bgAnimTimer <= 0) {
    islandAnimate(game.islandRt, game.display);
    game.bgAnimTimer += 8;
  }
}

export function storyRedrawHoliday(game: GameState): void {
  if (game.islandRt) islandRedrawHoliday(game.islandRt, game.display);
}
```

- [x] **Action 15: Main loop**

Replace `src/main.ts` with:

```ts
import { fetchData } from './io/fetch-resources.js';
import { parseMap } from './resource/resource-map.js';
import { indexArchive } from './resource/resource-archive.js';
import { decodePal } from './decode/pal.js';
import { decodeAds } from './decode/ads-loader.js';
import { makePalette, setPaletteColors } from './gfx/palette.js';
import { Display } from './gfx/gdi/display.js';
import { makeDrawState } from './gfx/gdi/surface.js';
import { applyFade } from './gfx/fade.js';
import { presentSurface } from './gfx/present.js';
import { makeAdsState, adsTick, adsActiveThreadCount } from './ads/scheduler.js';
import { startLoop } from './engine/loop.js';
import { pumpMs, hasEnoughMs, consumeMs, msPerTick, resetClock } from './engine/clock.js';
import { randomIslandState } from './island/island.js';
import { SCREEN_W, SCREEN_H } from './types.js';
import { GdiDevice } from './ttm/gdi-device.js';
import { makeTtmEnv } from './ttm/page-runner.js';
import { storyInit, storyTick, storyAnimateBg, storyRedrawHoliday, type GameState } from './story/story.js';
import { initSound, playSample } from './audio/sound.js';
import { initSoundIcon } from './ui/sound-icon.js';
import { initFullscreen } from './ui/fullscreen.js';
import { initCrt } from './ui/crt.js';
import { initHud, hudUpdate } from './debug/hud.js';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const controls = initSoundIcon(canvas);
initFullscreen(canvas, controls);
initCrt(canvas, controls);
initHud();
initSound(); // fire-and-forget: pre-fetches WAV bytes; AudioContext created on first icon click

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find(r => r.type === '.PAL')!;
const pal = makePalette();
setPaletteColors(pal, decodePal(palResRaw.payload).colors);

const display = new Display();
display.screenIsB = true;
const draw = makeDrawState();
const device = new GdiDevice(display, draw, archive, {
  playSound: playSample,
  random: () => Math.floor(Math.random() * 0x10000),
});

const adsRaw = archive.list.find(r => r.type === '.ADS')!;

const game: GameState = {
  adsState: makeAdsState(decodeAds(adsRaw.payload), archive, 1),
  islandRt: null,
  islandState: randomIslandState(),
  bgAnimTimer: 8,
  ttm: makeTtmEnv(device, draw),
  display,
  palette: pal,
  archive,
  fadeState: null,
};

const params = new URLSearchParams(location.search);
const debugAds = params.get('ads');
const skipIntro = params.get('skipIntro') === 'true';

const storyState = storyInit(archive, game, debugAds, skipIntro);

const img = ctx.createImageData(SCREEN_W, SCREEN_H);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resetClock();
});

let pacedMini = 4; // initial guess before first tick

startLoop(
  () => {
    pumpMs();

    // Advance the engine one mini-step for every mini * 20ms of accumulated
    // wall-clock time.  Matches the DOS game loop: adsPlay() → delay(mini*20).
    // rAF may call us more often than the engine needs; the accumulation gates
    // the actual tick rate so animations don't run too fast.
    while (hasEnoughMs(pacedMini * msPerTick())) {
      consumeMs(pacedMini * msPerTick());
      storyTick(storyState, game);
      storyAnimateBg(storyState, game, pacedMini);
      pacedMini = adsTick(game.adsState, game.ttm, pal, display);
      storyRedrawHoliday(game);
      display.restorePass(0);
    }
  },
  () => {
    presentSurface(img.data, display.window, pal);
    if (game.fadeState) applyFade(img.data, game.fadeState);
    ctx.putImageData(img, 0, 0);
    hudUpdate(adsActiveThreadCount(game.adsState), storyState.currentScene?.adsName ?? '-');
  },
);
```

- [x] **Action 16: Debug page**

In `src/debug-main.ts`, replace the four imports of `makeLayer`, the old `primitives`, the old `sprite`, and `composite` with:

```ts
import { drawCircle, drawLine, drawRect } from './gfx/gdi/primitives.js';
import { drawSprite, MIRROR, spriteSurface } from './gfx/gdi/sprite.js';
import { makeDrawState, makeSurface, rawIndices } from './gfx/gdi/surface.js';
import { presentSurface } from './gfx/present.js';
```

Replace the `demoBtn.addEventListener('click', ...)` handler with:

```ts
demoBtn.addEventListener('click', () => {
  const scr = decodeScr(archive.list.find(r => r.type === '.SCR')!.payload);
  const sprites = decodeBmp(archive.list.find(r => r.type === '.BMP')!.payload).sprites;
  const surface = makeSurface();
  surface.pixels.set(rawIndices(scr.indexed).subarray(0, surface.pixels.length));
  const draw = makeDrawState();
  draw.foreground = 5;
  draw.background = 12;
  drawLine(surface, draw, 10, 10, 600, 200);
  drawRect(surface, draw, 50, 50, 100, 80);
  drawCircle(surface, draw, 40, 240, 140);
  const image = spriteSurface(sprites[0]!);
  drawSprite(surface, draw, image, 300, 200);
  drawSprite(surface, draw, image, 400, 200, MIRROR);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  presentSurface(img.data, surface, pal);
  ctx.putImageData(img, 0, 0);
});
```

- [x] **Action 17: Delete the old pipeline**

```bash
git rm src/gfx/layer.ts src/gfx/primitives.ts src/gfx/primitives.test.ts src/gfx/sprite.ts src/gfx/sprite.test.ts src/gfx/clip.ts src/gfx/zone.ts src/gfx/compositor.ts src/ttm/interpreter.ts src/ttm/interpreter.test.ts src/ttm/thread.ts src/ttm/bmp-slots.ts
```

In `src/types.ts`, delete the `Rect` and `Layer` interfaces (keep `Palette`, `Sprite`, `SCREEN_W`, `SCREEN_H`, `TRANSPARENT`).

Run: `rg -n "gfx/(layer|primitives|sprite|clip|zone|compositor)\.js|ttm/(interpreter|thread|bmp-slots)\.js|\bLayer\b|\bRect\b|ttmCtx|holidayLayer|lingering" src`
Expected: no output.

- [x] **Action 18: Type check, test, commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, no data test skipped (check the summary line for skipped files).

```bash
git add -A src
git commit -m "feat(engine): draw through the display model; delete the layer pipeline"
```

## Part F: Browser check

- [ ] **Action 19: Smoke test**

Run in the background: `pnpm dev --port 5173 --strictPort`
Then run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`
Expected: `200`.

Ask the user to open `http://localhost:5173/?skipIntro=true`, then `http://localhost:5173/` (with intro), and `http://localhost:5173/?ads=FISHING.ADS`, and to report:

1. The island, ocean, and clouds show; waves move.
2. Johnny walks between scenes and acts in scenes, with no trails or smears behind moving sprites and no flicker.
3. Scene changes and the wipe look right.
4. Whether magenta pixels (palette color 0, 168 0 168) show anywhere on the ocean (OQ-9).

Wait for the answer. A visual bug goes to the matching layer: a wrong rect or surface in the runner or device is fixed here with a unit test; a bug in a bridge (scheduler pacing, island, walk) is written into its open question (Part G) with what was seen, unless it is a crash or a blank screen, which must be fixed here.

Stop the server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

## Part G: Open questions and findings

- [ ] **Action 20: Resolve OQ-9, OQ-10, OQ-20**

In `docs/re/open-questions.md`, set each to `- **Status:** resolved (chunk 5)` and add a resolution line before it:

- OQ-9: `- **Resolution:** the engine draws every screen through Display.blitScreen (TTM screens, the ocean, INTRO.SCR), opaque with index 0 kept, and src/gfx/present.ts shows index 0 as palette color 0. Browser check (2026-10-17): <what the user reported for point 4 of the smoke test>.` Write the user's answer in place of the angle brackets.
- OQ-10: `- **Resolution:** src/ttm/page-runner.ts reads instructions with readTtmInstruction, runs pages from pageOffsets, and finds goto and page-call targets with pageOfTag (1058:13a9); the scheduler takes a scene's first page from ttm.tags (1050:042a). The old framer and findTtmTag are deleted.`
- OQ-20: `- **Resolution:** the scheduler, island, walk, story, and main loop draw through src/gfx/gdi/ (buffers B and C, dirty rects, restore pass, window). The layer pipeline (src/gfx/layer.ts, primitives.ts, sprite.ts, clip.ts, zone.ts, compositor.ts, src/ttm/interpreter.ts, thread.ts, bmp-slots.ts) and its workarounds (lingeringLayers, clearSavedZones, the zone layer) are deleted. The connections that are not checked yet are OQ-22, OQ-24, OQ-25, OQ-26, and OQ-28.`

Update each one's `Where` line if it names deleted files: point it at the new code.

- [ ] **Action 21: Add OQ-22, OQ-24, OQ-25, OQ-26, OQ-28**

Append to `docs/re/open-questions.md` (in number order with the entries steps 2 and 4 added), filling in real line numbers:

```markdown
### OQ-22: Thread start and pacing in the scheduler adapter

- **Where:** `src/ads/scheduler.ts` (`adsAddScene`, `adsTick`, `runThread`, `advancePage`, `restartThread`)
- **What it does:** a new or restarted thread is reset as `1048:0b3e` does (delay 0, first page = the tag's page from `ttm.tags`) and runs at once. Each tick runs the current page of every running thread (first run, then replays), counts timers down by `mini` (the smallest timer, at least 1 tick), and moves a due thread to its next page with replay off. A purge sends the thread back to its tag page and ends it unless the scene has a time limit; scene time limits count down by `mini` every tick.
- **Original:** `1048:1acb` and `1048:196e` compare due times against a clock instead of counting down; on the due tick the page is replayed once more before the page advances; what a purge does next depends on the node's mode (`+0x2f`); how `1048` picks a scene's first page is not checked.
- **Old guess behind it:** the old scheduler forced delays of at least 4 ticks and averaged `0x2022`. The 1-tick floor replaces that so pages with delay 0 (93 uses) cannot stall the loop.
- **Resolve in:** chunk 6 (ADS interpreter)
- **Status:** open

### OQ-24: Island drawing bridge

- **Where:** `src/island/island.ts`, `src/story/story.ts` (`buildSequence`, `storyInit`, `storyRedrawHoliday`)
- **What it does:** draws the ocean, raft, clouds, island, first waves, and holiday sprite into C when a sequence starts, then copies C to B and marks the whole screen `(B → A, age 0)`. Every 8 ticks a wave is drawn on B with rects `(B → A, 0)` and `(B → C, 0)`. The holiday sprite is redrawn on B when its rect overlaps a `(B → A, age 0)` rect. Scenes off the island start from a C cleared to index 0; `INTRO.SCR` is drawn into C.
- **Original:** `1010:040e` (waves and island bits), `1010:1e50` (holiday), and the island setup; which surfaces and rects they use is not checked.
- **Resolve in:** chunk 7 (story and island)
- **Status:** open

### OQ-25: Walk drawing bridge

- **Where:** `src/walk/walk.ts` (`walkDraw`), `src/ads/scheduler.ts` (`adsTick`)
- **What it does:** the current walk frame is drawn on B every tick with the TTM sprite rects (`(x, y, w, h + 2)` into `(B → A, 0)`, `(B → A, 1)`, `(C → B, 0)`), and the palm is drawn over Johnny when he is behind it.
- **Original:** walking is driven from `1048` (chunk 8); its draw calls and rects are not checked.
- **Resolve in:** chunk 8 (walking)
- **Status:** open

### OQ-26: Random numbers come from Math.random

- **Where:** `src/main.ts` (`GdiDevice` hook `random`), `src/ads/scheduler.ts` (`adsRandomPickOp`), `src/island/island.ts`, `src/story/story.ts`
- **What it does:** draws 16-bit values (and fractions) from `Math.random`.
- **Original:** `1018:1e60` with its own seed; the sequence decides delays of `0x2022`, ADS random picks, and island choices.
- **Resolve in:** chunk 7 (story and island)
- **Status:** open

### OQ-28: Engine tick order

- **Where:** `src/main.ts` (the loop)
- **What it does:** `storyTick`, `storyAnimateBg` (waves, with the previous tick's elapsed time), `adsTick`, `storyRedrawHoliday`, `display.restorePass(0)`. Sound 25 and `1048:0766` have no counterpart.
- **Original:** `1018:06bf`: `1010:040e(0)`, ..., `1048:1acb`, `1048:0766`, `1010:1e50(0)`, sound 25 when due, `1060:03d3(0)`.
- **Resolve in:** chunk 7 (story and island)
- **Status:** open
```

If the browser check found a bridge problem, add what was seen to that entry's `What it does`.

- [ ] **Action 22: ADS side in the findings**

In `docs/re/ttm.md`, `ADS side`, add: `- Ours: src/ads/scheduler.ts runs pages through runTtmPage with the thread's draw state loaded (loadThreadDrawState) and reset after all threads (resetDrawClip), activates the pending palette after all threads (1050:0799), and paces with countdown timers (OQ-22).`

- [ ] **Action 23: Commit**

```bash
git add docs/re/open-questions.md docs/re/ttm.md
git commit -m "docs(re): engine wiring, bridges logged"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
