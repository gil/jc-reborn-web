# Step 3: Sprites

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-surfaces-and-primitives.md`

**Files:**

- Create: `src/gfx/gdi/sprite.ts`, `src/gfx/gdi/sprite.test.ts`, `src/gfx/gdi/sprite.data.test.ts` (and its snapshot under `src/gfx/gdi/__snapshots__/`)
- Modify: `docs/re/graphics.md` (`Sprites`, `Scaling (dead code)`, `Bitmap matrix`, checklist), `docs/re/open-questions.md` (new entries, OQ-14), `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes (from step 2, `src/gfx/gdi/surface.ts`): `interface Surface { width: number; height: number; pixels: Uint8Array }` (raw palette indices, row-major), `interface DrawState { foreground; background; fill; clipOn; clip: ClipRect }`, `makeSurface(width = 640, height = 480): Surface` (all 0), `makeDrawState(): DrawState` (clip off), `activeClip(surface, state): ClipRect`, `plot(surface, clip, x, y, index): void` (drops pixels outside the inclusive clip), `rawIndices(indexed): Uint8Array` (`TRANSPARENT` → 0). From earlier chunks: `Sprite { width; height; indexed }` (`src/types.ts`, index 0 stored as `TRANSPARENT`), `decodeBmp(payload).sprites` (`src/decode/bmp.ts`), the old pipeline's `drawSprite(layer, sprite, x, y)` and `drawSpriteFlip(layer, sprite, x, y)` (`src/gfx/sprite.ts`) and `makeLayer()` (`src/gfx/layer.ts`, a 640 × 480 `indexed` array filled with `TRANSPARENT`), `hasCorpus` and `loadArchive` (`src/testing/corpus.ts`).
- Produces (`src/gfx/gdi/sprite.ts`): `FLIP_VERTICAL = 1`, `MIRROR = 2`, `spriteSurface(sprite: Sprite): Surface`, `drawSprite(surface: Surface, state: DrawState, image: Surface, x: number, y: number, flags = 0, hasMirroredCopy = false): void`, `drawSpriteStretched(surface: Surface, state: DrawState, image: Surface, x: number, y: number, flags: number, width: number, height: number): void`.

How the original blits a sprite (overview, "Sprites"): the mask blit clears the destination where the mask bit is set (index not 0), then the image blit ORs the image in, with index 0 forced to black (0). The net effect on palette indices: index 0 leaves the destination alone, any other index replaces it. Step 1 checked on every image that the mask bit is set exactly where the index is not 0.

## Part A: Read and confirm

- [ ] **Action 1: Read the functions**

Read `re/out/functions/` for `1038_0ae4`, `1038_0ac2`, `1030_03d7`, `1038_0de1`, `1038_0e8a`, `1038_109e`, `1038_1485`, `1038_19c7`, `1028_17d8`, `1040_10ef`, `1040_1113`, `1040_1183`. Ghidra prints Pascal import arguments in reverse (`STRETCHBLT(cs, rop_low, rop_high, srcH, srcW, srcY, srcX, srcDC, h, w, y, x)` reads as `StretchBlt(dc, x, y, w, h, srcDC, srcX, srcY, srcW, srcH, rop)`). Confirm or correct:

1. `1038:0ae4(record, x, y, flags)`: which bitmaps it picks for each flag combination. First reading: `flags & 2` picks the pre-mirrored pair `+10`/`+12`; otherwise `flags & 1` picks nothing (forcing the fallback); otherwise `+2`/`+4`. When the pick is empty it falls back to `+2`/`+4` and applies negative destination extents: `flags & 1` → `y += h, h = -h`; `flags & 2` → `x += w, w = -w`. So with a pre-mirrored pair, flags 3 mirrors and does **not** flip upside down.
2. The two raster ops: `0x220326` (destination AND NOT source) with the mask, `0xEE0086` (`SRCPAINT`) with the image. Clip on around both blits. Dirty rect `(x, y, w, h)` with the unflipped values.
3. `1030:03d7(record, x, y, flags, dw, dh)`: destination `(x, y, dw, dh)`, source `(0, 0, w, h)` with `w` negated for `flags & 2` and `h` for `flags & 1`; always `+2`/`+4`. A negative source extent starting at 0 points left of and above the bitmap; GDI's result there is not in the binary.
4. Scaling: confirm that `1038:0de1`, `1038:109e`, `1038:1485`, `1038:19c7`, `1038:0e8a` only run when the scale-mode bytes `1068:2e74`..`2e77` differ, and that `platform_initSaver` (`1008:143c`) sets all four to 3 and nothing else writes them: `rg -n "\[0x2e7[4-7]\]" re/out/functions/*.asm`.
5. `1028:17d8`: forwards which arguments to `1038:0ae4`; who calls it (`re/out/index.tsv` column 6; also `rg -n "1028:17d8" re/out/functions/*.asm`).
6. `1040:10ef`, `1040:1113`, `1040:1183`: the bitmap matrix state at `1068:45f8`..`1068:4600`; who calls them. Chunk 3 found that no resource has `BMP:MTX:`.

