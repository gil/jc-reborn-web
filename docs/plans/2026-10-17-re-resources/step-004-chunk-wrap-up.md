# Step 4: Chunk 2 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-unicorn-original-decompressor.md`, `step-002-decompression-findings-and-fix.md`, `step-003-resource-map-and-archive.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/resources.md`, `docs/re/open-questions.md`, `docs/re/segments.md`
- Modify (comments only): `src/io/binary-reader.ts`, `src/io/fetch-resources.ts`, `src/resource/*.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick checkboxes only)

**Interfaces:**

- Consumes: everything steps 1 to 3 produced. `docs/re/resources.md` has the sections `Compressed stream`, `Emulated edge cases`, `Method table`, `RLE`, `LZW`, `Map and archive`, `Name hash`, `File layer`, `Side-by-side checklist`. `node scripts/re/function-map.mjs` validates `names.json` and regenerates `docs/re/function-map.md`. `scripts/re/ghidra-import.sh` rebuilds `re/out/`. `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py` rebuilds `re/fixtures/decompressed/`.
- Produces: chunk 2 meets the spec's "done" rule. Every in-scope function `verified` or logged, tests green with data present, no unbacked comment left in chunk 2 files.

The spec's done rule for a chunk:

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

- [ ] **Action 1: Promote checked functions to `verified`**

`verified` means: fully read, findings written in `docs/re/resources.md`, and its checklist row is `match` or `fixed`. For every in-scope function that meets that, set `"status": "verified"` in `scripts/re/names.json`. Leave `named` for anything listed in `docs/re/open-questions.md` (for example the compress side under OQ-7). Runtime library and `platform_` helpers named along the way are out of scope; leave them `named`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 2: List what is still not verified**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync('scripts/re/names.json', 'utf8')).functions;
const addresses = readFileSync('re/out/index.tsv', 'utf8').trimEnd().split('\n').slice(1).map((row) => row.split('\t')[0]);
const inScope = (a) => (a >= '1028:0000' && a <= '1028:1797') || (a >= '1018:1008' && a <= '1018:1d70');
for (const a of addresses.filter(inScope)) if (names[a]?.status !== 'verified') console.log(a, names[a]?.name ?? 'unknown', names[a]?.status ?? '');
"
```

Expected: only addresses that appear in `docs/re/open-questions.md`. Check each printed address with `rg -n "<address>" docs/re/open-questions.md`. For any that is missing from both, go back and read it, write its finding and checklist row, and mark it `verified`; or add an open-questions entry saying exactly what is unknown.

- [ ] **Action 3: Audit the comments in chunk 2 files**

Run: `rg -n "//|/\*" src/io src/resource src/testing`

For each comment, apply the rule from the overview: keep it only if a competent engineer would be surprised without it, and only if `docs/re/resources.md` backs its claim. Rewrite or delete the rest. Known comments to judge:

- `src/io/binary-reader.ts`: `// copy so callers can keep it past pos changes` (about our code, not the original; keep if still true).
- `src/resource/types.ts`: `// e.g. "JOHNNY.TTM"`, `// ".TTM", ".BMP", etc.`, `// raw bytes (post-13-byte name, post-uint32 size header)`. The last is backed by the `1018:1019` finding; the first two restate the field name.
- `// SCRANTIC ssss:oooo` test citations stay.

Also check the four decoders touched in step 2 (`src/decode/scr.ts`, `bmp.ts`, `ttm-loader.ts`, `ads-loader.ts`): only the lines step 2 changed are chunk 2's. Leave their other comments for chunk 3.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 4: Update the segment overview**

In `docs/re/segments.md`, update the rows for Code4 (`1018`) and Code6 (`1028`) with what chunk 2 learned: `1028` holds the decompression stream and the RLE and LZW codecs (both directions); `1018` holds the resource map, name hash, and the virtual file layer. Add the method table (`1068:1dc2`), the stream slot table (`1068:3f66`), and the open-file slots (`1068:3499`) under "Tables found", each with one line.

- [ ] **Action 5: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/open-questions.md docs/re/resources.md docs/re/segments.md src/io src/resource
git commit -m "docs(re): chunk 2 functions verified, comments audited"
```

## Full verification

- [ ] **Action 6: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py`
Expected: last line `180 chunks, 0 short` (or the short count recorded as a finding in step 1).

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/resource/uncompress.data.test.ts`, `src/resource/resource-map.data.test.ts`, `src/resource/resource-archive.data.test.ts`, `scripts/re/export.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 7: Smoke test in the browser**

Run in the background: `pnpm dev`
Expected: Vite prints a local URL, usually `http://localhost:5173/`.

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm: the island scene draws and animates on `/`, and the sprites, palette, and screens show on `/debug.html`. You cannot see the canvas yourself; do not mark this action done without their answer.

Stop the dev server by the job id or PID you started it with. Never kill by name.

- [ ] **Action 8: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **2. Resources.**` to `- [x]`. If `- [ ] **1. Toolchain.**` is still unticked, tick it too (chunk 1 is done). Change nothing else in that file.

- [ ] **Action 9: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 2 (resources) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
