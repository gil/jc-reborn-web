# Step 6: Chunk 3 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-chunk-lookup.md`, `step-002-palette-and-screen.md`, `step-003-bitmaps.md`, `step-004-ttm-loader.md`, `step-005-ads-loader.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/decoders.md`, `docs/re/open-questions.md`, `docs/re/segments.md`
- Modify (comments and dead code only): `src/decode/*.ts`, `src/testing/*.ts`, `src/gfx/palette.ts`, `src/io/binary-reader.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick a checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 5 produced. `docs/re/decoders.md` has the sections `Chunk reader`, `Emulated edge cases`, `Palette`, `Screen`, `Pixels`, `Bitmap`, `Bitmap matrix`, `TTM loader`, `TTM opcode coverage`, `ADS loader`, `ADS opcode coverage`, `Thunks`, `Side-by-side checklist`. `node scripts/re/function-map.mjs` validates `names.json` and regenerates `docs/re/function-map.md`. `scripts/re/ghidra-import.sh` rebuilds `re/out/`. `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py` rebuilds `re/fixtures/decompressed/`. `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py` rebuilds every fixture in `re/fixtures/loaders/` (`chunks.tsv`, `palette.tsv`, `screens.tsv`, `bitmaps.tsv`, `ttm.tsv`, `ads-arg-counts.tsv`, plus `.bin` files).
- Produces: chunk 3 meets the spec's "done" rule: every in-scope function `verified` or listed in `docs/re/open-questions.md`, tests green with data present, no unbacked comment left in chunk 3 files.

The spec's done rule for a chunk:

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

## Part A: Thunks left from chunk 2

- [ ] **Action 1: Read the `1028` thunks**

Chunk 2 left `1028:17c8`..`1028:1b0d` (50 small functions) for this chunk. A planning look found: `1028:17fa` forwards to `decoders_loadBmp`, `1028:1813` to `decoders_loadScreen`, `1028:17d8` to `1038:0ae4`, `1028:182c` to `1030:15fb`, `1028:1845` to `1030:00fe`, and the rest (`1028:17c8` and `1028:185e`..`1028:1b0d`) only return 0. List them:

Run: `rg -n "^1028:1[789ab]" re/out/index.tsv`
Expected: 50 rows; column 6 holds the callers.

For the 44 that return 0, look for anything that points at them (segment 6 is `1028`; the last relocation value is the target offset in decimal):

Run: `rg -n ",6,(6088|6238|6254)$" re/out/relocations.tsv`
Expected: rows for `1028:17c8` (6088), `1028:185e` (6238), `1028:186e` (6254), if they are referenced from a table. Repeat for the rest as needed, or write a short `node --input-type=module -e` one-off that prints every relocation row whose target is segment 6 at an offset between `0x17c8` and `0x1b0d`.

Write under `Thunks` in `docs/re/decoders.md`: one bullet per forwarder (what it forwards to, who calls it), one bullet for the return-0 group (how many, who references them: a table at which address, or nothing).

- [ ] **Action 2: Name the thunks**

In `scripts/re/names.json`: `1028:17fa` `decoders_callLoadBmp` and `1028:1813` `decoders_callLoadScreen`, status `verified` (they only forward their argument; the loaders behind them are checked). Leave the other three forwarders and the return-0 group unnamed or `named` with a `gfx_`/`platform_` name if their target's role is plain from the code. Add one entry to `docs/re/open-questions.md` under "Not reviewed on purpose":

```markdown
### OQ-<n>: `1028` thunks that do not reach a decoder

- **Where:** `1028:17d8`, `1028:182c`, `1028:1845`, and the return-0 group `1028:17c8`, `1028:185e`..`1028:1b0d`
- **What it does:** three forward to graphics code (`1038:0ae4`, `1030:15fb`, `1030:00fe`); the rest return 0. <who references them, from Action 1>
- **Why not reviewed:** none of them reaches a decoder; their targets belong to graphics or to whatever table references the stubs.
- **Resolve in:** chunk 4 (graphics) for the three forwarders; <the chunk that owns the referencing table> for the return-0 group
- **Status:** open, by choice
```

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

## Part B: Promote and check

- [ ] **Action 3: Promote checked functions to `verified`**

`verified` means: fully read, findings written in `docs/re/decoders.md`, and its checklist row is `match` or `fixed`. For every in-scope function that meets that, set `"status": "verified"` in `scripts/re/names.json`. In scope (from the overview):

- `1038:0000 003a 0091 00d2 0119 016b 01da 0215 0517 054b 0584 0619`
- `1040:09eb`, `1030:16d8`
- `1030:000e 1112 124a 15cc 1624`, `1040:0db0`
- `1050:013e 0177 03e2 042a 04a8 04d6`
- `1048:0044 0079 0303 04fc` (`1048:040f` stays `named`, it is in an open question for chunk 6)

Leave `named` anything whose checklist row is `open`. Functions named along the way that belong to other chunks (`1040:0000`, `1040:035c`, `1040:0462`, `1040:0b08`, `1040:0bc7`, `1038:1744`, `rtl_` helpers) stay `named`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 4: List what is still not verified**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync('scripts/re/names.json', 'utf8')).functions;
const addresses = readFileSync('re/out/index.tsv', 'utf8').trimEnd().split('\n').slice(1).map((row) => row.split('\t')[0]);
const listed = ['1038:0000','1038:003a','1038:0091','1038:00d2','1038:0119','1038:016b','1038:01da','1038:0215','1038:0517','1038:054b','1038:0584','1038:0619','1040:09eb','1030:16d8','1030:000e','1030:1112','1030:124a','1030:15cc','1030:1624','1040:0db0','1050:013e','1050:0177','1050:03e2','1050:042a','1050:04a8','1050:04d6','1048:0044','1048:0079','1048:0303','1048:040f','1048:04fc'];
const inScope = (a) => listed.includes(a) || (a >= '1028:17c8' && a <= '1028:1b0d');
for (const a of addresses.filter(inScope)) if (names[a]?.status !== 'verified') console.log(a, names[a]?.name ?? 'unknown', names[a]?.status ?? '');
"
```

