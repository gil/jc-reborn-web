# Step 6: Wipes

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-colors-and-bitmap-masks.md` (harness), `step-004-dirty-rect-lists.md` (`signed` in `original_graphics.py`)

**Files:**

- Modify: `src/gfx/fade.ts` (rewrite, same exported API plus `wipeShapes`, `WipeShape`, `WIPE_TICKS`)
- Create: `src/gfx/fade.test.ts`, `src/gfx/fade.data.test.ts`
- Modify: `scripts/re/unicorn/original_graphics.py`, `scripts/re/unicorn/dump_graphics.py`, `scripts/re/unicorn/test_original_graphics.py`
- Modify: `docs/re/graphics.md` (`Wipes`, checklist), `docs/re/open-questions.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes: Python `new_graphics_emulator(image)`, `pascal_args(emu, count)` (Pascal import arguments in declared order), `signed(word)` (16-bit to signed) from `scripts/re/unicorn/original_graphics.py`; `dump_graphics.py` with `write_tsv(name, header, rows)` and the `COMMANDS` dict (commands take `(image, resources)`); `hasFixture`, `readFixtureRows` from `src/testing/corpus.ts`; `SCREEN_W = 640`, `SCREEN_H = 480` from `src/types.ts`.
- Existing callers that must keep working unchanged: `src/story/story.ts` imports `type FadeState`, `nextFadeState`, `fadeDone` and does `game.fadeState.step++` once per story tick until `fadeDone`, then (in the `fading` phase) keeps the finished state for the rest of the phase; `src/gfx/compositor.ts` calls `applyFade(px: Uint8ClampedArray, f: FadeState)` on the RGBA frame after compositing.
- Produces (`src/gfx/fade.ts`): `interface FadeState { type: number; step: number; maxSteps: number }`, `interface WipeShape { kind: 'rect' | 'ellipse'; left: number; top: number; right: number; bottom: number }`, `WIPE_TICKS = 16`, `nextFadeState(): FadeState`, `fadeDone(f: FadeState): boolean`, `wipeShapes(type: number, x: number, y: number, w: number, h: number): WipeShape[]`, `applyFade(px: Uint8ClampedArray, f: FadeState): void`.

What changes for the viewer: today there are 5 made-up wipes. The original has 6 (ellipse out, rect out, right to left, left to right, top to bottom, bottom to top) with their own step sizes, and ends with the whole screen black. The original draws a whole wipe as fast as the machine can (no timer); we keep spreading it over `WIPE_TICKS` story ticks and log that as an open question.

## Part A: Emulate the wipes

- [ ] **Action 1: Read the functions**

Read `re/out/functions/` for `1020_0364`, `1020_0512_gfx_wipeEllipseOut`, `1020_05a0_gfx_wipeRectOut`, `1020_0637_gfx_wipeRightToLeft`, `1020_0688_gfx_wipeLeftToRight`, `1020_06d2_gfx_wipeTopToBottom`, `1020_071c_gfx_wipeBottomToTop`. Confirm or correct the overview's "Wipes" reading: the counter `1068:361a` and its order, the stock objects (4 = `BLACK_BRUSH`, 7 = `BLACK_PEN`), the centering in the client rect, the final black `FillRect`, the non-zero argument path, and each wipe's loop. Who calls `1020:0364` and with what (`1018:0673`, chunk 7).

- [ ] **Action 2: Add the wipe driver**

Append to `scripts/re/unicorn/original_graphics.py`:

```python
WIPES = {
    "ellipse": "1020:0512",
    "rect": "1020:05a0",
    "right-to-left": "1020:0637",
    "left-to-right": "1020:0688",
    "top-to-bottom": "1020:06d2",
    "bottom-to-top": "1020:071c",
}
PUMP_MESSAGES = "1008:13cd"
FAKE_DC = 0x55


def wipe_shapes_original(image: NeImage, name: str, x: int, y: int, w: int, h: int) -> list[list[object]]:
    emu = new_graphics_emulator(image)
    shapes: list[list[object]] = []

    def recorder(kind: str):
        def record(emu: Emulator):
            _dc, left, top, right, bottom = pascal_args(emu, 5)
            shapes.append([kind, signed(left), signed(top), signed(right), signed(bottom)])
            return {"ax": 1}

        return record

    emu.add_stub("GDI", 27, recorder("rect"), arg_bytes=10)
    emu.add_stub("GDI", 24, recorder("ellipse"), arg_bytes=10)
    emu.replace_function(PUMP_MESSAGES, lambda emu: {"ax": 0})
    emu.call_far(WIPES[name], stack_words=[h, w, y, x, FAKE_DC])
    return shapes
```

