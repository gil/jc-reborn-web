# Step 5: Display Buffers

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-surfaces-and-primitives.md`, `step-003-sprites.md`, `step-004-dirty-rect-lists.md`

**Files:**

- Create: `src/gfx/gdi/display.ts`, `src/gfx/gdi/display.test.ts`, `src/gfx/gdi/display.data.test.ts`
- Modify: `docs/re/graphics.md` (`Display buffers`, checklist), `docs/re/decoders.md` (`Pixels`, last bullet only), `docs/re/open-questions.md` (OQ-9, new entries), `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes:
  - `src/gfx/gdi/surface.ts` (step 2): `interface Surface { width: number; height: number; pixels: Uint8Array }`, `makeSurface(width = 640, height = 480): Surface` (all 0), `rawIndices(indexed: Uint8Array): Uint8Array`.
  - `src/gfx/gdi/dirty.ts` (step 4): `COPY_RECT = 1`, `SAVED_BITS = 4`, `NO_SOURCE = -1`, `class DirtyLists` with `constructor(width, height)`, `add(x, y, w, h, kind, source, target, age, clip: ClipRect | null, saved = 0)`, `restorePass(pairs: ReadonlyArray<readonly [number, number]>, ageAfter: boolean): ReplayEvent[]`, `snapshot()`. `ReplayEvent` is `{ kind: 'copy'; source; target; x; y; w; h }` (pixel units) or `{ kind: 'bits'; target; saved; x; y; w; h }`. `restorePass` replays age-0 lists for each pair in order and, when `ageAfter`, lowers the age of every rect left.
  - `re/fixtures/graphics/restore-table.tsv` (step 4): columns `which`, `source`, `target`; values `-1` (no source), `161` (`A`, `0xA1`), `178` (`B`, `0xB2`), `195` (`C`, `0xC3`).
  - `decodeScr(payload): { width; height; indexed }` (`src/decode/scr.ts`, index 0 stored as `TRANSPARENT`), `hasFixture`, `readFixtureRows`, `hasCorpus`, `loadArchive` (`src/testing/corpus.ts`).
- Produces (`src/gfx/gdi/display.ts`): `SURFACE_A = 0`, `SURFACE_B = 1`, `SURFACE_C = 2`, `RESTORE_PAIRS`, `SINGLE_RESTORE_PAIRS` (both `ReadonlyArray<readonly [number, number]>`), `class Display` with fields `surfaces: Surface[]` (A, B, C), `dirty: DirtyLists`, `source: number` (`1068:1eb6`), `target: number` (`1068:1eb8`), `screenIsB: boolean` (`1068:429e`), and methods `shown(): Surface`, `copyRect(x, y, w, h): void`, `saveRect(id, x, y, w, h): void`, `restoreRect(id, x, y, w, h): void`, `blitScreen(image: Surface, x: number, y: number): void`, `restorePass(which: number): void`.

The model starts in the state `gfx_initDisplay` (`1038:1744`) leaves: three 640 × 480 surfaces of index 0, source and target `A`, `screenIsB` false. `platform_initSaver` (`1008:143c`) then sets `1068:429e` to 1; callers (chunk 5 and 7) set `screenIsB` the same way. This step does not decide which surface TTM threads draw on; that is chunk 5.

## Part A: Read and confirm

- [x] **Action 1: Read the functions**

Read `re/out/functions/` for `1038_06ce`, `1038_07e8`, `1030_01c4_gfx_saveRectBits`, `1030_0250_gfx_restoreRectBits`, `1030_0197`, `1040_0286_gfx_blitPixelRows`, `1040_034e`, and the paint branch of `1008_0fcd_platform_screenSaverProc` (what it blits on `WM_PAINT`). Confirm or correct the overview's "Display buffers" reading, in particular:

