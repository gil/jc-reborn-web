# Step 5: Display Window and GDI Device

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-004-page-runner.md`

**Files:**

- Modify: `src/gfx/gdi/display.ts`, `src/gfx/gdi/display.test.ts`
- Create: `src/ttm/gdi-device.ts`, `src/ttm/gdi-device.test.ts`, `src/ttm/gdi-device.data.test.ts`
- Modify: `docs/re/graphics.md` (`Display buffers`, last bullet), `docs/re/ttm.md` (`Resources`, checklist), `docs/re/open-questions.md` (OQ-8, OQ-17)

**Interfaces:**

- Consumes:
  - `src/ttm/device.ts` (step 4): `interface TtmDevice { setSurfaces(source, target); setPixel(x, y, color); drawLine(x1, y1, x2, y2); drawRect(x, y, w, h); drawCircle(r, cx, cy); drawSprite(image: Surface, mirroredCopy: boolean, x, y, flags); drawSpriteStretched(image: Surface, x, y, flags, w, h); copyRect(x, y, w, h); addDirtyRect(x, y, w, h, source, target, age); dropDirtyList(source, target, age); saveZone(id, x, y, w, h); restoreZone(id, x, y, w, h); loadScreen(name: string): void; loadBitmaps(name: string, mirroredCopy: boolean): Bitmaps | null; walkBitmaps(): Bitmaps | null; loadPalette(name: string): Uint8Array | null; playSound(sample: number): void; random(): number }` (all numbers; void unless shown).
  - `src/ttm/state.ts` (step 4): `interface Bitmaps { images: Surface[]; mirrored: boolean }`, `makeThread(slot?)`, `makeTtmSlot(id, ttm)`, `loadThreadDrawState(thread, draw)`.
  - `src/ttm/page-runner.ts` (step 4): `makeTtmEnv(device, draw): TtmEnv`, `runTtmPage(env, thread, page): PageResult`.
  - `src/ttm/opcodes.ts` (step 4): `OP.LOAD_SCREEN = 0xf01f`, `OP.LOAD_IMAGE = 0xf02f`, `OP.LOAD_PALETTE = 0xf05f`.
  - Chunk 4: `Display` (`surfaces`, `dirty`, `source`, `target`, `screenIsB`, `shown()`, `copyRect`, `saveRect(id, x, y, w, h)`, `restoreRect(id, x, y, w, h)`, `blitScreen(image, x, y)`, `restorePass(which)`), `COPY_RECT`, `DirtyLists.add(x, y, w, h, kind, source, target, age, clip: ClipRect | null)`, `DirtyLists.drop(source, target, age)`, `DirtyLists.snapshot()`, primitives `setPixel`/`drawLine`/`drawRect`/`drawCircle(surface, state, ...)`, `drawSprite(surface, state, image, x, y, flags, hasMirroredCopy)`, `drawSpriteStretched(surface, state, image, x, y, flags, w, h)`, `spriteSurface(sprite)`, `rawIndices(indexed)`, `makeDrawState()`, `makeSurface(w?, h?)`.
  - Decoders: `decodeScr(payload) → { width, height, indexed }`, `decodeBmp(payload).sprites`, `decodePal(payload).colors` (48 bytes), `decodeTtm(payload) → { pageCount, bytecode, pageOffsets, tags }`, `readTtmInstruction(bytecode, offset) → { opcode, args, text?, next }`.
- Produces (used by step 6):
  - `Display.window: Surface`, painted only by presents. `Display.shown()` returns `window`.
  - `src/ttm/gdi-device.ts`: `interface GdiHooks { playSound(sample: number): void; random(): number }`, `class GdiDevice implements TtmDevice` with `constructor(display: Display, draw: DrawState, archive: ParsedArchive, hooks: GdiHooks)`.

## Background

`docs/re/graphics.md`, `Display buffers`, has the facts this step models:

- `1038:06ce` (`copyRect`) skips the copy when `1068:429e` (`screenIsB`) is set and the target is A, then presents the widened rect either way.
- `1038:07e8` (present, `dc == 0`) runs only when the target is A. It copies the rect to the window from A, or from the copy source when `429e` is set.
- `1030:0250` (`restoreRect`) and `1040:0286` (`blitScreen`) present their rect the same way after drawing.

At runtime `429e` is 1. So nothing ever reaches A, and the window is a fourth picture painted only by presents: each restore pass copies the `(B → A)` dirty rects, which presents them from B. Chunk 4 left `shown()` returning B (OQ-17). This step adds the window so the browser shows exactly what the original window shows.

## Part A: The window

- [ ] **Action 1: Write the failing tests**

In `src/gfx/gdi/display.test.ts`, replace the test `skips copies into A while B is the screen` with:

```ts
  it('skips copies into A while B is the screen, and presents them from the source', () => {
    // SCRANTIC 1038:06ce 1038:07e8
    const display = new Display();
    display.screenIsB = true;
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(0, 0, 8, 8);
    expect(count(display.surfaces[SURFACE_A]!, 7)).toBe(0);
    expect(count(display.window, 7)).toBe(128);
    expect(display.shown()).toBe(display.window);
  });

  it('presents copies into A from A, and nothing for other targets', () => {
    // SCRANTIC 1038:06ce 1038:07e8
    const display = new Display();
    display.surfaces[SURFACE_B]!.pixels.fill(7);
    display.source = SURFACE_B;
    display.copyRect(3, 0, 5, 1);
    expect(count(display.window, 7)).toBe(16);
    display.target = SURFACE_C;
    display.copyRect(0, 10, 8, 1);
    expect(count(display.window, 7)).toBe(16);
  });

  it('presents restored rects and screens drawn into A', () => {
    // SCRANTIC 1030:0250 1040:0286 1038:07e8
    const display = new Display();
    display.blitScreen({ width: 2, height: 1, pixels: Uint8Array.of(5, 3) }, 4, 4);
    expect([at(display.window, 4, 4), at(display.window, 5, 4)]).toEqual([5, 3]);
    display.surfaces[SURFACE_C]!.pixels[0] = 9;
    display.source = SURFACE_C;
    display.saveRect(1, 0, 0, 1, 1);
    display.source = SURFACE_A;
    display.restoreRect(1, 20, 20, 1, 1);
    expect(at(display.window, 20, 20)).toBe(9);
  });