`GDI` 27 is `Rectangle`, 24 is `Ellipse`. If `UnstubbedImport` names another ordinal, use that one.

- [ ] **Action 3: Python test**

Append to `scripts/re/unicorn/test_original_graphics.py` (add `wipe_shapes_original` to the `original_graphics` import):

```python
@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class WipeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_right_to_left_fills_strips_of_a_hundredth_of_the_width(self):
        shapes = wipe_shapes_original(self.image, "right-to-left", 0, 0, 640, 480)
        self.assertEqual(len(shapes), 107)
        self.assertEqual(shapes[0], ["rect", 634, 0, 640, 480])
        self.assertEqual(shapes[-1], ["rect", -2, 0, 4, 480])

    def test_ellipse_grows_its_radius_by_1_then_2_then_3(self):
        shapes = wipe_shapes_original(self.image, "ellipse", 0, 0, 640, 480)
        self.assertEqual(shapes[:3], [["ellipse", 318, 238, 322, 242], ["ellipse", 316, 236, 324, 244], ["ellipse", 313, 233, 327, 247]])
        self.assertEqual(len(shapes), 25)
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_graphics.py' -v`
Expected: all pass. A mismatch means the first reading was wrong; fix the expectation from what the emulator shows only after reading the assembly to understand why.

- [ ] **Action 4: Dump the wipes**

Append to `scripts/re/unicorn/dump_graphics.py` (import `WIPES`, `wipe_shapes_original`; `json` is already imported in step 4):

```python
WIPE_AREAS = [(0, 0, 640, 480), (80, 60, 640, 480)]


def dump_wipes(image: NeImage, resources):
    rows = []
    for name in WIPES:
        for x, y, w, h in WIPE_AREAS:
            shapes = wipe_shapes_original(image, name, x, y, w, h)
            rows.append([name, x, y, w, h, json.dumps(shapes, separators=(",", ":"))])
    write_tsv("wipes.tsv", ["wipe", "x", "y", "w", "h", "shapes"], rows)
```

Register `"wipes": dump_wipes,` in `COMMANDS`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py wipes`
Expected: exits 0; `re/fixtures/graphics/wipes.tsv` has 12 rows. The second area is a 640 × 480 picture centered in an 800 × 600 client rect; it shows that the rect wipe's step depends on the center, not the size.

- [ ] **Action 5: Commit**

```bash
git add scripts/re/unicorn/original_graphics.py scripts/re/unicorn/test_original_graphics.py scripts/re/unicorn/dump_graphics.py
git commit -m "test(re): emulate the original wipe transitions"
```

## Part B: Rewrite `fade.ts`

- [ ] **Action 6: Write the failing test**

Create `src/gfx/fade.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyFade, fadeDone, nextFadeState, WIPE_TICKS, wipeShapes, type FadeState } from './fade.js';

const W = 640;
const H = 480;
const ELLIPSE = 0;
const RECT = 1;
const RIGHT_TO_LEFT = 2;
const LEFT_TO_RIGHT = 3;
const TOP_TO_BOTTOM = 4;
const BOTTOM_TO_TOP = 5;

function frame(): Uint8ClampedArray {
  return new Uint8ClampedArray(W * H * 4).fill(200);
}

const isBlack = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4] === 0;

describe('nextFadeState', () => {
  it('cycles through the six wipes in the original order', () => {
    // SCRANTIC 1020:0364 1068:361a
    const types = Array.from({ length: 7 }, () => nextFadeState().type);
    expect(types).toEqual([ELLIPSE, RECT, RIGHT_TO_LEFT, LEFT_TO_RIGHT, TOP_TO_BOTTOM, BOTTOM_TO_TOP, ELLIPSE]);
  });

  it('runs every wipe over the same number of ticks', () => {
    const state = nextFadeState();
    expect([state.step, state.maxSteps]).toEqual([0, WIPE_TICKS]);
    expect(fadeDone({ ...state, step: WIPE_TICKS })).toBe(true);
  });
});