1. `1038:06ce(x, y, w, h)`: the early exits, the column widening (`w += 8 - w % 8` even when `w` is already a multiple of 8), the `1068:429e` skip, and that it copies from `1068:1eb6` to `1068:1eb8` at the same `(x, y)`.
2. `1038:07e8(dc, x, y, w, h)`: when it runs, and which surface it presents with and without a paint DC (`1068:2d82`, `1068:2d84`). The model keeps only "which surface the window shows" (`shown()`).
3. `1030:01c4(bufferOffset, bufferSegment, x, y, w, h)` reads the source `1068:1eb6`; `1030:0250(same)` writes the target `1068:1eb8`; buffer size `1030:0197(w, h)`.
4. `1040:0286(buffer, segment, x, y, width, rows)`: opaque `SRCCOPY` at `(x, y)`, index 0 kept as palette color 0 (`1068:2572` cleared). What `1040:034e` returns and why `1030:16d8` calls it.
5. Who calls `1030:01c4` (no direct callers in `re/out/index.tsv`; look for it in the TTM interpreter's tables: `rg -n "01c4" re/out/functions/1058_*.asm`), so chunk 5 knows.

If a reading differs from the code below, follow the binary and say so in the commit message.

## Part B: The display model

- [x] **Action 2: Write the failing test**

Create `src/gfx/gdi/display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COPY_RECT, SAVED_BITS } from './dirty.js';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from './display.js';
import type { Surface } from './surface.js';

const count = (surface: Surface, index: number) => surface.pixels.filter((value) => value === index).length;
const at = (surface: Surface, x: number, y: number) => surface.pixels[y * surface.width + x];

describe('Display', () => {
  it('starts as the original display setup leaves it', () => {
    // SCRANTIC 1038:1744
    const display = new Display();
    expect([display.source, display.target, display.screenIsB]).toEqual([SURFACE_A, SURFACE_A, false]);
    expect(display.surfaces.every((surface) => surface.width === 640 && surface.height === 480 && count(surface, 0) === 640 * 480)).toBe(true);
  });

  it('copies whole 8-pixel columns and always adds one more column', () => {
    // SCRANTIC 1038:06ce
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(3, 0, 5, 1);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(16);
    expect([at(display.surfaces[SURFACE_A]!, 0, 0), at(display.surfaces[SURFACE_A]!, 15, 0), at(display.surfaces[SURFACE_A]!, 16, 0)]).toEqual([7, 7, 0]);
  });

  it('copies nothing from a surface to itself or for an empty rect', () => {
    // SCRANTIC 1038:06ce
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.copyRect(0, 0, 8, 8);
    display.source = SURFACE_B;
    display.copyRect(0, 0, 0, 8);
    display.copyRect(0, 0, 8, 0);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(0);
  });

  it('skips copies into A while B is the screen', () => {
    // SCRANTIC 1038:06ce 1038:07e8
    const display = new Display();
    display.screenIsB = true;
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(0, 0, 8, 8);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(0);
    expect(display.shown()).toBe(display.surfaces[SURFACE_B]);
  });

  it('saves a rect from the source and restores it into the target', () => {
    // SCRANTIC 1030:01c4 1030:0250
    const display = new Display();
    display.surfaces[SURFACE_C]!.pixels[1 * 640 + 2] = 9;
    display.source = SURFACE_C;
    display.saveRect(5, 2, 1, 3, 2);
    display.target = SURFACE_B;
    display.restoreRect(5, 10, 20, 3, 2);
    expect(at(display.surfaces[SURFACE_B]!, 10, 20)).toBe(9);
    expect(count(display.surfaces[SURFACE_B]!, 9)).toBe(1);
  });

  it('blits screens opaque, index 0 included, into the target', () => {
    // SCRANTIC 1040:0286 1030:16d8
    const display = new Display();
    display.surfaces[SURFACE_A]!.pixels.fill(7);
    display.blitScreen({ width: 2, height: 1, pixels: Uint8Array.of(0, 3) }, 4, 4);
    expect([at(display.surfaces[SURFACE_A]!, 4, 4), at(display.surfaces[SURFACE_A]!, 5, 4)]).toEqual([0, 3]);
  });

  it('restores dirty rects from the restore table and puts source and target back', () => {
    // SCRANTIC 1060:03d3 1060:05f9 1038:06ce 1030:0250
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.dirty.add(0, 0, 8, 1, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
    display.surfaces[SURFACE_A]!.pixels[0] = 4;
    display.source = SURFACE_A;
    display.saveRect(1, 0, 0, 1, 1);
    display.dirty.add(30, 40, 1, 1, SAVED_BITS, SURFACE_A, SURFACE_C, 0, null, 1);
    display.target = SURFACE_C;
    display.restorePass(0);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(16);
    expect(at(display.surfaces[SURFACE_C]!, 30, 40)).toBe(4);
    expect([display.source, display.target]).toEqual([SURFACE_A, SURFACE_C]);
    expect(display.dirty.snapshot()).toEqual([]);
  });
});
```

How the restore test works: the copy rect `(0, 0, 8, 1)` becomes column 0, width 1; the pass replays it as `copyRect(0, 0, 8, 1)` from `B` to `A`, which widens to 16 pixels. The saved pixel (index 4 at `A` `(0, 0)`, saved before the copy) is put back at `C` `(30, 40)` by the `(NO_SOURCE, C)` pair.

- [x] **Action 3: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/display.test.ts`
Expected: FAIL, cannot resolve `./display.js`.

- [x] **Action 4: Implement `display.ts`**

Create `src/gfx/gdi/display.ts`:

```ts
import { SCREEN_H, SCREEN_W } from '../../types.js';
import { DirtyLists, NO_SOURCE } from './dirty.js';
import { makeSurface, type Surface } from './surface.js';

export const SURFACE_A = 0;
export const SURFACE_B = 1;
export const SURFACE_C = 2;

export const RESTORE_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [NO_SOURCE, SURFACE_A],
  [SURFACE_B, SURFACE_A],
  [NO_SOURCE, SURFACE_B],
  [SURFACE_C, SURFACE_B],
  [NO_SOURCE, SURFACE_C],
  [SURFACE_A, SURFACE_C],
];