If a reading differs from this list, change the code below to match the binary and note it in the commit message.

## Part B: Sprite blits

- [ ] **Action 2: Write the failing test**

Create `src/gfx/gdi/sprite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from '../../types.js';
import { drawSprite, drawSpriteStretched, FLIP_VERTICAL, MIRROR, spriteSurface } from './sprite.js';
import { makeDrawState, makeSurface, type Surface } from './surface.js';

function image(width: number, height: number, pixels: number[]): Surface {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

function filled(width: number, height: number, index: number): Surface {
  const surface = makeSurface(width, height);
  surface.pixels.fill(index);
  return surface;
}

function rows(surface: Surface): string[] {
  return Array.from({ length: surface.height }, (_, y) =>
    Array.from(surface.pixels.subarray(y * surface.width, (y + 1) * surface.width), (index) => index.toString(16)).join(''),
  );
}

describe('spriteSurface', () => {
  it('keeps the sprite size and turns see-through pixels back into index 0', () => {
    const surface = spriteSurface({ width: 2, height: 1, indexed: Uint8Array.of(TRANSPARENT, 4) });
    expect([surface.width, surface.height, Array.from(surface.pixels)]).toEqual([2, 1, [0, 4]]);
  });
});

describe('drawSprite', () => {
  it('leaves the destination where the index is 0 and replaces it everywhere else', () => {
    // SCRANTIC 1038:0ae4 (mask AND NOT, image OR) 1040:035c
    const surface = filled(4, 3, 5);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 0, 0, 2]), 1, 1);
    expect(rows(surface)).toEqual(['5555', '5155', '5525']);
  });

  it('mirrors left to right with flag 2', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(4, 1);
    drawSprite(surface, makeDrawState(), image(4, 1, [1, 2, 3, 4]), 0, 0, MIRROR);
    expect(rows(surface)).toEqual(['4321']);
  });

  it('flips upside down with flag 1', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(1, 3);
    drawSprite(surface, makeDrawState(), image(1, 3, [1, 2, 3]), 0, 0, FLIP_VERTICAL);
    expect(rows(surface)).toEqual(['3', '2', '1']);
  });

  it('does both with flag 3 when there is no pre-mirrored copy', () => {
    // SCRANTIC 1038:0ae4
    const surface = makeSurface(2, 2);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 2, 3, 4]), 0, 0, FLIP_VERTICAL | MIRROR);
    expect(rows(surface)).toEqual(['43', '21']);
  });

  it('only mirrors with flag 3 when the image has a pre-mirrored copy', () => {
    // SCRANTIC 1038:0ae4 1040:054e
    const surface = makeSurface(2, 2);
    drawSprite(surface, makeDrawState(), image(2, 2, [1, 2, 3, 4]), 0, 0, FLIP_VERTICAL | MIRROR, true);
    expect(rows(surface)).toEqual(['21', '43']);
  });

  it('honors the clip', () => {
    // SCRANTIC 1038:0ae4 1038:1ade
    const surface = makeSurface(3, 1);
    const state = { ...makeDrawState(), clipOn: true, clip: { x1: 1, y1: 0, x2: 1, y2: 0 } };
    drawSprite(surface, state, image(3, 1, [7, 8, 9]), 0, 0);
    expect(rows(surface)).toEqual(['080']);
  });
});

describe('drawSpriteStretched', () => {
  it('scales the image to the given size', () => {
    // SCRANTIC 1030:03d7
    const surface = makeSurface(4, 2);
    drawSpriteStretched(surface, makeDrawState(), image(2, 1, [1, 2]), 0, 0, 0, 4, 2);
    expect(rows(surface)).toEqual(['1122', '1122']);
  });

  it('mirrors with flag 2 while scaling', () => {
    // SCRANTIC 1030:03d7
    const surface = makeSurface(4, 1);
    drawSpriteStretched(surface, makeDrawState(), image(2, 1, [1, 2]), 0, 0, MIRROR, 4, 1);
    expect(rows(surface)).toEqual(['2211']);
  });
});
```

