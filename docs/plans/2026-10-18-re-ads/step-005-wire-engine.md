# Step 5: Wire the Port into the Engine

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-004-ads-tick.md`

**Files:**

- Modify: `src/walk/walk.ts` (walk context moves here), `src/story/story.ts`, `src/main.ts`, `src/ttm/state.ts` (drop the old scheduler fields from `TtmThread`)
- Delete: `src/ads/scheduler.ts`, `src/ads/opcodes.ts`, `src/ads/scheduler.test.ts`, `src/ads/scheduler.data.test.ts`
- Create: `src/walk/walk.data.test.ts`
- Modify: `src/ads/tick.data.test.ts` (one more test)
- Modify: `docs/re/open-questions.md`, `docs/re/ads.md`

**Interfaces:**

- Consumes: from `src/ads/state.ts`: `makeAdsState(ads, archive, random): AdsState`, `AdsState`, `NO_PAGE`. From `src/ads/tick.ts`: `adsStartSection(state, tag)`, `adsSectionBusy(state, tag): boolean`, `adsTick(state, env, palette, now): boolean`, `adsActiveNodeCount(state): number`. Existing: `walkInit(fromSpot, fromHdg, toSpot, toHdg): WalkState`, `walkAnimate(ws): number` (ticks until the next frame, 0 when done), `walkDraw(ws, display, sprites, bgSprites, dx, dy)` (`src/walk/walk.ts`); `decodeBmp(payload).sprites` (`src/decode/bmp.ts`); `spriteSurface(sprite)` (`src/gfx/gdi/sprite.ts`); `Display` with `window`, `surfaces`, `restorePass(which)`, `screenIsB` (`src/gfx/gdi/display.ts`, `SURFACE_C = 2`); `GdiDevice(display, draw, archive, { playSound, random })`; `storyScenes: { adsName; adsTagNo; ... }[]` (`src/story/story-data.ts`); `hudUpdate(count, scene)` (`src/debug/hud.ts`).
- Produces: `src/walk/walk.ts`: `WalkContext { ws; sprites; bgSprites; dx; dy; timer; done }`, `startWalk(archive, bgSprites, fromSpot, fromHdg, toSpot, toHdg, dx, dy): WalkContext | null`, `walkTick(walk, display): void`. `src/story/story.ts`: `GameState` gains `walk: WalkContext | null` and `random: () => number`; `adsState` becomes the new `AdsState`; new export `storyPlayScene(state, game, now): void`. The engine no longer imports `src/ads/scheduler.ts`.

What changes, and why:

- `1018:06bf` (story step) starts a scene with `1048:0874`, then each step runs `1048:1acb` and asks `1048:0766` whether the scene is still busy; walk entries never run the ADS tick. So the story now starts the section, ticks the ADS only while a scene plays, and ends the scene when the section is no longer busy, checked right after the tick (`storyPlayScene`).
- The walk was driven from inside the old scheduler. It is not ADS code in the original; it moves to `src/walk/walk.ts` and is ticked by the main loop while the story walks. Its drawing does not change (OQ-25).
- The clock: the old loop paced itself with `mini`. The port compares due times with a clock. Until chunk 7 reads the original's timing, the engine ticks once per 20 ms and uses the tick count as the clock (OQ-29).
- The straggler and residual sweeps around walks (OQ-4, OQ-5), the nil-slot sweep (OQ-2), and the grace period after `END` (OQ-3) have no counterpart in the original and are deleted with the old scheduler.

## Part A: Walk

- [ ] **Action 1: Write the failing walk test**

Create `src/walk/walk.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Display, SURFACE_C } from '../gfx/gdi/display.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { startWalk, walkTick } from './walk.js';

