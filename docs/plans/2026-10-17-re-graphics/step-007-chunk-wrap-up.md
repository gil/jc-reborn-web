# Step 7: Chunk 4 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-colors-and-bitmap-masks.md` through `step-006-wipes.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/graphics.md` (`Past fixes reviewed`, checklist check), `docs/re/open-questions.md`, `docs/re/segments.md`
- Modify (comments only): `src/gfx/*.ts`, `src/gfx/gdi/*.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick one checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 6 produced. `docs/re/graphics.md` with sections `Colors`, `Bitmap masks and mirrors`, `Surfaces and clip`, `Primitives`, `Text`, `Sprites`, `Scaling (dead code)`, `Bitmap matrix`, `Dirty rects`, `Display buffers`, `Wipes`, `Past fixes reviewed`, `Side-by-side checklist`. `node scripts/re/function-map.mjs` validates `names.json` and regenerates `docs/re/function-map.md`. `scripts/re/ghidra-import.sh` rebuilds `re/out/`. `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py` rebuilds `re/fixtures/graphics/` (`brushes.tsv`, `masks.tsv` and `.bin` files, `dirty.tsv`, `restore-table.tsv`, `wipes.tsv`). Model files: `src/gfx/gdi/{color,surface,primitives,sprite,dirty,display}.ts`. Wired fix: `src/gfx/fade.ts`.
- Produces: chunk 4 meets the spec's "done" rule.

The spec's done rule for a chunk:

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

## Part A: Status

- [x] **Action 1: List what is still not verified**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync('scripts/re/names.json', 'utf8')).functions;
const scope = ['1040:097a','1038:1d31','1040:0000','1040:035c','1040:0462','1040:054e','1040:0b08','1040:0bc7','1030:00fe','1030:0000','1028:182c','1028:1845','1038:1744','1038:194e','1038:1ade','1040:0d54','1030:02ef','1038:1bd8','1040:0688','1030:04ee','1030:04ce','1030:0765','1038:0ae4','1038:0ac2','1030:03d7','1038:0de1','1038:0e8a','1038:109e','1038:1485','1038:19c7','1028:17d8','1040:10ef','1040:1113','1040:1183','1060:0000','1060:007e','1060:03d3','1060:046e','1060:04b2','1060:0556','1060:0596','1060:05a7','1060:05f9','1060:06ac','1060:06f5','1038:06ce','1038:07e8','1030:01c4','1030:0250','1030:0197','1040:0286','1040:034e','1020:0364','1020:0512','1020:05a0','1020:0637','1020:0688','1020:06d2','1020:071c'];
for (const a of scope) if (names[a]?.status !== 'verified') console.log(a, names[a]?.name ?? 'unknown', names[a]?.status ?? '');
"
```

Expected: only addresses that appear in `docs/re/open-questions.md`. Check each with `rg -n "<address>" docs/re/open-questions.md`. For any that is missing from both, read it, write its finding and checklist row, and mark it `verified`; or add an open-questions entry saying exactly what is unknown.

- [x] **Action 2: Check the checklist**

Every address in the scope list above has exactly one row in the `Side-by-side checklist` of `docs/re/graphics.md`, and every `open` row has an entry in `docs/re/open-questions.md` that names that address. Fix whatever is missing.

- [x] **Action 3: Check the carry-over notes**

Run: `rg -n "Resolve in:\*\* chunk 5" docs/re/open-questions.md`
Expected, at least: the model is not wired in; OQ-9 (screen index 0); text drawing; stretched sprites; dirty-rect presenting; OQ-14 (the return-0 stub group); plus the older chunk 5 entries (OQ-8, OQ-10).

Run: `rg -n "Resolve in:\*\* chunk 7" docs/re/open-questions.md`
Expected, at least: wipe speed, plus the older chunk 7 entries.

If one is missing, add it from the step that should have written it.

## Part B: Past fixes

- [x] **Action 4: Review the chunk 4 rows of "Past fixes to re-check"**

The table in `docs/re/open-questions.md` lists three commits for chunk 4: `85c05ad` (copyZoneToBg skips transparent pixels), `b631319` (animation sprites sometimes get cut), `43ef25b` (better color and transparency handling, chunks 3 and 4). For each:

Run: `git show --stat <commit>` and `git show <commit> -- src/gfx`

Compare what it changed with the findings. Write one bullet per commit under `Past fixes reviewed` in `docs/re/graphics.md`:

```markdown
- `<commit>` (<summary>): <what it changed, in one sentence>. Original: <what the findings say, with the address>. Verdict: <matches the original | differs: ... | only matters in the old pipeline; settled by the model in `src/gfx/gdi/...`>.
```

Hints from the findings: `copyZoneToBg` has no single original counterpart; the closest are the saved-rect and copy paths (`1030:01c4`, `1030:0250`, `1038:06ce`), which copy opaque, not skipping index 0. Sprites are see-through exactly at index 0 (`1038:0ae4`, `1040:035c`). Screens keep index 0 opaque (`1040:0286`, OQ-9).

