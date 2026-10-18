# Step 6: Chunk 6 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ads-findings.md` through `step-005-wire-engine.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/ads.md` (`Past fixes reviewed`, checklist check), `docs/re/open-questions.md`, `docs/re/decoders.md` (`ADS opcode coverage`), `docs/re/ttm.md` (`ADS side`, stale references only)
- Modify (comments only): `src/ads/*.ts`, `src/testing/ads-build.ts`, `src/testing/ads-trace.ts`, `src/walk/walk.ts`, `src/story/story.ts`, `src/main.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick one checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 5 produced. `docs/re/ads.md` with sections `Record and slots`, `Nodes`, `Sections`, `Tick`, `Page advance`, `Script runner`, `Blocks`, `Conditions`, `Scene operations`, `Random`, `Section control`, `Story interface`, `Loading and unloading`, `Unreferenced`, `Emulated`, `Side-by-side checklist`. `node scripts/re/function-map.mjs` validates `names.json` and regenerates `docs/re/function-map.md`. `scripts/re/ghidra-import.sh` rebuilds `re/out/`. `re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py` rebuilds `re/fixtures/ads/traces.tsv`; `dump_ttm.py` rebuilds `re/fixtures/ttm/traces.tsv`. TypeScript: `src/ads/{state,script,tick}.ts`, `src/testing/{ads-build,ads-trace}.ts`, `src/walk/walk.ts` (`startWalk`, `walkTick`), `src/story/story.ts` (`storyPlayScene`).
- Produces: chunk 6 meets the spec's "done" rule.

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
const scope = ['0000','001b','0079','0303','040f','04fc','067f','0766','0805','0874','0894','08b4','0920','0940','0960','0993','09e3','0a33','0a86','0ad9','0b3e','0bc5','0bf4','0c30','0c8d','0cda','0db6','0e2e','0e6e','0e9b','0ec8','0ef2','0f8c','106b','118a','11db','1223','1519','1925','196e','19e7','1a4b','1aaf','1acb','1e5a'].map((o) => '1048:' + o);
for (const a of scope) if (names[a]?.status !== 'verified') console.log(a, names[a]?.name ?? 'unknown', names[a]?.status ?? '');
"
```

Expected after step 4: the unreferenced functions (`0894`, `0920`, `0940`, `0993`, `09e3`, `0a33`, `0a86`, `0ad9`, `1a4b`, `1aaf`, `1e5a`), the helpers only they reach (`08b4`, `0960`), and the unload path (`0000`, `001b`, `067f`). For each:

- Unreferenced, or reached only from unreferenced functions: the `Unreferenced` section of `docs/re/ads.md` must describe it and say nothing calls it (confirm with `rg -n "<address>" re/out/index.tsv re/out/relocations.tsv`: no caller column entry, no relocation). Its checklist row reads `none (unreferenced)`, status `match`. Set it `verified`.
- `1048:0000`, `1048:001b`: run at startup and shutdown; nothing to free in JavaScript. Checklist `none (...)`, `match`; set `verified`.
- `1048:067f`: unloading when the story switches ADS is part of OQ-30. Leave it `named`; check that OQ-30 names `1048:067f`.

Then run `node scripts/re/function-map.mjs`.

- [x] **Action 2: Check the checklist**

Every address of the scope list has exactly one row in `Side-by-side checklist` of `docs/re/ads.md`, and every `open` row has an entry in `docs/re/open-questions.md` that names that address. Check that the `file:line` references still match:

Run: `rg -n "^export function|^function" src/ads/state.ts src/ads/script.ts src/ads/tick.ts`

Fix whatever is missing or stale.

- [x] **Action 3: Check the carry-over notes**

Run: `rg -n "Resolve in:\*\* chunk 6" docs/re/open-questions.md`
Expected: every match belongs to an entry whose status is `resolved (chunk 6)` (OQ-2, OQ-3, OQ-11, OQ-12, OQ-13, OQ-22) or `open, by choice`. Any other open entry with chunk 6 is either finished now or moved to the chunk that owns it, with a sentence saying why.

Run: `rg -n "Resolve in:\*\* chunk (7|8)" docs/re/open-questions.md`
Expected, at least: OQ-1, OQ-6, OQ-21, OQ-24, OQ-26, OQ-28, OQ-29, OQ-30 (chunk 7), OQ-25 (chunk 8).

Run: `rg -n "scheduler\.ts|ADS_ARG_COUNTS|adsPlayChunk|scanBytecode|walkCtx|mini" docs/re`
Expected: matches only in resolved entries, past-fix notes, or text that says the code was deleted. Fix any open entry or finding that still points at the old scheduler (for example the `Where` lines of OQ-6 or OQ-24, and the `ADS side` section of `docs/re/ttm.md`, which should end with a pointer to `docs/re/ads.md`).

## Part B: Past fixes

- [x] **Action 4: Review the chunk 6 rows of "Past fixes to re-check"**