describe.skipIf(!hasCorpus)('walk on the real data', () => {
  it('keeps Johnny on screen on every tick, through the rest that ends a walk', () => {
    const archive = loadArchive();
    const display = new Display();
    display.screenIsB = true;
    const walk = startWalk(archive, [], 0, 0, 0, 0, 0, 0)!;
    const shown = () => display.window.pixels.some((index, p) => index !== display.surfaces[SURFACE_C]!.pixels[p]);
    let ticks = 0;
    while (!walk.done) {
      walkTick(walk, display);
      display.restorePass(0);
      expect(shown(), `tick ${ticks}`).toBe(true);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(1);
  });
});
```

Run: `fnm use`, then `pnpm exec vitest run src/walk/walk.data.test.ts`
Expected: FAIL, `startWalk` is not exported.

- [ ] **Action 2: Move the walk context into the walk module**

In `src/walk/walk.ts`, add these imports next to the existing ones:

```ts
import { decodeBmp } from '../decode/bmp.js';
import type { ParsedArchive } from '../resource/types.js';
```

and add `spriteSurface` to the existing `import { drawSprite, MIRROR } from '../gfx/gdi/sprite.js';` line. Then add, after `walkDraw`:

```ts
export interface WalkContext {
  ws: WalkState;
  sprites: Surface[];
  bgSprites: Surface[];
  dx: number;
  dy: number;
  timer: number;
  done: boolean;
}

export function startWalk(
  archive: ParsedArchive,
  bgSprites: Surface[],
  fromSpot: number, fromHdg: number,
  toSpot: number, toHdg: number,
  dx: number, dy: number,
): WalkContext | null {
  const raw = archive.byName.get('JOHNWALK.BMP');
  if (!raw) {
    console.warn('JOHNWALK.BMP not found');
    return null;
  }
  return {
    ws: walkInit(fromSpot, fromHdg, toSpot, toHdg),
    sprites: decodeBmp(raw.payload).sprites.map(spriteSurface),
    bgSprites,
    dx,
    dy,
    timer: 0,
    done: false,
  };
}

export function walkTick(walk: WalkContext, display: Display): void {
  if (walk.done) return;
  walk.timer--;
  if (walk.timer <= 0) {
    walk.timer = walkAnimate(walk.ws);
    walk.done = walk.timer === 0;
  }
  // Drawn on the tick the walk ends too: the story waits out the arrival rest with Johnny on screen.
  walkDraw(walk.ws, display, walk.sprites, walk.bgSprites, walk.dx, walk.dy);
}
```

This is the code that ran inside the old `adsTick` (`src/ads/scheduler.ts`, `walkCtx`), counting down 1 per tick instead of `mini`.

- [ ] **Action 3: Run the walk tests**

Run: `pnpm exec vitest run src/walk`
Expected: all PASS.

## Part B: Story and main loop

- [ ] **Action 4: Switch the story to the port**

In `src/story/story.ts`:

1. Replace the import `import { makeAdsState, adsPlayWalk, adsActiveThreadCount, type AdsState } from '../ads/scheduler.js';` with:

```ts
import { makeAdsState, type AdsState } from '../ads/state.js';
import { adsSectionBusy, adsStartSection, adsTick } from '../ads/tick.js';
import { startWalk, type WalkContext } from '../walk/walk.js';
```

2. In `GameState`, add two fields after `adsState: AdsState;`:

```ts
  walk: WalkContext | null;
  random: () => number;
```

3. Replace `startScene` and `sceneIsDone` with:

```ts
function startScene(scene: StoryScene, game: GameState): void {
  console.log(`[STORY] scene ${scene.adsName}[${scene.adsTagNo}] spot${scene.spotStart}→${scene.spotEnd}`);

  const raw = game.archive.byName.get(scene.adsName);
  if (!raw) { console.warn(`ADS not found: ${scene.adsName}`); return; }
  game.adsState = makeAdsState(decodeAds(raw.payload), game.archive, game.random);
  adsStartSection(game.adsState, scene.adsTagNo);

  game.ttm.islandX = (scene.flags & ISLAND)
    ? game.islandState.xPos + (scene.flags & LEFT_ISLAND ? 272 : 0)
    : 0;
  game.ttm.islandY = (scene.flags & ISLAND) ? game.islandState.yPos : 0;
  game.ttm.keepDrawings = false;
  game.ttm.mirrorNextLoad = false;

  if (scene.dayNo !== 0) game.ttm.device.playSound(17);
}

function endScene(state: StoryState): void {
  const scene = state.currentScene!;
  console.log(`[STORY] → advance (scene done: ${scene.adsName}[${scene.adsTagNo}])`);
  if (!(scene.flags & FINAL)) {
    state.prevSpot = scene.spotEnd;
    state.prevHdg = scene.hdgEnd;
  }
  state.phase = { kind: 'advance' };
}

export function storyPlayScene(state: StoryState, game: GameState, now: number): void {
  if (state.phase.kind !== 'playing' || !state.currentScene) return;
  adsTick(game.adsState, game.ttm, game.palette, now);
  if (!adsSectionBusy(game.adsState, state.currentScene.adsTagNo)) endScene(state);
}
```

4. In `storyInit`, delete the line `for (const t of game.adsState.threads) t.isRunning = 0;`.

5. In `storyTickStep`, `case 'advance'`, replace the walk branch (from `console.log(\`[STORY] → walking ...` through `state.phase = { kind: 'walking' };`) with:

```ts
        console.log(`[STORY] → walking spot${state.prevSpot}→${scene.spotStart}`);
        game.walk = startWalk(
          game.archive,
          game.islandRt?.sprites ?? [],
          state.prevSpot, state.prevHdg,
          scene.spotStart, scene.hdgStart,
          game.islandState.xPos, game.islandState.yPos,
        );
        state.phase = { kind: 'walking' };
```

6. Replace `case 'walking'` and `case 'playing'` with:

```ts
    case 'walking': {
      if (game.walk === null || game.walk.done) {
        game.walk = null;
        if (state.currentScene) startScene(state.currentScene, game);
        state.playingTicks = 0;
        state.phase = { kind: 'playing' };
      }
      break;
    }

    case 'playing': {
      state.playingTicks++;
      if (state.playingTicks > 8000) {
        console.warn(`[STORY] WATCHDOG: force-ending ${state.currentScene?.adsName}[${state.currentScene?.adsTagNo}] after ${state.playingTicks} ticks`);
        endScene(state);
      }
      break;
    }
```

The scene's end now comes from `storyPlayScene`, after the ADS tick, as in `1018:06bf`. Checking it inside `storyTickStep` would end every scene before its first tick: a section that was just started is not yet running (`SECTION_RESTART`), and none of its nodes play yet. The watchdog stays (OQ-1, chunk 7).

7. Remove the now unused name imports, if `tsc` reports any.

- [ ] **Action 5: Switch the main loop**

In `src/main.ts`:

1. Replace `import { makeAdsState, adsTick, adsActiveThreadCount } from './ads/scheduler.js';` with:

```ts
import { makeAdsState } from './ads/state.js';
import { adsActiveNodeCount } from './ads/tick.js';
import { walkTick } from './walk/walk.js';
```

and add `storyPlayScene` to the `./story/story.js` import.

2. Replace the device setup and the `game` object:

```ts
const random = () => Math.floor(Math.random() * 0x10000);
const device = new GdiDevice(display, draw, archive, { playSound: playSample, random });

const adsRaw = archive.list.find(r => r.type === '.ADS')!;

const game: GameState = {
  adsState: makeAdsState(decodeAds(adsRaw.payload), archive, random),
  walk: null,
  random,
  islandRt: null,
  islandState: randomIslandState(),
  bgAnimTimer: 8,
  ttm: makeTtmEnv(device, draw),
  display,
  palette: pal,
  archive,
  fadeState: null,
};
```

3. Replace everything from `let pacedMini = 4;` to the end of the file with:

```ts
let now = 0;

startLoop(
  () => {
    pumpMs();
    while (hasEnoughMs(msPerTick())) {
      consumeMs(msPerTick());
      now++;
      storyTick(storyState, game);
      storyAnimateBg(storyState, game, 1);
      if (game.walk) walkTick(game.walk, display);
      storyPlayScene(storyState, game, now);
      storyRedrawHoliday(game);
      display.restorePass(0);
    }
  },
  () => {
    presentSurface(img.data, display.window, pal);
    if (game.fadeState) applyFade(img.data, game.fadeState);
    ctx.putImageData(img, 0, 0);
    hudUpdate(adsActiveNodeCount(game.adsState), storyState.currentScene?.adsName ?? '-');
  },
);
```

- [ ] **Action 6: Delete the old scheduler**

Delete `src/ads/scheduler.ts`, `src/ads/opcodes.ts`, `src/ads/scheduler.test.ts`, and `src/ads/scheduler.data.test.ts` (`git rm`).

The deleted data test pinned three things. The walk part now lives in `src/walk/walk.data.test.ts`. The purged-page redraw is pinned by `src/ads/tick.test.ts` (`replays the page until it is due`) and by the corpus trace. The "plays every story scene" part is the next action.

- [ ] **Action 7: Keep a smoke test of every story scene on the display**

Add to `src/ads/tick.data.test.ts` (a second `describe`, below the trace comparison):

```ts
describe.skipIf(!hasCorpus)('ADS tick on the display', () => {
  it('plays some page in the first 100 ticks of every story scene', { timeout: 120_000 }, () => {
    // SCRANTIC 1048:0874 1048:1acb 1060:03d3
    const archive = loadArchive();
    for (const scene of storyScenes) {
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const random = () => 0x1234;
      const env = makeTtmEnv(new GdiDevice(display, draw, archive, { playSound: () => {}, random }), draw);
      const state = makeAdsState(decodeAds(archive.byName.get(scene.adsName)!.payload), archive, random);
      adsStartSection(state, scene.adsTagNo);
      let ran = false;
      for (let now = 1; now <= 100; now++) {
        if (adsTick(state, env, makePalette(), now)) ran = true;
        display.restorePass(0);
      }
      expect(ran, `${scene.adsName} ${scene.adsTagNo}`).toBe(true);
    }
  });
});
```

with these imports added at the top of the file:

```ts
import { Display } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { storyScenes } from '../story/story-data.js';
import { hasCorpus } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { makeAdsState } from './state.js';
import { adsStartSection, adsTick } from './tick.js';
```

(merge `hasCorpus` into the existing `../testing/corpus.js` import).

- [ ] **Action 8: Drop the old scheduler fields from `TtmThread`**

In `src/ttm/state.ts`, remove these fields from `TtmThread` and from the object `makeThread` returns: `isRunning`, `sceneSlot`, `sceneTag`, `sceneTimer`, `sceneIterations`, `delay`, `timer`, `tagPage`, `page`, `nextPage`, `purged`. Keep `slot`, `replay`, `paletteSlot`, `bmpSlot`, `zoneSlot`, `foreground`, `background`, `clipOn`, `clip`. `AdsNode` (`src/ads/state.ts`) declares its own `delay`, `tagPage`, `page`, `nextPage`, so nothing else changes.

Run: `rg -n "isRunning|sceneSlot|sceneTag|sceneTimer|sceneIterations|walkCtx|adsPlayWalk|adsActiveThreadCount|ADS_ARG_COUNTS|ads/scheduler|ads/opcodes" src`
Expected: no output.

- [ ] **Action 9: Type-check and run every test**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all PASS; `src/ads/tick.data.test.ts` and `src/walk/walk.data.test.ts` run (not skipped).

- [ ] **Action 10: Commit**

```bash
git add -A src
git commit -m "feat(engine): run scenes through the ported ADS tick; delete the old scheduler"
```

## Part C: Browser check

- [ ] **Action 11: Smoke test in the browser**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`.

Ask the user to open `http://localhost:5173/?skipIntro=true` and watch a few scenes, then `http://localhost:5173/?ads=FISHING.ADS&skipIntro=true` (one ADS only), and to report:

- Scenes start, play, and end; Johnny walks between them.
- No scene hangs (the console shows no `WATCHDOG` line) and none ends at once.
- No sprite stays behind after a scene, and scenes with several actors draw them in a sensible order.
- Compared with before this step: same or better.

You cannot see the canvas yourself; do not mark this action done without their answer. Anything wrong: find the cause with the console log (`[STORY]` lines) and the trace test; fix it if it is a port bug (with a unit test), or log it in the matching open question.

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

## Part D: Docs

- [ ] **Action 12: Update the open questions**

In `docs/re/open-questions.md`:

Resolve these (add a `- **Resolution:** ...` line, set `- **Status:** resolved (chunk 6)`, and move each entry to the `Resolved` section):

- OQ-2: nodes exist only for the tags of TTMs that loaded (`1050:042a`; `1048:0079` fails the whole ADS when one TTM is missing), and an instruction naming an unknown node does nothing (`1048:0bf4` returns 0). The sweep went with `src/ads/scheduler.ts`.
- OQ-3: the root cause is the busy check: `1048:0766` does not count a node whose page jumped to itself (self-goto flag, node `[6]`), so a scene with endless goto loops ends anyway. `0xFFFF` ends a section's script; it is not a stop request. The grace period went with `src/ads/scheduler.ts`. `src/ads/tick.ts` `adsSectionBusy`, pinned in `src/ads/tick.test.ts`.
- OQ-4 and OQ-5: `1018:06bf` never runs the ADS tick for a walk entry, so no scene can run during a walk. The engine now ticks the ADS only while a scene plays (`storyPlayScene`), and each scene gets its own ADS state (OQ-30). The sweeps are deleted.
- OQ-11: the scheduler and `ADS_ARG_COUNTS` are deleted; the port frames instructions with `adsArgCount` (`src/ads/state.ts`, `nextInstruction`, `1048:0303`) and runs sections from `decodeAds(...).sections`.
- OQ-12: `makeAdsState` builds each section's scene list (`sectionScenes`) as `1048:040f` does; the original builds them on the first `1048:04fc(slot)`, which the story calls right after the load, so the result is the same.
- OQ-13: `makeAdsState` throws when a listed TTM is missing, as `1048:0079` fails the load. The data never triggers it.
- OQ-22: nodes advance on due times against a clock (`1048:196e`), scenes start through the section scripts, and every section of every ADS matches the original trace (`src/ads/tick.data.test.ts`). The clock itself is OQ-29.

Update these (edit `Where` and `What it does`, keep them open):

- OQ-1: `Where` is now `src/story/story.ts` (`case 'playing'`); it ends the scene through `endScene` without touching ADS state, and counts engine ticks (20 ms each), which are no longer `mini`-paced.
- OQ-25: the walk now lives in `src/walk/walk.ts` (`startWalk`, `walkTick`), ticked once per engine tick by `src/main.ts` while the story walks; its drawing is unchanged.
- OQ-26: ADS random picks (`1048:0cda`) and the device share one source, `game.random` in `src/main.ts` (still `Math.random`).
- OQ-28: the loop is now `storyTick`, `storyAnimateBg(1)`, `walkTick` (walks only), `storyPlayScene` (`adsTick`, then `adsSectionBusy`), `storyRedrawHoliday`, `display.restorePass(0)`.

Add these in the `Workarounds without a known root cause` section, after OQ-28:

```markdown
### OQ-29: One ADS tick per engine tick, with the tick count as the clock

- **Where:** `src/main.ts` (the loop, `now`), `src/engine/clock.ts` (`MS_PER_TICK = 20`)
- **What it does:** runs one story step (and one ADS tick while a scene plays) every 20 ms and passes the number of steps so far as the clock that due times and end times are compared with.
- **Original:** `1008:16c2` adds 1 to the clock `1068:2e70`/`2e72` per timer callback; `1018:06bf` runs from the message loop (`1008:15c8`), so several steps can run per clock tick, or none. The timer rate and how often the story step runs are not checked.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-30: The ADS is loaded fresh for every scene

- **Where:** `src/story/story.ts` (`startScene`)
- **What it does:** builds a new `AdsState` for each scene, so every node starts idle.
- **Original:** `1018:0c62` keeps the loaded ADS when the next scene uses the same ADS id, so nodes keep their modes, and a node of the previous scene that loops on itself can go on playing; it unloads the ADS (`1048:067f`) only when the id changes.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open
```

- [ ] **Action 13: Update the checklist**

In `docs/re/ads.md`, `Side-by-side checklist`: any row that still points at `src/ads/scheduler.ts` gets its new place or `none (reason)`. `1048:0000`, `1048:001b`, `1048:067f`: `none (nothing to free; a new AdsState per scene, OQ-30)`, status `open` for `067f` (OQ-30), `match` for the other two. Add to `Story interface` one bullet saying where the engine calls `adsStartSection`, `adsTick`, and `adsSectionBusy` (`src/story/story.ts`, `startScene` and `storyPlayScene`).

- [ ] **Action 14: Commit**

```bash
git add docs/re/open-questions.md docs/re/ads.md
git commit -m "docs(re): ADS workarounds resolved, engine bridges logged"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