```

In the first test (`starts as the original display setup leaves it`), add after the last `expect`:

```ts
    expect(count(display.window, 0)).toBe(640 * 480);
```

- [ ] **Action 2: Run them to make sure they fail**

Run: `pnpm exec vitest run src/gfx/gdi/display.test.ts`
Expected: FAIL, `display.window` is undefined.

- [ ] **Action 3: Add the window**

In `src/gfx/gdi/display.ts`, add the field after `surfaces`:

```ts
  readonly window = makeSurface();
```

Replace `shown()`, `copyRect`, `restoreRect`, and `blitScreen` with:

```ts
  shown(): Surface {
    return this.window;
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    if (this.source === this.target || w === 0 || h === 0) return;
    w += x % 8;
    x -= x % 8;
    w += 8 - (w % 8);
    if (!(this.screenIsB && this.target === SURFACE_A)) {
      copyPixels(this.surfaces[this.source]!, x, y, this.surfaces[this.target]!, x, y, w, h);
    }
    this.present(x, y, w, h);
  }
```

```ts
  restoreRect(id: number, x: number, y: number, w: number, h: number): void {
    const rect = this.saved.get(id);
    if (!rect) return;
    copyPixels(rect, 0, 0, this.surfaces[this.target]!, x, y, w, h);
    this.present(x, y, w, h);
  }

  blitScreen(image: Surface, x: number, y: number): void {
    copyPixels(image, 0, 0, this.surfaces[this.target]!, x, y, image.width, image.height);
    this.present(x, y, image.width, image.height);
  }
