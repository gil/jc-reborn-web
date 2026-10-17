# Reverse Engineering Graphics (Chunk 4) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every graphics function of the original `SCRANTIC.SCR` (colors, bitmap masks, primitives, sprites, clipping, dirty rects, display buffers, wipes), write the findings, and build a TypeScript model of the original's drawing in `src/gfx/gdi/`, pinned by tests. Fix the wipe transition in place.

**Architecture:** The original draws with Windows GDI into three offscreen bitmaps and erases moving things by copying dirty rects back from a cleaner bitmap. Ours draws each TTM thread into its own transparent layer and composites every frame. **The user decided (2026-10-17): build the original's model now in `src/gfx/gdi/`, do not wire it in.** Chunk 5 (TTM interpreter) switches the interpreter over once it knows which opcodes call what. Until then the existing layer pipeline (`src/gfx/*.ts` outside `gdi/`) keeps running unchanged, except the wipe fix in `src/gfx/fade.ts`. Pure functions (mask builder, row mirror, dither brush, dirty-rect list, wipe geometry) are run in the Unicorn harness and compared with our TypeScript on handmade inputs and on every bitmap. GDI-heavy functions get side-by-side review only. Findings go to `docs/re/graphics.md`, one claim per address.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 4).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunks 1 to 3 built the toolchain and checked the archive, decompression, and decoders. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. They explain addresses, `names.json`, `re/out/`, and the emulator. `docs/re/decoders.md` is the model for the findings file this chunk writes; its `Pixels` section already covers part of `1040:0000`, `1040:035c`, `1040:0462`, `1040:0286`.

