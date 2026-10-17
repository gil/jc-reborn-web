# Step 2: Surfaces and Primitives

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-colors-and-bitmap-masks.md`

**Files:**

- Create: `src/gfx/gdi/surface.ts`, `src/gfx/gdi/surface.test.ts`, `src/gfx/gdi/primitives.ts`, `src/gfx/gdi/primitives.test.ts`
- Modify: `docs/re/graphics.md` (`Surfaces and clip`, `Primitives`, `Text`, checklist), `docs/re/open-questions.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes: `colorIndex(color: number): number` and `brushColorAt(color: number, x: number, y: number): number` from `src/gfx/gdi/color.ts` (step 1). `colorIndex` keeps `color & 0x0f`. `brushColorAt` returns `color` itself below 16, and from 16 on a checkerboard of the two nibbles: on odd screen rows the high nibble is at even columns, on even rows the low nibble is. `SCREEN_W = 640`, `SCREEN_H = 480`, `TRANSPARENT = 0xff` from `src/types.ts`.
- Produces:
  - `src/gfx/gdi/surface.ts`: `interface Surface { width: number; height: number; pixels: Uint8Array }` (raw indices, row-major), `interface ClipRect { x1: number; y1: number; x2: number; y2: number }` (inclusive), `interface DrawState { foreground: number; background: number; fill: boolean; clipOn: boolean; clip: ClipRect }`, `makeSurface(width = SCREEN_W, height = SCREEN_H): Surface` (all 0), `makeDrawState(): DrawState`, `activeClip(surface: Surface, state: DrawState): ClipRect`, `plot(surface: Surface, clip: ClipRect, x: number, y: number, index: number): void`, `rawIndices(indexed: Uint8Array): Uint8Array` (`TRANSPARENT` → 0).
  - `src/gfx/gdi/primitives.ts`: `setPixel(surface, state, x, y, color)`, `drawLine(surface, state, x1, y1, x2, y2)`, `drawRect(surface, state, x, y, w, h)`, `drawCircle(surface, state, r, cx, cy)`. All take `(surface: Surface, state: DrawState, ...numbers)` and return `void`.

There is no Unicorn work here: every primitive is a handful of GDI calls (side-by-side review only, per `scripts/re/unicorn/README.md`). The overview's "Primitives" section lists the first reading of each call. GDI rules used (Windows behavior, not the binary): a rect `(left, top, right, bottom)` covers `left..right - 1` and `top..bottom - 1`; `LineTo` leaves out its end point; a 1-pixel pen draws `Rectangle` and `Ellipse` borders inside the rect; the clip region limits every pixel.

## Part A: Read and confirm

- [x] **Action 1: Read the functions**

Read `re/out/functions/` pseudo-C and assembly for `1038_1744_gfx_initDisplay`, `1038_194e`, `1038_1ade`, `1040_0d54_gfx_drawPixel`, `1030_02ef_gfx_drawLine`, `1038_1bd8_gfx_drawRect`, `1040_0688_gfx_drawCircle`, `1030_04ee`, `1030_04ce`, `1030_0765`. Remember Ghidra prints Pascal import arguments in reverse. Confirm or correct, for each, the overview's first reading: argument order, which color each uses (foreground `1068:1eae`, background `1068:1ead`, own argument), when the clip is applied (`1038:1ade` before and after), the outline/fill/`PATCOPY` rule of `1038:1bd8`, the `Ellipse` rect of `1040:0688`, and the dirty-rect arguments each passes to `1038:07e8`. If something differs, change the code below to match the binary before writing it, and note the difference in the commit message.

Also find who writes the state the primitives read, so chunk 5 knows where to look:

Run: `rg -n "\[0x1ea[0-9a-f]\]|\[0x1eac\]|\[0x1ead\]|\[0x1eae\]" re/out/functions/*.asm`
Expected: writers in `1038:1744`, `1010:0136`, `1010:04a2`, `1010:1551`, `1048:1acb`, `1048:1e5a`, `1058:040c`, `1058:0144`. List them in the `Surfaces and clip` findings (one bullet: "set by ..., read in chunk 5/6/7").

## Part B: Surface and draw state

- [x] **Action 2: Write the failing surface test**