```

Add this private method after `restorePass`:

```ts
  private present(x: number, y: number, w: number, h: number): void {
    if (this.target !== SURFACE_A) return;
    const from = this.surfaces[this.screenIsB ? this.source : SURFACE_A]!;
    copyPixels(from, x, y, this.window, x, y, w, h);
  }
```

- [ ] **Action 4: Run the graphics tests**

Run: `pnpm exec vitest run src/gfx/gdi`
Expected: all pass, data tests and snapshots included (presents only add the window; no surface changes).

- [ ] **Action 5: Update the findings and OQ-17**

In `docs/re/graphics.md`, `Display buffers`, replace the last bullet (starting `Ours: src/gfx/gdi/display.ts keeps three surfaces`) with:

```markdown
- Ours: `src/gfx/gdi/display.ts` keeps three surfaces, the source and target indices, `screenIsB` (`1068:429e`), and a fourth surface `window` that only presents write (`1038:07e8`, called from `copyRect`, `restoreRect`, and `blitScreen` when the target is A). Choices of the model: `saveRect` stores exact pixels under an id instead of a padded buffer, pixels read from outside the source are 0, and the browser shows `window` whole every frame. The window keeps every presented rect until a later present covers it, as the real window does, so what is on screen matches the original even though the browser repaints it all.
```

In `docs/re/open-questions.md`, OQ-17: set `- **Status:** resolved (chunk 5)` and add before it:

```markdown
- **Resolution:** `Display.window` is painted only by presents, rect by rect, from the same source the original uses (`src/gfx/gdi/display.ts`, `present`). Drawing the window whole each frame shows the same picture, so nothing visible is left to model. A wrong dirty rect now shows on screen exactly as it would in the original.
```

- [ ] **Action 6: Commit**

```bash
git add src/gfx/gdi/display.ts src/gfx/gdi/display.test.ts docs/re/graphics.md docs/re/open-questions.md
git commit -m "feat(gfx): window surface painted by presents"
```

## Part B: The GDI device

- [ ] **Action 7: Write the failing unit tests**

Create `src/ttm/gdi-device.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Display, SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeDrawState, makeSurface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import { GdiDevice } from './gdi-device.js';

const emptyArchive: ParsedArchive = { byName: new Map(), list: [] };

function setup() {
  const display = new Display();
  const draw = makeDrawState();
  const sounds: number[] = [];
  const device = new GdiDevice(display, draw, emptyArchive, { playSound: (sample) => sounds.push(sample), random: () => 1234 });
  return { display, draw, device, sounds };
}