**What GDI does is not in the binary.** The decompile tells us which GDI call runs with which arguments. How Windows rasterizes it (line pixels, ellipse pixels, mirrored `StretchBlt`) comes from Windows behavior, not from `SCRANTIC.SCR`. Where our model has to pick pixels, it uses the documented GDI rule (right and bottom edges excluded, `LineTo` excludes its end point), and every case we cannot settle from the binary gets an entry in `docs/re/open-questions.md`. The final screen colors depend on the Windows display driver (16-color DDBs, nearest-color matching); the model keeps palette indices and leaves that out.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files (fixtures, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Only our own notes, scripts, tests, snapshots, and `names.json` are committed.
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves. The unittest runner (`-m unittest discover -s scripts/re/unicorn`) puts that folder on the path for test modules.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1038:1bd8`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- `scripts/re/names.json` keeps its entries under `"functions"`, sorted by address; `node scripts/re/function-map.mjs` rejects an unsorted file. Insert new entries in address order.
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or the fixture they compare against) are missing.
- The original wins over workarounds. A difference or workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.
- **Do not wire `src/gfx/gdi/` into `src/ttm/`, `src/ads/`, `src/story/`, `src/island/`, `src/walk/`, `src/engine/`, or `src/main.ts`.** User decision. The only wired change in this chunk is `src/gfx/fade.ts` (step 6), which keeps its exported API. Every difference found between the old layer pipeline and the original goes to `docs/re/open-questions.md` with **Resolve in:** chunk 5 (or 6/7 when the caller lives there).
- `src/gfx/gdi/` uses raw palette indices 0..15 everywhere. It never uses `TRANSPARENT`. Converting a decoded `Sprite` or `ScrResource` (which map index 0 to `TRANSPARENT = 0xff`) back to raw indices is done by `rawIndices` in `src/gfx/gdi/surface.ts` (step 2).

## Binary facts (first reading, 2026-10-17)

These come from a first read of the decompile during planning. Each step confirms or corrects the ones it covers and writes the confirmed version as a finding. Address format `ssss:oooo`; NE segment `n` is selector `0x1000 + (n - 1) * 8`; `1068` is the auto data segment (DS). Medium model: far code, near data pointers. Far cdecl: first argument at `[BP+6]`, caller pops; in the emulator pass `stack_words` in reverse argument order. GDI and KERNEL imports are Pascal (callee pops, args pushed left to right): inside a stub, `emu.arg(0)` is the **last** declared argument. **Ghidra prints the arguments of Pascal imports in reverse order** (for example `RECTANGLE(cs, bottom, right, top, left)`).

### Runtime display state

- `platform_initSaver` (`1008:143c`) sets screen width `1068:2562` = 640 and height `1068:2564` = 480, and sets the four scale-mode bytes `1068:2e74`, `2e75`, `2e76`, `2e77` all to 3. Every scaling branch (`1038:0de1`, `1038:109e`, `1038:1485`, `1038:19c7`, the `/ 2` and `<< 1` paths in `1038:0ae4`, `1038:07e8`, `1038:06ce`, `1038:1ade`) compares those bytes and never runs.
- `gfx_initDisplay` (`1038:1744`, called with mode 2): creates three memory DCs `1068:1eb4`, `1068:1eb2`, `1068:1eb0` with three compatible bitmaps (`1068:45a0`, `45a2`, `45a4`) of 640 × 480. Sets clip rect `1068:1ea4` (x1) = 0, `1068:1ea8` (y1) = 0, `1068:1ea6` (x2) = 639, `1068:1eaa` (y2) = 479 (inclusive), clip off `1068:1ea3` = 0, background color `1068:1ead` = 0, foreground `1068:1eae` = 0, fill flag `1068:1eac` = 1, then fills all three bitmaps with color 0 through `gfx_drawRect`. Ends with draw target `1068:1eb8` = `1eb4`.
- `1068:1eb8` is the draw target DC, `1068:1eb6` the copy source DC. Below, `A` = `1eb4`, `B` = `1eb2`, `C` = `1eb0`.
- `1068:429e`: static 0; `platform_initSaver` sets it to 1. When it is 1, `1038:06ce` skips copies whose target is `A`, and `1038:07e8` presents from `B` instead of `A`.
- `1068:287a`: static 1; `platform_initSaver` sets it to 0 at the end.
- Static values (read from the data segment): `1068:361a` = 0, `1068:1e22` = 1, `1068:4106` = 0, `1068:2572` = 1, `1068:1ea3` = 0, `1068:429e` = 0, `1068:287c` = `0xffff`.

### Colors

- `1040:097a(color)`: in color mode 2 (`1068:1ebd`, always 2 at runtime) takes `color % 16` and returns the RGB of that entry of the active palette `1068:25ae`. Pens, `SetPixel`, and solid brushes all go through it.
- `1038:1d31(color)` (`gfx_createColorBrush`): color below 16 → `CreateSolidBrush` of that palette color. 16 or more → an 8 × 8, 4-bit, bottom-up DIB pattern brush (`CreateDIBPatternBrush`): 40-byte header, 16 palette colors as BGR0, then 8 rows of 4 bytes. Row `k` (in buffer order) is 4 copies of the color byte when `k` is even, and 4 copies of the byte with its nibbles swapped when `k` is odd. So color `0x12` paints a checkerboard of palette colors 1 and 2.

### Bitmap masks and flips

- `1040:035c` (`gfx_buildBitmapMask`): 1-bit mask, bit set where the 4-bit index is not 0, high nibble first. Writes `width / 8` bytes per row (8 pixels each); row stride `((width + 8) / 16) * 2`. Pixels past the last whole 8 (when `width % 8 != 0`) get no mask bit. `CreateBitmap` expects a stride of `((width + 15) / 16) * 2`, which differs when `width % 16` is 1..7.
- `1040:0462` (`gfx_flipPixelRows`): swaps rows top to bottom in place.
- `1040:054e`: mirrors each packed row left to right in place: swaps bytes from both ends and swaps each byte's nibbles. `1040:0000` uses it to build pre-mirrored bitmaps (record `+10` image, `+12` mask) only when `1068:1e22 != 0` and `1068:4106 != 0`. `walk_loadJohnWalkBmp` (`1018:0000`) sets `4106` to 1 only around loading `JOHNWALK.BMP`.
- `1040:0000`: when `1068:2572 != 0` (bitmaps) palette entry 0 is forced to black. With the mask this makes index 0 see-through.

### Primitives (all draw on `1068:1eb8`, call `1038:1ade` to apply the clip, then `1038:07e8` for the dirty part)

- `1038:1ade(on)`: when `on` (or when it was on before) selects a clip region into `A`, `B`, `C`: the clip rect `(x1, y1, x2 + 1, y2 + 1)` when on, the whole screen when off. Remembers the state in `1068:45a6`.
- `1040:0d54(x, y, color)` (`gfx_drawPixel`): `SetPixel` with `color % 16`. Uses its own color argument, not the foreground.
- `1030:02ef(x1, y1, x2, y2)` (`gfx_drawLine`): pen of the foreground `1068:1eae`, `SetROP2(R2_COPYPEN)`, `MoveTo(x1, y1)`, `LineTo(x2, y2)`. `LineTo` leaves out the end point. Its dirty rect is wrong when `x2 < x1` or `y2 < y1` (it uses `-a - b` instead of `a - b`).
- `1038:1bd8(x, y, w, h)` (`gfx_drawRect`): pen = foreground. When the fill flag `1068:1eac` is 0, or `w < 2`, or `h < 2`: outline with `MoveTo(x, y)`, `LineTo(x + w - 1, y)`, `LineTo(x + w - 1, y + h - 1)`, `LineTo(x, y + h - 1)`, `LineTo(x, y)`. Otherwise brush = `1038:1d31(background 1068:1ead)`; when foreground equals background, `BitBlt(x, y, w, h, PATCOPY)` paints the whole rect with the brush; else `Rectangle(x, y, x + w, y + h)` (outline in the pen, inside in the brush).
- `1040:0688(r, cx, cy)` (`gfx_drawCircle`): pen = foreground, brush = `1038:1d31(background)`, `Ellipse(cx - r, cy - r, cx + r, cy + r)`. Its dirty call passes `(cx - r, cy - r, cx + r, cy + r)` as if they were x, y, width, height.
- `1030:04ee` / `1030:04ce`: `TextOut` with text color `1068:1ea0`, back color `1068:1ea1`, back mode from `1068:1ea2`. `1030:0765` loads the font `WILLY.FON` (`1068:1e2a`).

### Sprites

- `1038:0ae4(record, x, y, flags)`: draws one image record (`+2` image bitmap, `+4` mask, `+6` width, `+8` height, `+10`/`+12` pre-mirrored image/mask). `flags & 2` = mirror left-right, `flags & 1` = flip upside down. With `flags & 2` it uses `+10`/`+12` when they exist; `flags & 1` always uses `+2`/`+4`. When it falls back to `+2`/`+4` for a flip it uses a negative `StretchBlt` extent: flip upside down → `y += h, h = -h`; mirror → `x += w, w = -w`. Blit 1: mask with ROP `0x220326` (destination AND NOT source: clears where the mask bit is set). Blit 2: image with ROP `0xEE0086` (`SRCPAINT`, OR). Clip applied around both. Dirty rect `(x, y, w, h)`.
- `1038:0ac2(record, x, y)`: `1038:0ae4` with flags 0.
- `1030:03d7(record, x, y, flags, dw, dh)`: the same two blits, stretched to `dw × dh`, flips by negating the source extents.
- `1028:17d8` forwards four words to `1038:0ae4`.

### Dirty rects (`1060`)

- 20 list heads at `1068:46f0`; free node list `1068:46ee`; node pool count `1068:46ec`. `1060:0000(n)` allocates `ceil(n / 5) * 5` nodes of 26 bytes with `1038:06a8` (near calloc) and chains them into the free list.
- Node words: `[0]` x, `[1]` y, `[2]` w, `[3]` h, `[4]` source DC, `[5]` target DC, `[6]` kind, `[7]` age, `[8]` area, `[10]`/`[11]` saved-bits far pointer, `[12]` next.
- `1060:05a7(source, target, age)`: the head slot whose first node has that source, target, and age; else the first empty slot; else 0.
- `1060:007e(x, y, w, h, kind, source, target, age, p9, p10)`: kind 4 forces source to `-1`. Kind 1 clips the rect to the clip rect when `1068:1ea3` is on, else to the screen, rejects it when fully outside, then turns x and w into 8-pixel columns: `w = (w + x % 8 + 7) / 8`, `x = x / 8`. Takes a free node (allocating 5 more when the free list is empty), fills it, and for kind 1 merges it with every node of the same list whose bounding box with it has an area of at most `area1 + area2 + 20`, freeing the merged nodes. Inserts the node at the head.
- `1060:05f9(source, target, age)`: replays and frees one list: sets `1068:1eb6` / `1068:1eb8` from the head node, then for each node: kind 1 → `1038:06ce(x * 8, y, w * 8, h)`; kind 4 → `gfx_restoreRectBits(saved, x, y, w, h)`.
- `1060:03d3(which)`: `which == 0` replays every pair of the table at `1068:287e` (pairs of near pointers to the source and target DC globals) with age 0 until a pair's target pointer is 0, then subtracts 1 from the age of every node left. `which != 0` replays only the pair at `1068:2882`. First table words: `(287c, 1eb4)`, `(1eb2, 1eb4)`, `(287c, 1eb2)`, `(1eb0, 1eb2)`, `(287c, 1eb0)`, `(1eb4, 1eb0)`, ... `1068:287c` holds `0xffff`, the kind-4 source.
- `1060:04b2`, `1060:046e`, `1060:0556`, `1060:0596`, `1060:06ac`, `1060:06f5`: query overlap, free all lists, free the pool, return the pool count, drop one list, copy one list to another key.
- `1050:0a85(x, y, w, h)` (TTM code, chunk 5) adds kind-1 rects `B → A` for ages 0 and 1, and when `1068:27c0 == 0` and `1068:2641 >= 3`, `C → B` age 0 (age 1 when `1068:287a != 0`).

### Display buffers

- `1038:06ce(x, y, w, h)`: does nothing when source equals target or `w` or `h` is 0. Widens to 8-pixel columns: `w += x % 8`, `x -= x % 8`, `w += 8 - w % 8` (adds 8 even when already aligned). Copies `1068:1eb6 → 1068:1eb8` with `SRCCOPY` unless `1068:429e != 0` and the target is `A`. Then `1038:07e8(0, x, y, w, h)`.
- `1038:07e8(dc, x, y, w, h)`: presents a rect to the window. Runs only when `dc != 0`, or the target is `A`. With no paint DC (`1068:2d84 == 0`) it copies from `A`, or from `B` when `1068:429e != 0`.
- `1030:01c4(buf, x, y, w, h)` (`gfx_saveRectBits`): copies a rect of the source `1068:1eb6` into a caller buffer of `1030:0197(w, h)` = `(((w + 15) / 16 * 16) / 2) * h` bytes. `1030:0250` (`gfx_restoreRectBits`) puts it back into the target `1068:1eb8` and presents it.
- `1040:0286` (`gfx_blitPixelRows`): screens; clears `1068:2572`, so index 0 is drawn opaque in palette color 0 with `SRCCOPY`.

### Wipes (`1020`)

- `1020:0364(dc)`: with a non-zero `dc`, sets source = `dc`, target = `A`, and copies the whole screen (`1038:06ce`); no wipe. With 0, picks the wipe from the counter `1068:361a` (static 0): 0 ellipse, 1 rect, 2 right-to-left, 3 left-to-right, 4 top-to-bottom, 5 bottom-to-top, anything else resets to 1 and runs the ellipse; then increments. Draws on the window DC with the stock black brush (4) and black pen (7), centered in the client area, then fills the whole client area black. Called from `1018:0673` (story, chunk 7).
- `1020:0512` ellipse: half sizes `hw = w / 2`, `hh = h / 2`, center `(x + hw, y + hh)`, step `s` from 1, radius `r` from 1; each round `hw -= s`, `hh -= s`, `r += s`, `s += 1`, `Ellipse(cx - r, cy - r, cx + r, cy + r)`, while `hw > 0 || hh > 0` before the round.
- `1020:05a0` rect: `sx = cx / 50`, `sy = cy / 50` (center, not half size); `ix = sx`, `iy = sy`; each round `Rectangle(cx - ix, cy - iy, cx + ix, cy + iy)`, then `ix += sx`, `iy += sy`, `hw -= sx`, `hh -= sy`, while `hw > 0 || hh > 0`.
- `1020:0637` right-to-left: `s = w / 100`, `left = x + w - s`; each round `Rectangle(left, y, left + s, y + h)`, `left -= s`, `w -= s`, while `w > 0`. `1020:0688` left-to-right: `left = x`, `left += s`.
- `1020:06d2` top-to-bottom: `s = h / 200`, `top = y`; `Rectangle(x, top, x + w, top + s)`, `top += s`, `h -= s`, while `h > 0`. `1020:071c` bottom-to-top: `top = y + h - s`, `top -= s`.
- Every round pumps window messages (`1008:13cd`); there is no timer, so a wipe runs as fast as the machine draws.

## Shared pieces

Made by earlier chunks (exist now):

- TypeScript: `src/types.ts` (`SCREEN_W = 640`, `SCREEN_H = 480`, `TRANSPARENT = 0xff`, `Sprite { width; height; indexed }`, `Palette` = 16 × RGBA `Uint8Array`), `src/decode/bmp.ts` (`decodeBmp(payload): { sprites: Sprite[] }`, index 0 → `TRANSPARENT`), `src/decode/scr.ts` (`decodeScr(payload): { width; height; indexed }`, index 0 → `TRANSPARENT`), `src/decode/nibbles.ts` (`unpackNibbles`), `src/testing/nibbles.ts` (`packNibbles(indexed)`: `TRANSPARENT` back to 0, high nibble first), `src/testing/corpus.ts` (`hasCorpus`, `hasFixture(path)`, `readFixtureRows(path)`, `readFixtureBytes(path)`, `loadArchive()` → `{ byName, list }` of `{ name; type; payload }`).
- Python (`scripts/re/unicorn/`): `emulator.py` (`Emulator(image)`, `call_far(address, stack_words=[...])`, `add_stub(module, ordinal, handler, arg_bytes)`, `replace_function(address, handler)`, `arg(i)`, `near_alloc`, `alloc`, `read`, `write`, `data_segment`), `ne_image.py` (`NeImage.load(path)`), `original_decompress.py` (`install_heap(emu)`: replaces near calloc `1038:06a8`, near free `1038:063b`, far alloc `1030:199a`, far free `1030:1b63`), `original_loaders.py` (`read_word(emu, segment, offset)`, `put_string`), `corpus.py` (`load_resources`, `walk_chunks`), `dump_loaders.py` (wrote `re/fixtures/loaders/bitmaps.tsv`: `resource`, `widths`, `heights`, `file`, and `<NAME>.BMP.packed.bin`: the original's packed top-down pixel buffer for every image of that BMP, back to back, `(width / 2) * height` bytes each).

Made in this chunk:

- `scripts/re/unicorn/original_graphics.py` (step 1, extended by steps 4 and 6): `new_graphics_emulator(image) -> Emulator` (`install_heap` plus `1038:0619` near malloc), `pascal_args(emu, count) -> list[int]` (Pascal import arguments in declared order), `set_byte(emu, offset, value)`, `set_word(emu, offset, value)`.
- `scripts/re/unicorn/dump_graphics.py` (step 1, extended by steps 4 and 6): CLI `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py [what ...]`, writes TSV fixtures to `re/fixtures/graphics/`. `COMMANDS` dict; each step adds its command.
- `scripts/re/unicorn/test_original_graphics.py` (step 1, extended): unit tests, skipped without `public/data/SCRANTIC.SCR`.
- `src/gfx/gdi/` (steps 1 to 5): see each step's Interfaces block. Summary: `color.ts` (`colorIndex`, `ditherPattern`, `brushColorAt`), `surface.ts` (`Surface`, `ClipRect`, `DrawState`, `makeSurface`, `makeDrawState`, `activeClip`, `rawIndices`), `primitives.ts` (`setPixel`, `drawLine`, `drawRect`, `drawCircle`), `sprite.ts` (`FLIP_VERTICAL`, `MIRROR`, `spriteSurface`, `drawSprite`, `drawSpriteStretched`), `dirty.ts` (`DirtyLists`), `display.ts` (`Display`).
- `docs/re/graphics.md` (step 1 creates, every step extends). Sections, in this order: `Colors`, `Bitmap masks and mirrors`, `Surfaces and clip`, `Primitives`, `Text`, `Sprites`, `Scaling (dead code)`, `Bitmap matrix`, `Dirty rects`, `Display buffers`, `Wipes`, `Past fixes reviewed` (step 7), `Side-by-side checklist`. One claim per bullet, each starting with its address:

```markdown
- `1038:1bd8`: with the fill flag off, or a width or height under 2, draws only the outline.
```

Side-by-side checklist rows:

```markdown
| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1038:1bd8` | `gfx_drawRect` | `src/gfx/gdi/primitives.ts:40` | fixed |
```

Status is `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). `fixed` here means our model now does what the original does. Functions with no TypeScript counterpart write `none (reason)` in the Ours column and count as `match` when the finding explains why nothing is needed.

## Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- Colors and bitmap builders: `1040:097a`, `1038:1d31`, `1040:0000`, `1040:035c`, `1040:0462`, `1040:054e`, `1040:0b08`, `1040:0bc7`, `1030:00fe`, `1030:0000`, `1028:182c`, `1028:1845` (step 1).
- Surfaces, clip, primitives, text: `1038:1744`, `1038:194e`, `1038:1ade`, `1040:0d54`, `1030:02ef`, `1038:1bd8`, `1040:0688`, `1030:04ee`, `1030:04ce`, `1030:0765` (step 2).
- Sprites, scaling, matrix: `1038:0ae4`, `1038:0ac2`, `1030:03d7`, `1038:0de1`, `1038:0e8a`, `1038:109e`, `1038:1485`, `1038:19c7`, `1028:17d8`, `1040:10ef`, `1040:1113`, `1040:1183` (step 3).
- Dirty rects: `1060:0000 007e 03d3 046e 04b2 0556 0596 05a7 05f9 06ac 06f5` (step 4).
- Display buffers: `1038:06ce`, `1038:07e8`, `1030:01c4`, `1030:0250`, `1030:0197`, `1040:0286`, `1040:034e` (step 5).
- Wipes: `1020:0364 0512 05a0 0637 0688 06d2 071c` (step 6).

Read but not in scope (leave as they are): timer callbacks `1040:076a 079e 07e6 085a 089a` (chunk 7), `1040:0c13 0c21 0c31` (tiny getters, the TTM interpreter calls `1040:0c21`; chunk 5), cursors `1030:07c3`..`1030:0cbc` and `1008:0517` (UI, out of scope), `1050:0a85` and every `1058` function (chunk 5).

## Steps

- [x] `step-001-colors-and-bitmap-masks.md`: Unicorn harness for graphics, dither brush and mask/mirror builders checked on every bitmap, `src/gfx/gdi/color.ts`, findings file created.
- [ ] `step-002-surfaces-and-primitives.md`: `src/gfx/gdi/surface.ts` and `primitives.ts` (pixel, line, rect, circle, clip, dither fill) from the side-by-side review; text logged.
- [ ] `step-003-sprites.md`: `src/gfx/gdi/sprite.ts` (mask-and-OR blit, mirror, flip, stretch); scaling and matrix code explained; corpus snapshot.
- [ ] `step-004-dirty-rect-lists.md`: `src/gfx/gdi/dirty.ts`, a literal port of the `1060` list code (add, merge, replay, restore pass), compared with the original in Unicorn on random sequences.
- [ ] `step-005-display-buffers.md`: `src/gfx/gdi/display.ts` (three surfaces, 8-pixel copy, save/restore bits, screen blit, restore pass, presented surface); OQ-9 settled for the model.
- [ ] `step-006-wipes.md`: wipe geometry checked in Unicorn; `src/gfx/fade.ts` draws the original six wipes.
- [ ] `step-007-chunk-wrap-up.md`: every in-scope function `verified` or logged, comment audit of `src/gfx/`, past-fix review, full test run, smoke test, spec checkbox ticked.

Order: step 1 first (harness, findings file, `color.ts`). Step 2 needs step 1 (`color.ts`). Step 3 needs step 2 (`surface.ts`). Step 4 needs step 1 (harness) and the `ClipRect` type from step 2. Step 5 needs steps 2, 3, and 4. Step 6 needs step 1 (harness) and step 4 (`signed` in the harness, `json` in `dump_graphics.py`); its TypeScript change does not depend on the model. Steps extend the same findings file, `names.json`, `original_graphics.py`, and `dump_graphics.py`, so run them one at a time, in number order. Step 7 needs all of them.

## Leftovers Protocol

Finishing your step completely is the goal. `step-999-leftovers.md` is a
last resort for work that genuinely cannot happen in your session (a missing
credential, an upstream bug, a discovery that changes scope). It is not a
place to park work that is hard, boring, or long.

If you must defer something, append an entry to `step-999-leftovers.md` in
this directory (create the file if it doesn't exist):

### [step file] - [short title]

- **What:** the undone work, specific enough to act on without your
  session's context
- **Why deferred:** the concrete blocker
- **Where:** files and tests involved
- **Done when:** how to verify it's resolved

Write down everything you defer. If it's not done and not in leftovers,
it's lost.
