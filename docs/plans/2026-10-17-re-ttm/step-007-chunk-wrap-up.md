# Step 7: Chunk 5 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-jump-tables-in-export.md` through `step-006-wire-engine.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/ttm.md` (`Past fixes reviewed`, checklist check), `docs/re/open-questions.md`, `docs/re/decoders.md` (`TTM opcode coverage`), `docs/re/segments.md`
- Modify (comments only): `src/ttm/*.ts`, `src/ads/scheduler.ts`, `src/island/island.ts`, `src/walk/walk.ts`, `src/story/story.ts`, `src/main.ts`, `src/gfx/present.ts`, `src/testing/ttm-recorder.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick one checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 6 produced. `docs/re/ttm.md` with sections `Page runner`, `Arguments and offsets`, `Thread and record state`, `Opcodes`, `Drawing and dirty rects`, `Resources`, `Palettes`, `Zones and effects`, `Delays`, `Text and fonts`, `Stubs and dead branches`, `Unloading`, `ADS side`, `Emulated`, `Past fixes reviewed`, `Side-by-side checklist`. `node scripts/re/function-map.mjs` validates `names.json` and regenerates `docs/re/function-map.md`. `scripts/re/ghidra-import.sh` rebuilds `re/out/` (with the jump tables of step 1). `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py` rebuilds `re/fixtures/ttm/traces.tsv`. TypeScript: `src/ttm/{opcodes,state,device,page-runner,gdi-device}.ts`, `src/testing/ttm-recorder.ts`, `src/gfx/present.ts`, and the step 6 engine changes.
- Produces: chunk 5 meets the spec's "done" rule.

The spec's done rule for a chunk:

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

## Part A: Status

- [ ] **Action 1: List what is still not verified**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync('scripts/re/names.json', 'utf8')).functions;
const scope = ['1050:0000','1050:0061','1050:0152','1050:074a','1050:0799','1050:07c6','1050:080c','1050:0a6e','1050:0a85','1050:0b31','1050:0b74','1058:0000','1058:0144','1058:040c','1058:13a9','1058:141f','1058:147a','1058:14a8','1058:14e0','1058:1510','1058:1920','1058:1949','1058:197c','1058:198a','1058:1ad0','1058:1b1f','1058:1be1','1058:1c06','1030:07c3','1030:07d4','1040:0c13','1040:0c21','1040:0c31','1030:04ee','1030:04ce','1030:0765'];
for (const a of scope) if (names[a]?.status !== 'verified') console.log(a, names[a]?.name ?? 'unknown', names[a]?.status ?? '');
"
```

Expected: only addresses that appear in `docs/re/open-questions.md`. Check each with `rg -n "<address>" docs/re/open-questions.md`. For any that is missing from both, read it in `re/out/`, write its finding and checklist row in `docs/re/ttm.md`, and set its status to `verified` in `scripts/re/names.json`; or add an open-questions entry saying exactly what is unknown. Then run `node scripts/re/function-map.mjs`.

- [ ] **Action 2: Check the checklist**

Every address in the scope list above has exactly one row in the `Side-by-side checklist` of `docs/re/ttm.md`, and every `open` row has an entry in `docs/re/open-questions.md` that names that address. Rows written in steps 4 and 5 point at `src/ttm/page-runner.ts`, `src/ttm/gdi-device.ts`, and `src/gfx/gdi/display.ts`; check that their line numbers still match (`rg -n "function runPage|function drawOpcode|function zoneEffect|function addDrawnRect|function screenToBackground|function copyToBackground|function surfaceByNumber|export function pageOfTag|export function activatePendingPalette" src/ttm/page-runner.ts`). Fix whatever is missing or stale.

- [ ] **Action 3: Check the carry-over notes**

Run: `rg -n "Resolve in:\*\* chunk 5" docs/re/open-questions.md`
Expected: every match belongs to an entry whose status is `resolved (chunk 5)` or `open, by choice`. That covers OQ-8, OQ-9, OQ-10, OQ-14, OQ-16, OQ-17, OQ-19, OQ-20. Any other open entry with chunk 5 is either finished now or moved to the chunk that owns it, with a sentence saying why.