describe('GdiDevice', () => {
  it('draws on the target surface with the shared draw state', () => {
    // SCRANTIC 1058:040c 1040:0d54
    const { display, draw, device } = setup();
    device.setSurfaces(SURFACE_B, SURFACE_C);
    draw.foreground = 4;
    device.setPixel(3, 2, 4);
    device.drawLine(0, 10, 4, 10);
    expect(display.surfaces[SURFACE_C]!.pixels[2 * 640 + 3]).toBe(4);
    expect(display.surfaces[SURFACE_C]!.pixels[10 * 640 + 2]).toBe(4);
    expect([display.source, display.target]).toEqual([SURFACE_B, SURFACE_C]);
  });

  it('draws a sprite with the mirrored-copy flag of its list', () => {
    // SCRANTIC 1028:17d8
    const { display, device } = setup();
    const image = makeSurface(2, 2);
    image.pixels.set([1, 2, 3, 4]);
    device.setSurfaces(SURFACE_B, SURFACE_B);
    device.drawSprite(image, true, 0, 0, 3);
    expect([...display.surfaces[SURFACE_B]!.pixels.subarray(0, 2)]).toEqual([2, 1]);
  });

  it('adds kind-1 dirty rects cut to the clip when the clip is on', () => {
    // SCRANTIC 1050:0a85 1060:007e
    const { display, draw, device } = setup();
    draw.clipOn = true;
    draw.clip = { x1: 0, y1: 0, x2: 15, y2: 15 };
    device.addDirtyRect(0, 0, 64, 8, SURFACE_B, SURFACE_A, 0);
    expect(display.dirty.snapshot()[0]![1][0]).toMatchObject({ x: 0, y: 0, w: 2, h: 8, source: SURFACE_B, target: SURFACE_A, age: 0 });
    draw.clipOn = false;
    device.addDirtyRect(0, 100, 64, 8, SURFACE_C, SURFACE_B, 0);
    expect(display.dirty.snapshot()[1]![1][0]).toMatchObject({ x: 0, y: 100, w: 8, h: 8 });
    device.dropDirtyList(SURFACE_C, SURFACE_B, 0);
    expect(display.dirty.snapshot()).toHaveLength(1);
  });

  it('saves a zone from the source and restores it into the target', () => {
    // SCRANTIC 1030:01c4 1030:0250
    const { display, device } = setup();
    display.surfaces[SURFACE_B]!.pixels[0] = 9;
    device.setSurfaces(SURFACE_B, SURFACE_A);
    device.saveZone(12, 0, 0, 1, 1);
    device.setSurfaces(SURFACE_B, SURFACE_C);
    device.restoreZone(12, 5, 5, 1, 1);
    expect(display.surfaces[SURFACE_C]!.pixels[5 * 640 + 5]).toBe(9);
  });

  it('returns null for resources the archive does not have', () => {
    // SCRANTIC 1028:17fa 1040:09eb
    const { device } = setup();
    expect(device.loadBitmaps('NONE.BMP', false)).toBeNull();
    expect(device.walkBitmaps()).toBeNull();
    expect(device.loadPalette('NONE.PAL')).toBeNull();
    expect(() => device.loadScreen('NONE.SCR')).not.toThrow();
  });

  it('passes sounds and random numbers to its hooks', () => {
    // SCRANTIC 1058:0063 1018:1e60
    const { device, sounds } = setup();
    device.playSound(3);
    expect(sounds).toEqual([3]);
    expect(device.random()).toBe(1234);
  });
});
```

The sprite test relies on chunk 4's `drawSprite`: flags 3 (flip and mirror) with a pre-mirrored copy draws only the mirror. If chunk 4's `src/gfx/gdi/sprite.test.ts` says otherwise, follow it and fix the expected row.

- [ ] **Action 8: Write the failing data test**

Create `src/ttm/gdi-device.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readTtmInstruction } from '../decode/ttm-bytecode.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import { Display, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from './gdi-device.js';
import { OP } from './opcodes.js';
import { makeTtmEnv, runTtmPage } from './page-runner.js';
import { loadThreadDrawState, makeThread, makeTtmSlot } from './state.js';

const LOADS = new Set<number>([OP.LOAD_SCREEN, OP.LOAD_IMAGE, OP.LOAD_PALETTE]);