- [ ] **Action 3: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/sprite.test.ts`
Expected: FAIL, cannot resolve `./sprite.js`.

- [ ] **Action 4: Implement `sprite.ts`**

Create `src/gfx/gdi/sprite.ts`:

```ts
import type { Sprite } from '../../types.js';
import { activeClip, plot, rawIndices, type ClipRect, type DrawState, type Surface } from './surface.js';

export const FLIP_VERTICAL = 1;
export const MIRROR = 2;

export function spriteSurface(sprite: Sprite): Surface {
  return { width: sprite.width, height: sprite.height, pixels: rawIndices(sprite.indexed) };
}

export function drawSprite(
  surface: Surface,
  state: DrawState,
  image: Surface,
  x: number,
  y: number,
  flags = 0,
  hasMirroredCopy = false,
): void {
  const mirror = (flags & MIRROR) !== 0;
  const flipVertical = (flags & FLIP_VERTICAL) !== 0 && !(mirror && hasMirroredCopy);
  blit(surface, activeClip(surface, state), image, x, y, image.width, image.height, mirror, flipVertical);
}

export function drawSpriteStretched(
  surface: Surface,
  state: DrawState,
  image: Surface,
  x: number,
  y: number,
  flags: number,
  width: number,
  height: number,
): void {
  blit(surface, activeClip(surface, state), image, x, y, width, height, (flags & MIRROR) !== 0, (flags & FLIP_VERTICAL) !== 0);
}

function blit(
  surface: Surface,
  clip: ClipRect,
  image: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror: boolean,
  flipVertical: boolean,
): void {
  for (let j = 0; j < height; j++) {
    const row = Math.floor((j * image.height) / height);
    const sourceY = flipVertical ? image.height - 1 - row : row;
    for (let i = 0; i < width; i++) {
      const column = Math.floor((i * image.width) / width);
      const sourceX = mirror ? image.width - 1 - column : column;
      const index = image.pixels[sourceY * image.width + sourceX]!;
      if (index !== 0) plot(surface, clip, x + i, y + j, index);
    }
  }
}
```

- [ ] **Action 5: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/gdi/sprite.test.ts`
Expected: PASS, 9 tests.

- [ ] **Action 6: Commit**

```bash
git add src/gfx/gdi/sprite.ts src/gfx/gdi/sprite.test.ts
git commit -m "feat(gfx): sprite blit, mirror, flip, and stretch as the original draws them"
```

## Part C: Corpus checks

- [ ] **Action 7: Write the data test**

Create `src/gfx/gdi/sprite.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../decode/bmp.js';
import { hasCorpus, loadArchive } from '../../testing/corpus.js';
import { SCREEN_W, TRANSPARENT } from '../../types.js';
import { makeLayer } from '../layer.js';
import { drawSprite as drawLayerSprite, drawSpriteFlip as drawLayerSpriteFlip } from '../sprite.js';
import { drawSprite, FLIP_VERTICAL, MIRROR, spriteSurface } from './sprite.js';
import { makeDrawState, makeSurface } from './surface.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

describe.skipIf(!hasCorpus)('every BMP image drawn by the model', () => {
  it('keeps its pixels for flags 0, 1, 2, and 3', () => {
    // SCRANTIC 1038:0ae4
    const hashes = Object.fromEntries(
      bitmaps().map(({ name, payload }) => {
        const hash = createHash('sha256');
        for (const sprite of decodeBmp(payload).sprites) {
          const image = spriteSurface(sprite);
          for (const flags of [0, FLIP_VERTICAL, MIRROR, FLIP_VERTICAL | MIRROR]) {
            const surface = makeSurface(sprite.width, sprite.height);
            drawSprite(surface, makeDrawState(), image, 0, 0, flags);
            hash.update(surface.pixels);
          }
        }
        return [name, hash.digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });

  it('matches the old layer pipeline for plain and mirrored sprites', () => {
    // SCRANTIC 1038:0ae4
    const wrong = bitmaps().flatMap(({ name, payload }) =>
      decodeBmp(payload).sprites.flatMap((sprite, i) => {
        if (sprite.width > SCREEN_W) return [];
        return [0, MIRROR].flatMap((flags) => {
          const layer = makeLayer();
          (flags ? drawLayerSpriteFlip : drawLayerSprite)(layer, sprite, 0, 0);
          const surface = makeSurface();
          drawSprite(surface, makeDrawState(), spriteSurface(sprite), 0, 0, flags);
          const same = surface.pixels.every((index, p) => index === (layer.indexed[p] === TRANSPARENT ? 0 : layer.indexed[p]));
          return same ? [] : [`${name}#${i} flags ${flags}`];
        });
      }),
    );
    expect(wrong).toEqual([]);
  });
});
```

- [ ] **Action 8: Run it**

Run: `pnpm exec vitest run src/gfx/gdi/sprite.data.test.ts`
Expected: PASS; the first run writes `src/gfx/gdi/__snapshots__/sprite.data.test.ts.snap` with 117 entries. If the second test fails, the old pipeline differs from the model for plain or mirrored sprites: list the failing images in an open question for chunk 5 (do not change the old pipeline), and change the test to `expect(wrong).toMatchSnapshot()` so the known list is pinned.

- [ ] **Action 9: Commit**

```bash
git add src/gfx/gdi/sprite.data.test.ts src/gfx/gdi/__snapshots__
git commit -m "test(gfx): sprite model snapshot and old pipeline check on every bitmap"
```

## Part D: Findings

- [ ] **Action 10: Write the findings**

In `docs/re/graphics.md`, replace `None yet.` under `Sprites`, `Scaling (dead code)`, and `Bitmap matrix` with one bullet per claim from Action 1, each starting with its address. Include: the record fields `0ae4` reads; the flag rules, including flags 3 with a pre-mirrored copy; the two raster ops and what they do to palette indices (index 0 keeps the destination); clip and dirty rect; `1038:0ac2` = flags 0; `1028:17d8`; `1030:03d7` and its negative source extents; every scaling function and why it never runs; the matrix functions and why they never run on this data.

Checklist rows (real line numbers): `1038:0ae4` → `src/gfx/gdi/sprite.ts` `drawSprite`, `open` (mirror/flip pixel placement, see below); `1038:0ac2` → `drawSprite` with flags 0, `match`; `1030:03d7` → `drawSpriteStretched`, `open`; `1028:17d8` → `none (forwarder)`, `match`; `1038:0de1`, `1038:0e8a`, `1038:109e`, `1038:1485`, `1038:19c7` → `none (scale modes are all 3, never runs)`, `match`; `1040:10ef`, `1040:1113`, `1040:1183` → `none (no BMP:MTX: in the data)`, `match`.

- [ ] **Action 11: Log open questions**

Add to `docs/re/open-questions.md` (next free OQ numbers):

```markdown
### OQ-<n>: Where GDI puts a mirrored or flipped sprite