export const SINGLE_RESTORE_PAIRS: ReadonlyArray<readonly [number, number]> = [[SURFACE_B, SURFACE_A]];

interface SavedRect {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export class Display {
  readonly surfaces: Surface[] = [makeSurface(), makeSurface(), makeSurface()];
  readonly dirty = new DirtyLists(SCREEN_W, SCREEN_H);
  source = SURFACE_A;
  target = SURFACE_A;
  screenIsB = false;
  private readonly saved = new Map<number, SavedRect>();

  shown(): Surface {
    return this.surfaces[this.screenIsB ? SURFACE_B : SURFACE_A]!;
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    if (this.source === this.target || w === 0 || h === 0) return;
    w += x % 8;
    x -= x % 8;
    w += 8 - (w % 8);
    if (this.screenIsB && this.target === SURFACE_A) return;
    copyPixels(this.surfaces[this.source]!, x, y, this.surfaces[this.target]!, x, y, w, h);
  }

  saveRect(id: number, x: number, y: number, w: number, h: number): void {
    const rect = { width: w, height: h, pixels: new Uint8Array(w * h) };
    copyPixels(this.surfaces[this.source]!, x, y, rect, 0, 0, w, h);
    this.saved.set(id, rect);
  }

  restoreRect(id: number, x: number, y: number, w: number, h: number): void {
    const rect = this.saved.get(id);
    if (rect) copyPixels(rect, 0, 0, this.surfaces[this.target]!, x, y, w, h);
  }

  blitScreen(image: Surface, x: number, y: number): void {
    copyPixels(image, 0, 0, this.surfaces[this.target]!, x, y, image.width, image.height);
  }