The table in `docs/re/open-questions.md` lists these commits for chunk 6: `eb46290` (force-stop orphan TTM threads after ADS END), `8adc66a` (various consistency fixes; chunks 6, 7), `f47def5` and `7fef3c3` (mini-based pacing; no second pass in adsTick), `194d7fb` (thread leak sweeps; chunks 6, 7), `a933bf7` (UNKNOWN_6 back to a no-op), `a9610d3` (clear saved zones when a slot's threads stop), `966476f` (UNKNOWN_6 checks whether the scene runs), `27684eb` (threads rendering on top of each other), `c126833` (nothing would start after certain scenes), `db6d598` (flickering animation sprites). For each:

Run: `git show --stat <commit>` and `git show <commit> -- src/ads src/ttm src/story`

Compare what it changed with the findings. Add a section `Past fixes reviewed` to `docs/re/ads.md`, after `Emulated` and before `Side-by-side checklist`, with one bullet per commit:

```markdown
- `<commit>` (<summary>): <what it changed, in one sentence>. Original: <what the findings say, with the address>. Verdict: <matches the original | differs: ... | only mattered in the old scheduler; replaced by src/ads/tick.ts>.
```

Hints from the findings:

- Orphans and leaks (`eb46290`, `194d7fb`): `1048:0766` ignores self-goto nodes, nodes exist only for loaded TTMs (`1050:042a`, `1048:0bf4`), and `1018:06bf` does not tick the ADS during walks. OQ-2 to OQ-5.
- Pacing (`f47def5`, `7fef3c3`): `1048:196e` advances a page when the clock reaches its due time; every tick replays the current page of every playing node (`1048:1acb`). There is no `mini`.
- `0x4000` (`a933bf7`, `966476f`): `1048:0f8c` moves the scene's node to the end of the node list, so it draws last; it neither starts nor checks a scene.
- Draw order (`27684eb`): nodes run in list order, which is TTM load order then tag order (`1050:042a`), changed only by `0x4000` / `0x4010`.
- Scenes that never start (`c126833`): the section script runs from its start on every tick; a done node (mode 4) is visible to `0x1350` for exactly one pass before it turns idle (`1048:1acb`).
- Flicker (`db6d598`): every tick redraws every playing node's page (replay), and the dirty-rect restore of chunk 5 erases between ticks.
- Saved zones (`a9610d3`): the layer pipeline it patched was deleted in chunk 5 (`docs/re/ttm.md`, `Zones and effects`).
- `8adc66a`: review only its `src/ads` part here; its story part stays for chunk 7.

Then, in the table, change the Chunk cell of each reviewed row from `6` to `6 (reviewed, see docs/re/ads.md)`, and `6, 7` to `6 (reviewed, see docs/re/ads.md), 7`. Change nothing else in the table.

## Part C: Comments and docs

- [x] **Action 5: Audit the comments**

Run: `rg -n "//|/\*" src/ads src/testing/ads-build.ts src/testing/ads-trace.ts src/walk/walk.ts src/story/story.ts src/main.ts`

For each comment, apply the overview's rule: keep it only if a competent engineer would be surprised without it, and only if `docs/re/ads.md` backs its claim. Test citations `// SCRANTIC ssss:oooo` stay. Known comments to judge:

- `src/ads/script.ts`: `// 1068:463a, 4636 and 4638 are never written, ...`. Keep if `ads.md` (`Record and slots`, `Conditions`) says so.
- `src/walk/walk.ts`: the `walkTick` comment about the last frame, and the older phase comments. Walk logic is chunk 8: keep those that are true of the current code and needed; do not add new claims.
- `src/story/story.ts`: `// Chain instant phase transitions ...` and `// Island wave animation ...`. Chunk 7 logic: keep if true, delete any that mention threads or the old scheduler.
- `src/main.ts`: `// fire-and-forget: ...`. Keep if true. The old pacing comment must be gone.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 6: Update the ADS opcode coverage**

In `docs/re/decoders.md`, `ADS opcode coverage`:

- Rename the column `Scheduler args (ADS_ARG_COUNTS)` to `Our args` and fill it from `adsArgCount` (`src/decode/ads-bytecode.ts`): it now equals the original column on every row.
- Rename `Our name` to the key in `ADS_OP` (`src/ads/script.ts`), or the condition's meaning for `0x1010`..`0x13c1` (for example `if done (0x1350)`), and `Scheduler handler` to `Our handler`: `src/ads/script.ts:<line>` of the code that handles it (`runInstruction`, `conditionHolds`, `storyValueHolds`, `randomBlock`).
- Replace the sentence under the heading that mentions `scanBytecode` and `adsPlayChunk` with: `Handlers were checked against the original in chunk 6 (docs/re/ads.md).`

Run: `rg -n "scheduler\.ts|ADS_ARG_COUNTS" docs/re/decoders.md`
Expected: no output.

- [x] **Action 7: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/ads.md docs/re/open-questions.md docs/re/decoders.md docs/re/ttm.md src
git commit -m "docs(re): chunk 6 functions verified, past fixes reviewed, comments audited"
```

## Part D: Full verification

- [ ] **Action 8: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`; `re/out/functions/1048_118a_ads_whileEnd.c` exists.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py`
Expected: exits 0; `re/fixtures/ttm/traces.tsv` holds rows for 41 TTM scripts (step 2 changed how `TtmTracer` loads; this proves the chunk 5 trace did not move).

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py`
Expected: exits 0; `re/fixtures/ads/traces.tsv` has the same row count step 2 noted in `docs/re/ads.md`, `Emulated`.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/ads/tick.data.test.ts`, `src/walk/walk.data.test.ts`, `src/ttm/page-runner.data.test.ts`, `src/ttm/gdi-device.data.test.ts`, `src/decode/ads-loader.data.test.ts`, `src/island/island.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 9: Smoke test in the browser**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm:

- `/`: the intro, then the island; scenes start, play, and end; Johnny walks between them; no scene hangs (no `WATCHDOG` in the console), none ends at once, no sprite stays behind. The same as at the end of step 5, or better.
- `/debug.html`: still works as before.

You cannot see the canvas yourself; do not mark this action done without their answer. Anything wrong goes into the matching open question (or is fixed, if it is a crash or a blank screen).

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

- [ ] **Action 10: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **6. ADS scheduler.**` to `- [x]`. Change nothing else in that file.

- [ ] **Action 11: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 6 (ADS scheduler) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