Create `src/gfx/gdi/surface.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TRANSPARENT } from '../../types.js';
import { activeClip, makeDrawState, makeSurface, plot, rawIndices } from './surface.js';

describe('makeDrawState', () => {
  it('starts like the original display setup: colors 0, fill on, clip off over the whole screen', () => {
    // SCRANTIC 1038:1744
    expect(makeDrawState()).toEqual({
      foreground: 0,
      background: 0,
      fill: true,
      clipOn: false,
      clip: { x1: 0, y1: 0, x2: 639, y2: 479 },
    });
  });
});

describe('makeSurface', () => {
  it('is 640x480 filled with index 0', () => {
    // SCRANTIC 1038:1744
    const surface = makeSurface();
    expect([surface.width, surface.height, surface.pixels.length]).toEqual([640, 480, 640 * 480]);
    expect(surface.pixels.every((index) => index === 0)).toBe(true);
  });
});

describe('activeClip', () => {
  it('is the whole surface while the clip is off', () => {
    // SCRANTIC 1038:1ade
    const state = { ...makeDrawState(), clip: { x1: 10, y1: 20, x2: 30, y2: 40 } };
    expect(activeClip(makeSurface(), state)).toEqual({ x1: 0, y1: 0, x2: 639, y2: 479 });
  });

  it('is the inclusive clip rect, cut to the surface, while the clip is on', () => {
    // SCRANTIC 1038:1ade
    const state = { ...makeDrawState(), clipOn: true, clip: { x1: -5, y1: 20, x2: 700, y2: 40 } };
    expect(activeClip(makeSurface(), state)).toEqual({ x1: 0, y1: 20, x2: 639, y2: 40 });
  });
});

describe('plot', () => {
  it('writes inside the clip and drops everything outside', () => {
    const surface = makeSurface(4, 4);
    const clip = { x1: 1, y1: 1, x2: 2, y2: 2 };
    plot(surface, clip, 1, 1, 7);
    plot(surface, clip, 2, 2, 7);
    plot(surface, clip, 0, 1, 7);
    plot(surface, clip, 3, 2, 7);
    expect(Array.from(surface.pixels)).toEqual([0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0]);
  });
});

describe('rawIndices', () => {
  it('turns the decoders see-through marker back into index 0', () => {
    expect(Array.from(rawIndices(Uint8Array.of(3, TRANSPARENT, 0)))).toEqual([3, 0, 0]);
  });
});
```

- [x] **Action 3: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/surface.test.ts`
Expected: FAIL, cannot resolve `./surface.js`.

- [x] **Action 4: Implement `surface.ts`**

Create `src/gfx/gdi/surface.ts`:

```ts
import { SCREEN_H, SCREEN_W, TRANSPARENT } from '../../types.js';