  restorePass(which: number): void {
    const { source, target } = this;
    const pairs = which === 0 ? RESTORE_PAIRS : SINGLE_RESTORE_PAIRS;
    for (const event of this.dirty.restorePass(pairs, which === 0)) {
      this.target = event.target;
      if (event.kind === 'copy') {
        this.source = event.source;
        this.copyRect(event.x, event.y, event.w, event.h);
      } else {
        this.restoreRect(event.saved, event.x, event.y, event.w, event.h);
      }
    }
    this.source = source;
    this.target = target;
  }
}

function copyPixels(from: Surface, fromX: number, fromY: number, to: Surface, toX: number, toY: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = fromX + i;
      const sy = fromY + j;
      const dx = toX + i;
      const dy = toY + j;
      if (sx < 0 || sy < 0 || sx >= from.width || sy >= from.height) continue;
      if (dx < 0 || dy < 0 || dx >= to.width || dy >= to.height) continue;
      to.pixels[dy * to.width + dx] = from.pixels[sy * from.width + sx]!;
    }
  }
}
```

If Action 1 found `1038:07e8` shows a different surface than `screenIsB ? B : A`, change `shown()` and its test to match.

- [x] **Action 5: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/gdi/display.test.ts`
Expected: PASS, 7 tests.

- [x] **Action 6: Write the data test**

Create `src/gfx/gdi/display.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeScr } from '../../decode/scr.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../../testing/corpus.js';
import { NO_SOURCE } from './dirty.js';
import { Display, RESTORE_PAIRS, SINGLE_RESTORE_PAIRS, SURFACE_A, SURFACE_B, SURFACE_C } from './display.js';
import { rawIndices } from './surface.js';

const SURFACE_BY_HARNESS_VALUE = new Map([
  [-1, NO_SOURCE],
  [0xa1, SURFACE_A],
  [0xb2, SURFACE_B],
  [0xc3, SURFACE_C],
]);

describe.skipIf(!hasFixture('graphics/restore-table.tsv'))('restore table matches the original SCRANTIC.SCR', () => {
  it('replays the same surface pairs in the same order', () => {
    // SCRANTIC 1060:03d3 1068:287e 1068:2882
    const rows = readFixtureRows('graphics/restore-table.tsv');
    const pairs = (which: string) =>
      rows.filter(([w]) => w === which).map(([, source, target]) => [SURFACE_BY_HARNESS_VALUE.get(Number(source)), SURFACE_BY_HARNESS_VALUE.get(Number(target))]);
    expect(pairs('0')).toEqual(RESTORE_PAIRS);
    expect(pairs('1')).toEqual(SINGLE_RESTORE_PAIRS);
  });
});

describe.skipIf(!hasCorpus)('every SCR resource blitted by the model', () => {
  it('keeps index 0 opaque where the decoder marks it see-through', () => {
    // SCRANTIC 1040:0286
    const screens = loadArchive().list.filter((resource) => resource.type === '.SCR');
    const zeroPixels = Object.fromEntries(
      screens.map(({ name, payload }) => {
        const { width, height, indexed } = decodeScr(payload);
        const display = new Display();
        display.surfaces[SURFACE_A]!.pixels.fill(15);
        display.blitScreen({ width, height, pixels: rawIndices(indexed) }, 0, 0);
        const shown = display.surfaces[SURFACE_A]!.pixels.subarray(0, width * Math.min(height, 480));
        return [name, shown.filter((index) => index === 0).length];
      }),
    );
    expect(zeroPixels).toMatchSnapshot();
  });
});
```

- [x] **Action 7: Run the data test**

Run: `pnpm exec vitest run src/gfx/gdi/display.data.test.ts`
Expected: PASS. The restore table test fails if `restore-table.tsv` lists more or different pairs than `RESTORE_PAIRS`: then copy the pairs from the fixture into `RESTORE_PAIRS` (mapping `161` → `SURFACE_A`, `178` → `SURFACE_B`, `195` → `SURFACE_C`, `-1` → `NO_SOURCE`) and rerun. The snapshot records how many index-0 pixels each screen shows (chunk 3 counted `INTRO.SCR` 1,894, `ISLETEMP.SCR` 18, `OCEAN00.SCR` 9,917, `OCEAN01.SCR` 9,254, `OCEAN02.SCR` 10,013, others 0; if your numbers differ, find out why before accepting the snapshot).

- [x] **Action 8: Commit**

```bash
git add src/gfx/gdi/display.ts src/gfx/gdi/display.test.ts src/gfx/gdi/display.data.test.ts src/gfx/gdi/__snapshots__
git commit -m "feat(gfx): three-surface display with 8-pixel copies, saved rects, and restore pass"
```