describe('wipeShapes', () => {
  it('draws the original shapes for a 640x480 screen', () => {
    // SCRANTIC 1020:0512 1020:05a0 1020:0637 1020:0688 1020:06d2 1020:071c
    const ends = (type: number) => {
      const shapes = wipeShapes(type, 0, 0, W, H);
      return [shapes.length, shapes[0], shapes.at(-1)];
    };
    expect(ends(ELLIPSE)).toEqual([25, { kind: 'ellipse', left: 318, top: 238, right: 322, bottom: 242 }, { kind: 'ellipse', left: -6, top: -86, right: 646, bottom: 566 }]);
    expect(ends(RECT)).toEqual([60, { kind: 'rect', left: 314, top: 236, right: 326, bottom: 244 }, { kind: 'rect', left: -40, top: 0, right: 680, bottom: 480 }]);
    expect(ends(RIGHT_TO_LEFT)).toEqual([107, { kind: 'rect', left: 634, top: 0, right: 640, bottom: 480 }, { kind: 'rect', left: -2, top: 0, right: 4, bottom: 480 }]);
    expect(ends(LEFT_TO_RIGHT)).toEqual([107, { kind: 'rect', left: 0, top: 0, right: 6, bottom: 480 }, { kind: 'rect', left: 636, top: 0, right: 642, bottom: 480 }]);
    expect(ends(TOP_TO_BOTTOM)).toEqual([240, { kind: 'rect', left: 0, top: 0, right: 640, bottom: 2 }, { kind: 'rect', left: 0, top: 478, right: 640, bottom: 480 }]);
    expect(ends(BOTTOM_TO_TOP)).toEqual([240, { kind: 'rect', left: 0, top: 478, right: 640, bottom: 480 }, { kind: 'rect', left: 0, top: 0, right: 640, bottom: 2 }]);
  });
});

describe('applyFade', () => {
  const state = (type: number, step: number): FadeState => ({ type, step, maxSteps: WIPE_TICKS });

  it('leaves the frame alone before the first tick', () => {
    const px = frame();
    applyFade(px, state(RIGHT_TO_LEFT, 0));
    expect(isBlack(px, 639, 0)).toBe(false);
  });

  it('shows the share of shapes that matches the ticks so far', () => {
    // SCRANTIC 1020:0637
    const px = frame();
    applyFade(px, state(RIGHT_TO_LEFT, WIPE_TICKS / 2));
    expect([isBlack(px, 316, 100), isBlack(px, 315, 100), isBlack(px, 639, 479)]).toEqual([true, false, true]);
  });

  it('paints an ellipse as a filled black circle', () => {
    // SCRANTIC 1020:0512 (GDI Ellipse, black pen and brush)
    const px = frame();
    applyFade(px, state(ELLIPSE, 1));
    expect([isBlack(px, 320, 240), isBlack(px, 0, 0)]).toEqual([true, false]);
  });

  it('turns the whole frame black once the wipe is done', () => {
    // SCRANTIC 1020:0364 (FillRect with the black brush)
    const px = frame();
    applyFade(px, state(ELLIPSE, WIPE_TICKS));
    expect([isBlack(px, 0, 0), isBlack(px, 639, 479), px[3]]).toEqual([true, true, 255]);
  });
});
```

Numbers behind the expectations: right to left at half time shows `ceil(107 × 8 / 16) = 54` strips, the last one starting at `634 - 53 × 6 = 316`. The ellipse at tick 1 shows `ceil(25 / 16) = 2` shapes, the larger with radius 4 around `(320, 240)`.

- [ ] **Action 7: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/fade.test.ts`
Expected: FAIL (`wipeShapes` and `WIPE_TICKS` are not exported; the cycle has 5 types).

- [ ] **Action 8: Rewrite `fade.ts`**

Replace the whole content of `src/gfx/fade.ts` with:

```ts
import { SCREEN_H, SCREEN_W } from '../types.js';

export interface FadeState {
  type: number;
  step: number;
  maxSteps: number;
}

export interface WipeShape {
  kind: 'rect' | 'ellipse';
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const WIPE_TICKS = 16;

const ELLIPSE_OUT = 0;
const RECT_OUT = 1;
const RIGHT_TO_LEFT = 2;
const LEFT_TO_RIGHT = 3;
const TOP_TO_BOTTOM = 4;
const BOTTOM_TO_TOP = 5;
const WIPE_COUNT = 6;

let nextWipe = ELLIPSE_OUT;

export function nextFadeState(): FadeState {
  const type = nextWipe;
  nextWipe = (nextWipe + 1) % WIPE_COUNT;
  return { type, step: 0, maxSteps: WIPE_TICKS };
}

export function fadeDone(f: FadeState): boolean {
  return f.step >= f.maxSteps;
}

export function wipeShapes(type: number, x: number, y: number, w: number, h: number): WipeShape[] {
  const shapes: WipeShape[] = [];
  const rect = (left: number, top: number, right: number, bottom: number) => shapes.push({ kind: 'rect', left, top, right, bottom });
  let halfW = Math.trunc(w / 2);
  let halfH = Math.trunc(h / 2);
  const cx = x + halfW;
  const cy = y + halfH;
  switch (type) {
    case ELLIPSE_OUT: {
      let step = 1;
      let radius = 1;
      while (halfW > 0 || halfH > 0) {
        halfW -= step;
        halfH -= step;
        radius += step;
        step++;
        shapes.push({ kind: 'ellipse', left: cx - radius, top: cy - radius, right: cx + radius, bottom: cy + radius });
      }
      break;
    }
    case RECT_OUT: {
      const stepX = Math.trunc(cx / 50);
      const stepY = Math.trunc(cy / 50);
      for (let ix = stepX, iy = stepY; halfW > 0 || halfH > 0; ix += stepX, iy += stepY, halfW -= stepX, halfH -= stepY) {
        rect(cx - ix, cy - iy, cx + ix, cy + iy);
      }
      break;
    }
    case RIGHT_TO_LEFT:
    case LEFT_TO_RIGHT: {
      const strip = Math.trunc(w / 100);
      const fromRight = type === RIGHT_TO_LEFT;
      for (let left = fromRight ? x + w - strip : x, rest = w; rest > 0; left += fromRight ? -strip : strip, rest -= strip) {
        rect(left, y, left + strip, y + h);
      }
      break;
    }
    case TOP_TO_BOTTOM:
    case BOTTOM_TO_TOP: {
      const strip = Math.trunc(h / 200);
      const fromBottom = type === BOTTOM_TO_TOP;
      for (let top = fromBottom ? y + h - strip : y, rest = h; rest > 0; top += fromBottom ? -strip : strip, rest -= strip) {
        rect(x, top, x + w, top + strip);
      }
      break;
    }
  }
  return shapes;
}

export function applyFade(px: Uint8ClampedArray, f: FadeState): void {
  if (f.step <= 0) return;
  if (fadeDone(f)) {
    paintRect(px, 0, 0, SCREEN_W, SCREEN_H);
    return;
  }
  const shapes = wipeShapes(f.type, 0, 0, SCREEN_W, SCREEN_H);
  const shown = Math.ceil((shapes.length * f.step) / f.maxSteps);
  // The ellipse and rect wipes grow around one center, so their last shape covers every earlier one.
  const visible = f.type === ELLIPSE_OUT || f.type === RECT_OUT ? shapes.slice(shown - 1, shown) : shapes.slice(0, shown);
  for (const shape of visible) {
    if (shape.kind === 'rect') paintRect(px, shape.left, shape.top, shape.right, shape.bottom);
    else paintEllipse(px, shape);
  }
}

function paintBlack(px: Uint8ClampedArray, x: number, y: number): void {
  const o = (y * SCREEN_W + x) * 4;
  px[o] = px[o + 1] = px[o + 2] = 0;
  px[o + 3] = 255;
}

function paintRect(px: Uint8ClampedArray, left: number, top: number, right: number, bottom: number): void {
  for (let y = Math.max(top, 0); y < Math.min(bottom, SCREEN_H); y++) {
    for (let x = Math.max(left, 0); x < Math.min(right, SCREEN_W); x++) paintBlack(px, x, y);
  }
}

function paintEllipse(px: Uint8ClampedArray, { left, top, right, bottom }: WipeShape): void {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const radius = (right - left) / 2;
  for (let y = Math.max(top, 0); y < Math.min(bottom, SCREEN_H); y++) {
    for (let x = Math.max(left, 0); x < Math.min(right, SCREEN_W); x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) paintBlack(px, x, y);
    }
  }
}
```