Run: `rg -n "Resolve in:\*\* chunk (6|7|8)" docs/re/open-questions.md`
Expected, at least: OQ-22 (chunk 6), OQ-24, OQ-26, OQ-28 (chunk 7), OQ-25 (chunk 8), plus the older entries.

Run: `rg -n "interpreter\.ts|thread\.ts|bmp-slots\.ts|compositor\.ts|zone\.ts|gfx/layer|gfx/primitives\.ts|gfx/sprite\.ts|gfx/clip" docs/re`
Expected: matches only in resolved entries, past-fix notes, or text that says the file was deleted. Any open entry (OQ-1 to OQ-6 and others) whose `Where` names a deleted file or a stale line gets the current file and line.

## Part B: Past fixes

- [ ] **Action 4: Review the chunk 5 rows of "Past fixes to re-check"**

The table in `docs/re/open-questions.md` lists these commits for chunk 5: `d670686` (SET_DELAY missing timer), `5f4e3a0` (DRAW_RECT/DRAW_CIRCLE no longer offset width and height), `9a40bb2` (LOAD_SCREEN resets dx/dy), `0d4078d` (DRAW_BACKGROUND is a no-op), `7a9d964` (TIMER sets delay and timer directly), `e1d3bae` (GOTO_TAG defers the jump), `cacfdb0` (PURGE schedules a jump), `31988b3` (revert DRAW_SCREEN), `2ed4424` (GOTO_TAG must yield), `c7f3c6b` (DRAW_SCREEN for scaled sprites), `037819f` (GOTO_TAG searched LOCAL_TAG instead of TAG). For each:

Run: `git show --stat <commit>` and `git show <commit> -- src/ttm src/ads`

Compare what it changed with the findings. Write one bullet per commit under `Past fixes reviewed` in `docs/re/ttm.md`:

```markdown
- `<commit>` (<summary>): <what it changed, in one sentence>. Original: <what the findings say, with the address>. Verdict: <matches the original | differs: ... | only mattered in the old interpreter; replaced by src/ttm/page-runner.ts>.
```

Hints from the findings (overview, `Opcodes` and `Page runner`):

- Delays: `0x1021` sets the delay with no minimum (`1058:0e37`); the scheduler turns it into a due time (`1048:1acb`). `0x2022` is a random delay (`1058:0e08`), not an average.
- Offsets: the island offset goes on args 0 and 1 only, except `0x4004` and `0xa0a4`, which get it on both corners (`1058:0602` table); width and height never get it.
- `0xf01f` loads onto B and copies B to C (`1058:06c5`, `1050:0b31`); it does not touch the island offsets.
- `0x0080` frees the BMP slot's images (`1058:0806`); it draws nothing.
- Gotos: `1058:13a9` finds the page whose first instruction is a `0x1101` or `0x1111` with the tag; the jump happens when the page ends (`1048:196e` moves to node `[3]`), and a page always ends at `0x0FF0`.
- Purge: `0x0110` only sets a flag (`1058:0f73`); the scheduler sends the thread back to its tag page (`1048:1acb`).
- `0xb606` copies a rect between surfaces, C to B in all 6 uses (`1058:0eb4`); it does not scale. Stretched sprites are `0xa5x6` (`1030:03d7`), unused in the data.

Then, in the table, change the Chunk cell of each reviewed row from `5` to `5 (reviewed, see docs/re/ttm.md)`. Change nothing else in the table.

## Part C: Comments and docs

- [ ] **Action 5: Audit the comments**

Run: `rg -n "//|/\*" src/ttm src/testing/ttm-recorder.ts src/gfx/present.ts src/ads/scheduler.ts src/island/island.ts src/walk/walk.ts src/story/story.ts src/main.ts`

For each comment, apply the overview's rule: keep it only if a competent engineer would be surprised without it, and only if `docs/re/ttm.md` (or `graphics.md`) backs its claim. Test citations `// SCRANTIC ssss:oooo` stay. Known comments to judge:

- `src/ads/scheduler.ts`: the block comments on `STOP_REQUEST_GRACE_TICKS`, `adsPlayChunk` (`stopAtPlayScene`), the tag-boundary note, `// Local triggers first`, the section dividers (`// ------- ... -------`), and field comments in `AdsState` and `WalkContext`. These are chunk 6 logic; keep those that are true of the current code and needed, and do not add new claims. Delete any that mention layers, lingering frames, or `ip`.
- `src/island/island.ts`: `// xPos/yPos ranges from story.c:135-144`, `// Clouds (grDx=grDy=0 in C — no island offset)`, the per-sprite labels (`// island body`, `// trunk`, ...), `// Called every 8 ticks (delay set in adsInitIsland).`, and the `IslandState` field comments. They describe jc_reborn, not the original. Replace the ones that cite jc_reborn files with a pointer to OQ-24 where the code would be surprising without a note; keep the short sprite labels; delete the rest.
- `src/walk/walk.ts`: the comments on phases and `// Redraw palm tree on top when Johnny is behind it`. Chunk 8 logic: keep those that are true and needed.
- `src/story/story.ts`: `// Island wave animation — call each game tick with elapsed ticks` and the phase-transition comments. Delete those that mention layers, primed frames, or "empty layer"; keep the rest unchanged.
- `src/main.ts`: the pacing comment (`Advance the engine one mini-step ...`) and `// fire-and-forget: ...`. Keep if true.
- `src/types.ts`: `// length 64 = 16 entries × RGBA` and the `Sprite.indexed` comment. Keep.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 6: Update the TTM opcode coverage**

In `docs/re/decoders.md`, `TTM opcode coverage`, for each row: set `Our name` to the key in `src/ttm/opcodes.ts` (`OP`), and `Our handler` to `src/ttm/page-runner.ts:<line>` of the code that handles it (`controlOpcode`, `drawOpcode`, `markDrawn`, `zoneEffect`, or the `0xc000` branch of `runPage`), with a short note where it does nothing on purpose (for example `nothing (tag, read by pageOfTag)`, `nothing (1058:0860)`). Add one sentence under the table: `Handlers were checked against the original in chunk 5 (docs/re/ttm.md).`

Run: `rg -n "interpreter\.ts" docs/re/decoders.md`
Expected: no output.

- [ ] **Action 7: Update the segment overview**

In `docs/re/segments.md`, update the rows for Code12 (`1058`: the TTM page runner, opcode handlers, effects) and Code11 (`1050`: TTM setup, page check, pending palette, dirty-rect helper, screen to background), and add one line each under "Tables found": `1068:46d8` (replay flag), `1068:4644` (goto page), `1068:4642` (purge flag), `1068:46e6` (delay), `1068:4646` (pending palette), `1068:46d6` / `1068:4106` (mirror next load), `1068:27c0` (keep drawings), `1068:27c2` (page-call depth), `1068:46e4` / `1068:46e2` (island offsets), `1068:46e0` / `1068:46de` (page-call offsets), `1068:4640` (screen loaded), `1068:30d2` (shared walk bitmaps), `1068:263c` / `1068:263e` (thread list, current thread), `1068:2638` (current TTM record), and the 11 jump tables of step 1 (`scripts/re/jump-tables.json`). If step 2 named a segment row differently, keep its wording and add what is missing.

- [ ] **Action 8: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/ttm.md docs/re/open-questions.md docs/re/decoders.md docs/re/segments.md src
git commit -m "docs(re): chunk 5 functions verified, past fixes reviewed, comments audited"
```

## Part D: Full verification

- [ ] **Action 9: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`, and `re/out/jump-tables.tsv` has 240 rows plus its header.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py`
Expected: exits 0; `re/fixtures/ttm/traces.tsv` exists and holds rows for 41 TTM scripts.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/ttm/page-runner.data.test.ts`, `src/ttm/gdi-device.data.test.ts`, `src/ads/scheduler.data.test.ts`, `src/island/island.data.test.ts`, `src/decode/ttm-loader.data.test.ts`, `src/gfx/gdi/display.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 10: Smoke test in the browser**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm:

- `/`: the intro, then the island with waves; Johnny walks and acts in scenes without trails, smears, or flicker; scene changes use the wipes. The same as at the end of step 6, or better.
- `/debug.html`: the resource picker works and `Demo primitives` draws a line, a rect, a circle, and a sprite plus its mirror over a screen.

You cannot see the canvas yourself; do not mark this action done without their answer. Anything wrong goes into the matching open question (or is fixed, if it is a crash or a blank screen).

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

- [ ] **Action 11: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **5. TTM interpreter.**` to `- [x]`. Change nothing else in that file.

- [ ] **Action 12: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 5 (TTM interpreter) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