describe.skipIf(!hasCorpus)('GdiDevice on the real data', () => {
  const archive = loadArchive();
  const scripts = archive.list.filter((resource) => resource.type === '.TTM');

  it('finds every resource a TTM script loads, ignoring case', () => {
    // SCRANTIC 1018:1019 1018:195a 1058:06c5 1058:0769 1058:0995
    const missing: string[] = [];
    for (const script of scripts) {
      const { bytecode } = decodeTtm(script.payload);
      for (let offset = 0; offset < bytecode.length; ) {
        const instruction = readTtmInstruction(bytecode, offset);
        offset = instruction.next;
        const name = instruction.text ?? '';
        if (LOADS.has(instruction.opcode) && !archive.byName.has(name.toUpperCase())) missing.push(`${script.name}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('loads a screen onto the target surface', () => {
    // SCRANTIC 1028:1813 1040:0286
    const display = new Display();
    const device = new GdiDevice(display, makeDrawState(), archive, { playSound: () => {}, random: () => 0 });
    device.setSurfaces(SURFACE_B, SURFACE_B);
    device.loadScreen('ocean00.scr');
    expect(display.surfaces[SURFACE_B]!.pixels.some((index) => index !== 0)).toBe(true);
    expect(display.surfaces[SURFACE_C]!.pixels.every((index) => index === 0)).toBe(true);
  });

  it('runs every page of every TTM script on the display, first run and replay', () => {
    // SCRANTIC 1050:074a 1058:040c
    for (const script of scripts) {
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0x1234 });
      const env = makeTtmEnv(device, draw);
      const ttm = decodeTtm(script.payload);
      const thread = makeThread(makeTtmSlot(1, ttm));
      for (let page = 0; page < ttm.pageOffsets.length; page++) {
        for (const replay of [false, true]) {
          thread.replay = replay;
          loadThreadDrawState(thread, draw);
          expect(runTtmPage(env, thread, page).ran, `${script.name} page ${page}`).toBe(true);
        }
        display.restorePass(0);
      }
    }
  });
});
```

- [ ] **Action 9: Run them to make sure they fail**

Run: `pnpm exec vitest run src/ttm/gdi-device.test.ts src/ttm/gdi-device.data.test.ts`
Expected: FAIL, `Cannot find module './gdi-device.js'`.

- [ ] **Action 10: Write the device**

Create `src/ttm/gdi-device.ts`:

```ts
import { decodeBmp } from '../decode/bmp.js';
import { decodePal } from '../decode/pal.js';
import { decodeScr } from '../decode/scr.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import type { Display } from '../gfx/gdi/display.js';
import * as primitives from '../gfx/gdi/primitives.js';
import * as sprites from '../gfx/gdi/sprite.js';
import { rawIndices, type DrawState, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive, RawResource } from '../resource/types.js';
import type { TtmDevice } from './device.js';
import type { Bitmaps } from './state.js';

const WALK_BITMAPS = 'JOHNWALK.BMP';

export interface GdiHooks {
  playSound(sample: number): void;
  random(): number;
}

export class GdiDevice implements TtmDevice {
  private walk: Bitmaps | null | undefined;

  constructor(
    private readonly display: Display,
    private readonly draw: DrawState,
    private readonly archive: ParsedArchive,
    private readonly hooks: GdiHooks,
  ) {}

  setSurfaces(source: number, target: number): void {
    this.display.source = source;
    this.display.target = target;
  }

  setPixel(x: number, y: number, color: number): void {
    primitives.setPixel(this.target(), this.draw, x, y, color);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number): void {
    primitives.drawLine(this.target(), this.draw, x1, y1, x2, y2);
  }

  drawRect(x: number, y: number, w: number, h: number): void {
    primitives.drawRect(this.target(), this.draw, x, y, w, h);
  }

  drawCircle(r: number, cx: number, cy: number): void {
    primitives.drawCircle(this.target(), this.draw, r, cx, cy);
  }

  drawSprite(image: Surface, mirroredCopy: boolean, x: number, y: number, flags: number): void {
    sprites.drawSprite(this.target(), this.draw, image, x, y, flags, mirroredCopy);
  }

  drawSpriteStretched(image: Surface, x: number, y: number, flags: number, w: number, h: number): void {
    sprites.drawSpriteStretched(this.target(), this.draw, image, x, y, flags, w, h);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.display.copyRect(x, y, w, h);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.display.dirty.add(x, y, w, h, COPY_RECT, source, target, age, this.draw.clipOn ? this.draw.clip : null);
  }

  dropDirtyList(source: number, target: number, age: number): void {
    this.display.dirty.drop(source, target, age);
  }

  saveZone(id: number, x: number, y: number, w: number, h: number): void {
    this.display.saveRect(id, x, y, w, h);
  }

  restoreZone(id: number, x: number, y: number, w: number, h: number): void {
    this.display.restoreRect(id, x, y, w, h);
  }

  loadScreen(name: string): void {
    const resource = this.find(name);
    if (!resource) return;
    const screen = decodeScr(resource.payload);
    this.display.blitScreen({ width: screen.width, height: screen.height, pixels: rawIndices(screen.indexed) }, 0, 0);
  }

  loadBitmaps(name: string, mirroredCopy: boolean): Bitmaps | null {
    const resource = this.find(name);
    if (!resource) return null;
    return { images: decodeBmp(resource.payload).sprites.map(sprites.spriteSurface), mirrored: mirroredCopy };
  }

  walkBitmaps(): Bitmaps | null {
    if (this.walk === undefined) this.walk = this.loadBitmaps(WALK_BITMAPS, true);
    return this.walk;
  }

  loadPalette(name: string): Uint8Array | null {
    const resource = this.find(name);
    return resource ? decodePal(resource.payload).colors : null;
  }

  playSound(sample: number): void {
    this.hooks.playSound(sample);
  }

  random(): number {
    return this.hooks.random();
  }

  private target(): Surface {
    return this.display.surfaces[this.display.target]!;
  }

  private find(name: string): RawResource | undefined {
    return this.archive.byName.get(name.toUpperCase());
  }
}
```

Check `src/resource/types.ts` exports the resource type under the name `RawResource`; if it is named differently, import that name.

Step 2's `docs/re/ttm.md`, `Resources`, says how the shared walk list `1068:30d2` is built (when it is loaded and whether with mirrored copies). If it says the list is built without mirrored copies, pass `false` in `walkBitmaps`.

- [ ] **Action 11: Run the tests**

Run: `pnpm exec vitest run src/ttm`
Expected: all pass.

If `finds every resource a TTM script loads` fails, look at the missing names. A name without an extension or with a path means the original's lookup (`1018:1019`, `1018:195a`) does more than ignore case: read those two functions, write what they do in `docs/re/ttm.md`, `Resources`, make `GdiDevice.find` do the same, and add a unit test with the address. Do not add the old interpreter's "append `.SCR` when missing" guess unless the original does it.

If `runs every page` fails, the message names the script and page. Fix the device or the runner, with a unit test.

- [ ] **Action 12: Run everything and commit**

Run: `pnpm exec tsc --noEmit`, then `pnpm test`
Expected: all pass.

```bash
git add src/ttm/gdi-device.ts src/ttm/gdi-device.test.ts src/ttm/gdi-device.data.test.ts
git commit -m "feat(ttm): run TTM pages on the display model"
```

## Part C: Findings

- [ ] **Action 13: OQ-8 and the checklist**

In `docs/re/open-questions.md`, OQ-8: replace the `Where` line's interpreter references with `src/ttm/gdi-device.ts` (`find`), set `- **Status:** resolved (chunk 5)`, and add before it:

```markdown
- **Resolution:** every resource name TTM bytecode loads (`0xf01f`, `0xf02f`, `0xf05f`) exists in the archive when compared in upper case (`src/ttm/gdi-device.data.test.ts`, `finds every resource a TTM script loads`). `GdiDevice` looks names up in upper case, as the original compares them case-insensitively.
```

If Action 11 found names that needed more than upper-casing, write what the lookup does instead.

In `docs/re/ttm.md`, `Resources`, add one bullet: `- Ours: src/ttm/gdi-device.ts loads screens onto the draw target (1028:1813), bitmaps as surface lists (1028:17fa), the shared walk list once (1068:30d2), and palettes as 48 RGB bytes (1040:09eb); names are looked up in upper case.` In `Side-by-side checklist`, add rows (status `fixed`; use real line numbers):

- `1028:1813` → `GdiDevice.loadScreen`.
- `1028:17fa` → `GdiDevice.loadBitmaps`.
- `1040:09eb` → `GdiDevice.loadPalette`.
- `1038:07e8` → `Display.present` (`src/gfx/gdi/display.ts`).

- [ ] **Action 14: Commit**

```bash
git add docs/re/ttm.md docs/re/open-questions.md
git commit -m "docs(re): TTM resource lookup and presents"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