Then, in the table, change the Chunk cell of each reviewed row from `4` (or `3, 4`) to `4 (reviewed, see docs/re/graphics.md)` (or `3, 4 (4 reviewed, ...)`). Change nothing else in the table.

## Part C: Comments

- [x] **Action 5: Audit the comments in `src/gfx/`**

Run: `rg -n "//|/\*" src/gfx`

For each comment, apply the overview's rule: keep it only if a competent engineer would be surprised without it, and only if `docs/re/graphics.md` backs its claim. Known comments to judge in the old pipeline (still wired until chunk 5):

- `src/gfx/zone.ts`: "Copies a rect of srcLayer into the saved-zones layer (grCopyZoneToBg)", "Width is extended by 2 to match the +2 glitch fix in graphics.c:248", "C SDL blit colorkey skips transparent source", "grSaveZone: no-op ...", "grRestoreZone: clears the ENTIRE saved-zones layer ...". These describe jc_reborn, not the original. Where the code would be surprising without a note (the `+ 2`, the no-ops), replace the comment with one line that points at the model open question, for example `// Old pipeline, copied from jc_reborn and not checked against the original; replaced by src/gfx/gdi/ (OQ-<n>).` Delete the rest.
- `src/gfx/sprite.ts`: "Column-by-column right-to-left flip, matching graphics.c:472-491". Delete.
- `src/gfx/primitives.ts`: "Bresenham — port of graphics.c:295-350", "graphics.c grDrawRect uses SDL_FillRect — filled rectangle", "graphics.c:369-453 — only even diameters, only true circles". Replace with the one-line old-pipeline pointer where the behavior differs from the original (rect always filled, circle only for even equal sizes), delete otherwise.
- `src/gfx/compositor.ts`: the field comments (`640*480 indexed; TRANSPARENT (0xff) = index 0`, `up to MAX_TTM_THREADS = 10`). Keep only what is true and needed.
- `src/gfx/fade.ts`: the one comment about concentric wipes (backed by `1020:0512`, `1020:05a0`; keep).
- `src/gfx/gdi/*.ts`: expect no comments besides the `mergeInto` notes if any; test citations `// SCRANTIC ssss:oooo` stay.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 6: Update the segment overview**

In `docs/re/segments.md`, update the rows for Code5 (`1020`: the wipe dispatcher and six wipes), Code7 (`1030`: line, text, stretched sprite, saved rects, bitmap free), Code8 (`1038`: copy and present rects, sprite blit, clip region, display setup, rect, brushes, scaling dead code), Code9 (`1040`: bitmap builders, mask, row flip and mirror, palette color, circle, pixel, palette select, matrix), and Code13 (`1060`: dirty-rect lists and restore pass). Add under "Tables found", one line each: `1068:46f0` (20 dirty-list heads), `1068:46ee` / `1068:46ec` (free nodes, pool count), `1068:287e` / `1068:2882` (restore table), `1068:287c` (`0xffff`, the saved-bits source), `1068:1ea3`..`1068:1eae` (clip and drawing state), `1068:1eb0`..`1068:1eb8` (DCs and source/target), `1068:45a0`..`1068:45a4` (the three bitmaps), `1068:361a` (wipe counter), `1068:2e74`..`1068:2e77` (scale modes, all 3).

- [x] **Action 7: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/graphics.md docs/re/open-questions.md docs/re/segments.md src/gfx
git commit -m "docs(re): chunk 4 functions verified, past fixes reviewed, comments audited"
```

## Part D: Full verification

- [x] **Action 8: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py`
Expected: exits 0; `re/fixtures/graphics/` holds `brushes.tsv`, `masks.tsv`, `dirty.tsv`, `restore-table.tsv`, `wipes.tsv`, and 234 `.bin` files.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/gfx/gdi/color.data.test.ts`, `src/gfx/gdi/masks.data.test.ts`, `src/gfx/gdi/sprite.data.test.ts`, `src/gfx/gdi/dirty.data.test.ts`, `src/gfx/gdi/display.data.test.ts`, `src/gfx/fade.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [x] **Action 9: Smoke test in the browser**

Run in the background: `pnpm dev`
Expected: Vite prints a local URL, usually `http://localhost:5173/`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm:

- `/`: the island scene draws and animates as before (the model is not wired in, so nothing else should change). Scene changes now use the six original wipes: ellipse, rect, right to left, left to right, top to bottom, bottom to top, then ellipse again, each ending on a black screen.
- `/debug.html`: unchanged.

You cannot see the canvas yourself; do not mark this action done without their answer.

Stop the dev server by the job id or PID you started it with. Never kill by name.

- [x] **Action 10: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **4. Graphics.**` to `- [x]`. Change nothing else in that file.

- [x] **Action 11: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 4 (graphics) done"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