- **Where:** `src/gfx/gdi/sprite.ts` (`drawSprite` with flags 1 or 2, `drawSpriteStretched`)
- **What it does:** draws the mirrored or flipped image into exactly the same rect as the plain one.
- **Original:** `1038:0ae4` mirrors through a pre-mirrored copy (only `JOHNWALK.BMP`, built by `1040:054e`, which lands exactly in place) or through a negative `StretchBlt` destination extent (`x + w` with width `-w`). Whether Windows 3.1 maps a negative extent to the same pixels or one pixel off is GDI behavior, not in the binary.
- **Resolve in:** only with a reference capture from Windows 3.1
- **Status:** open

### OQ-<n>: Stretched sprites: negative source extents and shrink rule

- **Where:** `src/gfx/gdi/sprite.ts` (`drawSpriteStretched`)
- **What it does:** nearest pixel, mirrored or flipped inside the image.
- **Original:** `1030:03d7` negates the source width or height with the source origin left at 0, which points outside the bitmap, and shrinking uses the DC's stretch mode (default `BLACKONWHITE`). Both are GDI behavior.
- **Resolve in:** chunk 5: find which TTM opcode calls `1030:03d7`, with which flags and sizes in the data; if flags are never set and sizes only grow, close this
- **Status:** open
```

Edit OQ-14: `1028:17d8` forwards to `1038:0ae4` (findings in `docs/re/graphics.md` `Sprites`); with steps 1 and 3 done, all three forwarders are settled; the return-0 stub group stays for chunk 5. If OQ-14 now only covers the stub group, rewrite its **Where** and **Resolve in** to say so.

- [ ] **Action 12: Names and status**

In `scripts/re/names.json`: name `1038:0ae4` `gfx_drawSprite`, `1038:0ac2` `gfx_drawSpritePlain`, `1030:03d7` `gfx_drawSpriteStretched`, `1028:17d8` `gfx_callDrawSprite`, `1038:0de1` `gfx_rescaleSprite`, `1038:109e` `gfx_doubleBitmap`, `1038:1485` `gfx_halveBitmap`, `1038:19c7` `gfx_rescaleDisplay`, `1038:0e8a`, `1040:10ef`, `1040:1113`, `1040:1183` with names that fit what you read. Status `verified` for every row that is `match` or `fixed`; `named` for `open` rows.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 13: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

```bash
git add docs/re/graphics.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk 4 sprites, scaling, and bitmap matrix"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