## Part C: Findings

- [x] **Action 9: Write the findings**

In `docs/re/graphics.md`, replace `None yet.` under `Display buffers` with one bullet per claim from Action 1, each starting with its address: the three DCs and bitmaps and their roles as far as the code shows (`A` `1eb4`, `B` `1eb2`, `C` `1eb0`), the source and target globals, `1068:429e` and its two effects, `1038:06ce`, `1038:07e8`, `1030:01c4`, `1030:0250`, `1030:0197`, `1040:0286`, `1040:034e`, the restore table pairs (from `restore-table.tsv`), and the paint path of `1008:0fcd` if Action 1 read it. Say where the model chose something: pixels read from outside the source are 0 in `saveRect`; presenting is whole-frame (`shown()`).

In `docs/re/decoders.md` `Pixels`, replace the last bullet (the OQ-9 pointer) with: "Ours: `src/decode/` maps index 0 to `TRANSPARENT` for screens and bitmaps alike. The graphics model (`src/gfx/gdi/display.ts`, `blitScreen`) draws screens opaque with index 0 kept, as `1040:0286` does; see `docs/re/graphics.md` `Display buffers`."

Checklist rows (real line numbers): `1038:06ce` → `Display.copyRect`, `fixed`; `1038:07e8` → `Display.shown`, `open` (whole-frame present; the entry "The original presents only dirty rects, the model presents whole frames" already exists in `docs/re/open-questions.md`; add `1038:07e8` to its **Where** if it is not named there); `1030:01c4` → `saveRect`, `fixed`; `1030:0250` → `restoreRect`, `fixed`; `1030:0197` → `none (the model stores exact pixels)`, `match`; `1040:0286` → `blitScreen`, `fixed`; `1040:034e` → what fits, `match`.

- [x] **Action 10: Update open questions**

Edit OQ-9 in `docs/re/open-questions.md`:

- **What it does:** keep the current text.
- Add a line: `- **Model:** `src/gfx/gdi/display.ts` (`blitScreen`) draws screens opaque with index 0 kept, as `1040:0286` does. The old layer pipeline still shows index 0 as black or as a lower layer.`
- **Resolve in:** `chunk 5 (TTM interpreter), when the model is wired in; then check in the browser whether palette color 0 shows on the ocean screens (the island may cover those pixels).`

Add (next free OQ number):

```markdown
### OQ-<n>: The graphics model is not wired in

- **Where:** `src/gfx/gdi/` (model) versus `src/gfx/{layer,primitives,sprite,clip,zone,compositor}.ts`, `src/ttm/interpreter.ts`, `src/ttm/thread.ts`, `src/ads/scheduler.ts`, `src/island/island.ts`, `src/walk/walk.ts`, `src/story/story.ts`, `src/main.ts` (old pipeline)
- **What it does:** the running engine draws each TTM thread into its own transparent layer, keeps "saved zones" in one more layer, and composites everything every frame. The original draws into three surfaces and erases with dirty-rect restores (`docs/re/graphics.md`, `Dirty rects`, `Display buffers`).
- **Old guess behind it:** jc_reborn's SDL layer design.
- **Resolve in:** chunk 5 (TTM interpreter): find which surface each opcode draws on and when the restore pass runs, switch the interpreter, island, and walk drawing to `src/gfx/gdi/`, then delete the old pipeline and its workarounds (`lingeringLayers`, `clearSavedZones`, the zone layer)
- **Status:** open (user decision, 2026-10-17: build the model in chunk 4, wire it in chunk 5)
```

- [x] **Action 11: Names and status**

In `scripts/re/names.json`: `1038:06ce` `gfx_copyRect`, `1038:07e8` `gfx_presentRect`, `1030:0197` `gfx_rectBitsSize`, `1040:034e` (name from Action 1). Status `verified` for every in-scope row of this step that is `match` or `fixed`; `1038:07e8` stays `named`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 12: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

```bash
git add docs/re/graphics.md docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk 4 display buffers, OQ-9 settled for the model"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