Expected: only addresses that appear in `docs/re/open-questions.md`. Check each printed address with `rg -n "<address>" docs/re/open-questions.md` (the return-0 group is covered by the range `1028:185e`..`1028:1b0d` in its entry). For any that is missing from both, go back and read it, write its finding and checklist row, and mark it `verified`; or add an open-questions entry saying exactly what is unknown.

- [ ] **Action 5: Check the carry-over notes for chunks 5 and 6**

The user asked that everything this chunk leaves in the scheduler be noted for chunk 6.

Run: `rg -n "Resolve in:\*\* chunk 6" docs/re/open-questions.md`
Expected: the entries from step 5 (the scheduler's own size table and section scan, the per-section scene lists, a missing TTM not failing the ADS load), next to the older chunk 6 entries.

Run: `rg -n "Resolve in:\*\* chunk 5" docs/re/open-questions.md`
Expected: the step 4 entry (the TTM interpreter's own framing and tag lookup) and OQ-8.

If one is missing, add it now from the step file's text (step 4 Action 16, step 5 Action 16).

## Part C: Comments and dead code

- [ ] **Action 6: Audit the comments in chunk 3 files**

Run: `rg -n "//|/\*" src/decode src/testing src/gfx/palette.ts`

For each comment, apply the rule from the overview: keep it only if a competent engineer would be surprised without it, and only if `docs/re/decoders.md` backs its claim. Rewrite or delete the rest. Known comments to judge:

- `src/decode/ads-bytecode.ts`: the comment on section offsets (backed by `1048:04fc`; keep).
- `src/decode/pal.ts`: none expected; the old `/* 256 × RGB, channels 0-63 */` is gone with the rewrite. Confirm.
- Any `// SCRANTIC ssss:oooo` test citation stays.

Comments in `src/ads/` and `src/ttm/` are chunks 5 and 6; leave them.

- [ ] **Action 7: Remove dead code**

Run: `rg -n "\.expect\(" src`
Expected: no matches (every decoder now uses `chunkBody`). If so, delete the `expect` method from `src/io/binary-reader.ts`.

Run: `rg -n "readUntilNul|BinaryReader" src/decode`
Expected: no matches.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 8: Update the segment overview**

In `docs/re/segments.md`, update the rows for Code7 (`1030`), Code8 (`1038`), Code9 (`1040`), Code10 (`1048`), Code11 (`1050`), and Code6 (`1028`, the thunks) with what chunk 3 learned: `1030` holds the BMP and SCR loaders; `1038:0000`..`1038:0619` is the chunk reader every loader uses; `1040` holds the palette loader, the bitmap matrix loader, and the bitmap builder; `1048` starts with the ADS loader and its size table; `1050` starts with the TTM loader and page index. Add under "Tables found", one line each: `1068:414e` (4 chunk reader records, `0x43` bytes), `1068:425a` (chunk reader backup), `1068:25b0` (palette level table), `1068:45e4` (palette slots), `1068:460c` (10 ADS slots), `1068:2634` / `1068:2638` (TTM record list and current record), `1068:263c` (TTM tag records), `1048:0383` (ADS size table, in the code segment), `1068:260a` (ADS scene opcodes), `1068:1e24`, `1068:2574`, `1068:2578` (bitmap function pointers).

- [ ] **Action 9: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/open-questions.md docs/re/decoders.md docs/re/segments.md src/decode src/testing src/gfx/palette.ts src/io/binary-reader.ts
git commit -m "docs(re): chunk 3 functions verified, comments audited"
```

## Part D: Full verification

- [ ] **Action 10: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py`
Expected: last line `180 chunks, 0 short`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py`
Expected: one line per fixture: `ads-arg-counts.tsv: 34 rows`, `bitmaps.tsv: 117 rows`, `chunks.tsv: <n> rows`, `palette.tsv: 16 rows`, `screens.tsv: 10 rows`, `ttm.tsv: 41 rows`.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/decode/chunks.data.test.ts`, `src/decode/pal.data.test.ts`, `src/decode/scr.data.test.ts`, `src/decode/bmp.data.test.ts`, `src/decode/ttm-loader.data.test.ts`, `src/decode/ads-loader.data.test.ts`, plus chunk 2's `src/resource/*.data.test.ts` and `scripts/re/export.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 11: Smoke test in the browser**

Run in the background: `pnpm dev`
Expected: Vite prints a local URL, usually `http://localhost:5173/`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm:

- `/`: the island scene draws and animates. Colors may look a little darker than before: the palette now follows the original level table (for example level 32 gives 128, not 130). That is expected.
- `/debug.html`: screens and bitmap sheets draw; a TTM shows its disassembly; an ADS shows its `subs=` and `tags=` lines.

You cannot see the canvas yourself; do not mark this action done without their answer.

Stop the dev server by the job id or PID you started it with. Never kill by name.

- [ ] **Action 12: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **3. Decoders.**` to `- [x]`. Change nothing else in that file.

- [ ] **Action 13: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 3 (decoders) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