export interface Surface {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface ClipRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DrawState {
  foreground: number;
  background: number;
  fill: boolean;
  clipOn: boolean;
  clip: ClipRect;
}

export function makeSurface(width = SCREEN_W, height = SCREEN_H): Surface {
  return { width, height, pixels: new Uint8Array(width * height) };
}

export function makeDrawState(): DrawState {
  return {
    foreground: 0,
    background: 0,
    fill: true,
    clipOn: false,
    clip: { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 },
  };
}

export function activeClip(surface: Surface, state: DrawState): ClipRect {
  const whole = { x1: 0, y1: 0, x2: surface.width - 1, y2: surface.height - 1 };
  if (!state.clipOn) return whole;
  return {
    x1: Math.max(whole.x1, state.clip.x1),
    y1: Math.max(whole.y1, state.clip.y1),
    x2: Math.min(whole.x2, state.clip.x2),
    y2: Math.min(whole.y2, state.clip.y2),
  };
}

export function plot(surface: Surface, clip: ClipRect, x: number, y: number, index: number): void {
  if (x < clip.x1 || x > clip.x2 || y < clip.y1 || y > clip.y2) return;
  surface.pixels[y * surface.width + x] = index;
}

export function rawIndices(indexed: Uint8Array): Uint8Array {
  return indexed.map((index) => (index === TRANSPARENT ? 0 : index));
}
```

- [x] **Action 5: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/gdi/surface.test.ts`
Expected: PASS, 6 tests.

- [x] **Action 6: Commit**

```bash
git add src/gfx/gdi/surface.ts src/gfx/gdi/surface.test.ts
git commit -m "feat(gfx): surface and draw state of the original display"
```

## Part C: Primitives

- [x] **Action 7: Write the failing primitives test**

Create `src/gfx/gdi/primitives.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { drawCircle, drawLine, drawRect, setPixel } from './primitives.js';
import { makeDrawState, makeSurface, type DrawState, type Surface } from './surface.js';

function rows(surface: Surface): string[] {
  return Array.from({ length: surface.height }, (_, y) =>
    Array.from(surface.pixels.subarray(y * surface.width, (y + 1) * surface.width), (index) => index.toString(16)).join(''),
  );
}

function state(changes: Partial<DrawState> = {}): DrawState {
  return { ...makeDrawState(), clip: { x1: 0, y1: 0, x2: 7, y2: 5 }, ...changes };
}

describe('setPixel', () => {
  it('uses its own color, reduced to 16 colors, and honors the clip', () => {
    // SCRANTIC 1040:0d54 1040:097a
    const surface = makeSurface(4, 2);
    const clipped = state({ clipOn: true, clip: { x1: 0, y1: 0, x2: 1, y2: 1 } });
    setPixel(surface, clipped, 1, 0, 0x1a);
    setPixel(surface, clipped, 2, 0, 3);
    expect(rows(surface)).toEqual(['0a00', '0000']);
  });
});

describe('drawLine', () => {
  it('draws in the foreground and leaves out the end point', () => {
    // SCRANTIC 1030:02ef (GDI LineTo)
    const surface = makeSurface(6, 4);
    const pen = state({ foreground: 0x12 });
    drawLine(surface, pen, 0, 0, 4, 0);
    drawLine(surface, pen, 5, 3, 5, 0);
    drawLine(surface, pen, 0, 1, 2, 3);
    expect(rows(surface)).toEqual(['222200', '200002', '020002', '000002']);
  });

  it('draws nothing from a point to itself', () => {
    // SCRANTIC 1030:02ef (GDI LineTo)
    const surface = makeSurface(2, 2);
    drawLine(surface, state({ foreground: 5 }), 1, 1, 1, 1);
    expect(rows(surface)).toEqual(['00', '00']);
  });
});

describe('drawRect', () => {
  it('draws only the outline when the fill flag is off', () => {
    // SCRANTIC 1038:1bd8
    const surface = makeSurface(6, 5);
    drawRect(surface, state({ foreground: 4, background: 9, fill: false }), 1, 1, 4, 3);
    expect(rows(surface)).toEqual(['000000', '044440', '040040', '044440', '000000']);
  });

  it('draws only the outline when the width or height is under 2', () => {
    // SCRANTIC 1038:1bd8
    const surface = makeSurface(4, 4);
    drawRect(surface, state({ foreground: 4, background: 9 }), 1, 0, 1, 3);
    expect(rows(surface)).toEqual(['0400', '0400', '0400', '0000']);
  });

  it('fills the whole rect with the brush when foreground equals background', () => {
    // SCRANTIC 1038:1bd8 (PATCOPY)
    const surface = makeSurface(5, 4);
    drawRect(surface, state({ foreground: 6, background: 6 }), 1, 1, 3, 2);
    expect(rows(surface)).toEqual(['00000', '06660', '06660', '00000']);
  });

  it('outlines in the foreground and fills the inside with the background brush', () => {
    // SCRANTIC 1038:1bd8 1038:1d31 (GDI Rectangle)
    const surface = makeSurface(6, 5);
    drawRect(surface, state({ foreground: 4, background: 0x12 }), 0, 0, 6, 5);
    expect(rows(surface)).toEqual(['444444', '421214', '412124', '421214', '444444']);
  });
});

describe('drawCircle', () => {
  it('fits the circle in the rect from center minus radius to center plus radius, right and bottom excluded', () => {
    // SCRANTIC 1040:0688 (GDI Ellipse)
    const surface = makeSurface(8, 8);
    drawCircle(surface, state({ foreground: 1, background: 2, clip: { x1: 0, y1: 0, x2: 7, y2: 7 } }), 3, 4, 4);
    expect(rows(surface)).toEqual([
      '00000000',
      '00111100',
      '01222210',
      '01222210',
      '01222210',
      '01222210',
      '00111100',
      '00000000',
    ]);
  });

  it('draws nothing with radius 0', () => {
    // SCRANTIC 1040:0688 (GDI Ellipse, empty rect)
    const surface = makeSurface(4, 4);
    drawCircle(surface, state({ foreground: 1, background: 2 }), 0, 2, 2);
    expect(surface.pixels.every((index) => index === 0)).toBe(true);
  });
});
```

How the expected rows come out:

- `drawRect` brush rows: `0x12` paints, on even screen rows, the low nibble (2) at even columns and the high nibble (1) at odd columns; on odd rows the other way round (`brushColorAt`). Row 1 (odd): column 1 → 2, column 2 → 1, so `2121`; row 2 (even): `1212`.
- `drawCircle(r = 3, cx = 4, cy = 4)`: rect `1..6` in both axes. A pixel is inside when its center `(px + 0.5, py + 0.5)` lies within `r` of `(cx, cy)`; the border is every inside pixel with a 4-neighbor outside. This rasterization is our choice (GDI's exact ellipse pixels are not in the binary) and goes to an open question.

- [x] **Action 8: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/primitives.test.ts`
Expected: FAIL, cannot resolve `./primitives.js`.

- [x] **Action 9: Implement `primitives.ts`**

Create `src/gfx/gdi/primitives.ts`:

```ts
import { brushColorAt, colorIndex } from './color.js';
import { activeClip, plot, type ClipRect, type DrawState, type Surface } from './surface.js';

export function setPixel(surface: Surface, state: DrawState, x: number, y: number, color: number): void {
  plot(surface, activeClip(surface, state), x, y, colorIndex(color));
}

export function drawLine(surface: Surface, state: DrawState, x1: number, y1: number, x2: number, y2: number): void {
  lineTo(surface, activeClip(surface, state), x1, y1, x2, y2, colorIndex(state.foreground));
}

export function drawRect(surface: Surface, state: DrawState, x: number, y: number, w: number, h: number): void {
  const clip = activeClip(surface, state);
  const pen = colorIndex(state.foreground);
  if (!state.fill || w < 2 || h < 2) {
    const right = x + w - 1;
    const bottom = y + h - 1;
    lineTo(surface, clip, x, y, right, y, pen);
    lineTo(surface, clip, right, y, right, bottom, pen);
    lineTo(surface, clip, right, bottom, x, bottom, pen);
    lineTo(surface, clip, x, bottom, x, y, pen);
    return;
  }
  if (state.foreground === state.background) {
    fillWithBrush(surface, clip, x, y, x + w, y + h, state.background);
    return;
  }
  fillWithBrush(surface, clip, x + 1, y + 1, x + w - 1, y + h - 1, state.background);
  for (let px = x; px < x + w; px++) {
    plot(surface, clip, px, y, pen);
    plot(surface, clip, px, y + h - 1, pen);
  }
  for (let py = y + 1; py < y + h - 1; py++) {
    plot(surface, clip, x, py, pen);
    plot(surface, clip, x + w - 1, py, pen);
  }
}

export function drawCircle(surface: Surface, state: DrawState, r: number, cx: number, cy: number): void {
  const clip = activeClip(surface, state);
  const pen = colorIndex(state.foreground);
  const inside = (px: number, py: number) => (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2 <= r * r;
  for (let py = cy - r; py < cy + r; py++) {
    for (let px = cx - r; px < cx + r; px++) {
      if (!inside(px, py)) continue;
      const border = !inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1);
      plot(surface, clip, px, py, border ? pen : brushColorAt(state.background, px, py));
    }
  }
}

function lineTo(surface: Surface, clip: ClipRect, x1: number, y1: number, x2: number, y2: number, index: number): void {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x2 >= x1 ? 1 : -1;
  const sy = y2 >= y1 ? 1 : -1;
  const major = Math.max(dx, dy);
  const minor = Math.min(dx, dy);
  let error = major >> 1;
  let x = x1;
  let y = y1;
  for (let i = 0; i < major; i++) {
    plot(surface, clip, x, y, index);
    error -= minor;
    const stepMinor = error < 0;
    if (stepMinor) error += major;
    if (dx >= dy) {
      x += sx;
      if (stepMinor) y += sy;
    } else {
      y += sy;
      if (stepMinor) x += sx;
    }
  }
}

function fillWithBrush(surface: Surface, clip: ClipRect, left: number, top: number, right: number, bottom: number, color: number): void {
  for (let py = top; py < bottom; py++) {
    for (let px = left; px < right; px++) plot(surface, clip, px, py, brushColorAt(color, px, py));
  }
}
```

Check the diagonal case of the line test by hand before running: `(0, 1) → (2, 3)`: `dx = dy = 2`, `major = minor = 2`, `error = 1`; step 1 plots `(0, 1)`, `error = -1` → minor step, `error = 1`, moves to `(1, 2)`; step 2 plots `(1, 2)`, moves to `(2, 3)`; loop ends, end point left out. Matches rows 1 and 2 of the expectation.

- [x] **Action 10: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/gdi/primitives.test.ts`
Expected: PASS, 9 tests. If a rect or circle expectation fails, recompute the expected rows by hand from the rules above before touching the code; the rules are the spec here.

- [x] **Action 11: Commit**

```bash
git add src/gfx/gdi/primitives.ts src/gfx/gdi/primitives.test.ts
git commit -m "feat(gfx): pixel, line, rect, and circle as the original draws them"
```

## Part D: Findings

- [x] **Action 12: Write the findings**

In `docs/re/graphics.md`, replace `None yet.` under `Surfaces and clip`, `Primitives`, and `Text` with one bullet per claim, each starting with its address. At least:

- `Surfaces and clip`: `1038:1744` (three DCs and bitmaps of the screen size, clip rect and state, colors 0, fill on, all three bitmaps filled with color 0, mode bytes compared but every scale mode is 3 at runtime); `1038:194e` (what it frees); `1038:1ade` (region is `(x1, y1, x2 + 1, y2 + 1)` when on, whole screen when off, selected into all three DCs, remembered in `1068:45a6`); `1068:1ea3`..`1068:1eae` (meaning of each byte or word, who writes them, from Action 1).
- `Primitives`: one bullet per rule of `1040:0d54`, `1030:02ef`, `1038:1bd8`, `1040:0688` (argument order, colors, clip, outline/fill/`PATCOPY`, the GDI call and its rect), and one bullet each for the dirty-rect bugs of `1030:02ef` (`-a - b`) and `1040:0688` (right and bottom passed as width and height). Mark GDI-rule claims as such.
- `Text`: `1030:04ee`, `1030:04ce`, `1030:0765` (font `WILLY.FON`, colors and back mode from `1068:1ea0`, `1ea1`, `1ea2`, dirty rect `8 × length` by 15). The model does not draw text.

Checklist rows (real line numbers): `1038:1744` → `src/gfx/gdi/surface.ts` `makeDrawState` / `makeSurface`, `fixed`; `1038:194e` → `none (nothing to free)`, `match`; `1038:1ade` → `activeClip`, `fixed`; `1040:0d54` → `setPixel`, `fixed`; `1030:02ef` → `drawLine`, `open`; `1038:1bd8` → `drawRect`, `fixed`; `1040:0688` → `drawCircle`, `open`; `1030:04ee`, `1030:04ce`, `1030:0765` → `none (text not modeled)`, `open`.

- [x] **Action 13: Log open questions**

Add to `docs/re/open-questions.md` under "Workarounds without a known root cause", with the next free OQ numbers:

```markdown
### OQ-<n>: Line and ellipse pixels are our choice, not GDI's

- **Where:** `src/gfx/gdi/primitives.ts` (`lineTo`, `drawCircle`)
- **What it does:** lines use a midpoint Bresenham that leaves out the end point; circles fill every pixel whose center lies within the radius of the rect center, with a 1-pixel border.
- **Original:** `1030:02ef` and `1038:1bd8` call `MoveTo`/`LineTo`, `1040:0688` calls `Ellipse(cx - r, cy - r, cx + r, cy + r)`. Which pixels GDI picks is Windows behavior, not in `SCRANTIC.SCR`.
- **Resolve in:** only with a reference capture from Windows 3.1; until then the end points, rect edges, and symmetry are pinned and the inner pixels are not
- **Status:** open

### OQ-<n>: Text drawing is not modeled

- **Where:** `1030:04ee`, `1030:04ce`, `1030:0765`
- **What it does:** `TextOut` with the `WILLY.FON` font, text and back colors from `1068:1ea0`/`1ea1`, back mode from `1068:1ea2`.
- **Ours:** nothing draws text.
- **Resolve in:** chunk 5 (TTM interpreter): find whether any TTM opcode reaches these functions and whether the data uses it
- **Status:** open

### OQ-<n>: The original presents only dirty rects, the model presents whole frames

- **Where:** `1038:07e8` callers: `1030:02ef` (width `-a - b` when the line goes left or up), `1040:0688` (right and bottom passed as width and height)
- **What it does:** the original copies only the dirty rect of each drawing call to the window, so a wrong rect leaves part of a line on screen later than the rest, or presents too much.
- **Ours:** the browser shows the whole surface every frame.
- **Resolve in:** chunk 5, when the model is wired in: decide whether any visible difference is worth modeling
- **Status:** open
```

- [x] **Action 14: Names and status**

In `scripts/re/names.json`: name `1038:1ade` `gfx_applyClip`, `1038:194e` `gfx_closeDisplay`, `1030:04ee` `gfx_drawText`, `1030:04ce` `gfx_drawTextNear`, `1030:0765` `gfx_loadFont` (adjust names to what you read). Status `verified` for every in-scope function of this step whose checklist row is `match` or `fixed`; leave `named` for `open` rows (they are listed in `open-questions.md`).

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 15: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

```bash
git add docs/re/graphics.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk 4 surfaces, clip, and primitives"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