Check the right-to-left loop against the original by hand: `strip = 6`, first `left = 634`, `rest` goes 640, 634, ..., 4, so 107 rounds and the last `left` is `634 - 106 × 6 = -2`. The rect wipe at 640 × 480: `stepX = 6`, `stepY = 4`, `halfH` reaches 0 after 60 rounds, the last `ix = 360`, `iy = 240`.

- [ ] **Action 9: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/fade.test.ts`
Expected: PASS, 8 tests.

- [ ] **Action 10: Data test against the original**

Create `src/gfx/fade.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../testing/corpus.js';
import { wipeShapes } from './fade.js';

const TYPES = ['ellipse', 'rect', 'right-to-left', 'left-to-right', 'top-to-bottom', 'bottom-to-top'];

describe.skipIf(!hasFixture('graphics/wipes.tsv'))('wipes match the original SCRANTIC.SCR', () => {
  it('draws the same shapes in the same order for every wipe and area', () => {
    // SCRANTIC 1020:0512 1020:05a0 1020:0637 1020:0688 1020:06d2 1020:071c
    const wrong = readFixtureRows('graphics/wipes.tsv').flatMap(([name, x, y, w, h, shapesText]) => {
      const ours = wipeShapes(TYPES.indexOf(name!), Number(x), Number(y), Number(w), Number(h)).map((s) => [s.kind, s.left, s.top, s.right, s.bottom]);
      return JSON.stringify(ours) === shapesText ? [] : [`${name} at ${x},${y}`];
    });
    expect(wrong).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/gfx/fade.data.test.ts`
Expected: PASS.

- [ ] **Action 11: Run everything that uses the fade**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (story and compositor use only `FadeState`, `nextFadeState`, `fadeDone`, `applyFade`).

Run: `pnpm test`
Expected: all pass.

- [ ] **Action 12: Smoke test**

Run `pnpm dev` in the background, open the printed URL, wait for the splash to end and for at least two scene changes. Expected: the splash ends with an ellipse wipe that grows from the center and leaves the screen black; the next sequence change uses the rect wipe. Stop the server by its PID (or `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9` for the Vite port it printed). If you cannot watch it, say so in the step's commit message instead of claiming it works.

- [ ] **Action 13: Commit**

```bash
git add src/gfx/fade.ts src/gfx/fade.test.ts src/gfx/fade.data.test.ts
git commit -m "fix(gfx): the six original wipe transitions"
```

## Part C: Findings

- [ ] **Action 14: Write the findings**

In `docs/re/graphics.md`, replace `None yet.` under `Wipes` with one bullet per claim, each starting with its address: `1020:0364` (non-zero argument path, the counter and its order, stock black brush and pen, centering, final black fill, caller `1018:0673`), each of the six wipe functions (loop and shape), the step sizes depending on the center for the rect wipe, the message pump instead of a timer, and "Emulated: `re/fixtures/graphics/wipes.tsv`, 6 wipes × 2 areas, equal to `wipeShapes` in `src/gfx/fade.ts`."

Checklist rows (real line numbers): `1020:0364` → `src/gfx/fade.ts` `nextFadeState` / `applyFade`, `fixed`; the six wipes → `wipeShapes`, `fixed`.

- [ ] **Action 15: Log the pacing**

Add to `docs/re/open-questions.md` under "Workarounds without a known root cause" (next free OQ number):

```markdown
### OQ-<n>: Wipe speed

- **Where:** `src/gfx/fade.ts` (`WIPE_TICKS`), `src/story/story.ts` (one `step++` per story tick)
- **What it does:** spreads every wipe over 16 story ticks, showing a proportional share of its shapes each tick.
- **Original:** `1020:0512`..`1020:071c` draw every shape in one go, pumping window messages between shapes (`1008:13cd`), with no timer: the speed is whatever the machine manages. The story waits for the call to return.
- **Old guess behind it:** a visible wipe needs a fixed duration in a browser frame loop.
- **Resolve in:** chunk 7 (story and main loop): decide a duration from the original's timing model, if any, when the story's call to `1020:0364` (`1018:0673`) is read
- **Status:** open
```

- [ ] **Action 16: Names and status**

In `scripts/re/names.json`: `1020:0364` `gfx_wipeScreen` (or a name that fits), and set `verified` on `1020:0364`, `1020:0512`, `1020:05a0`, `1020:0637`, `1020:0688`, `1020:06d2`, `1020:071c`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 17: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/graphics.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk 4 wipes verified"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
