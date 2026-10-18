# Step 8: Chunk 7 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-story-findings.md` through `step-007-story-step-and-loop.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/story.md`, `docs/re/island.md` (`Past fixes reviewed`, checklist check), `docs/re/open-questions.md`, `docs/re/segments.md` (stale references only), `docs/re/ads.md` (`Story interface`, stale references only)
- Modify (comments only): `src/story/*.ts`, `src/island/*.ts`, `src/engine/*.ts`, `src/testing/island-recorder.ts`, `src/walk/walk.ts`, `src/main.ts`
- Modify: `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick one checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 7 produced. `docs/re/story.md` sections `Startup and shutdown`, `Timing`, `Random`, `Settings`, `Scene table`, `Time slots and holidays`, `Day counters`, `Sequence building`, `Story step`, `ADS by id`, `Exit and dialogs`, `Emulated`, `Side-by-side checklist`; `docs/re/island.md` sections `Globals` .. `Bitmaps`, `Emulated`, `Side-by-side checklist`. `node scripts/re/function-map.mjs`, `scripts/re/ghidra-import.sh`, `re/.venv/bin/python -I scripts/re/unicorn/dump_story.py`, `dump_island.py`, `dump_ads.py`, `dump_ttm.py`.
- Produces: chunk 7 meets the spec's "done" rule.

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
const scope = {
  '1000': ['01f4', '020f', '082c'],
  '1008': ['0000', '0221', '033e', '034f', '0517', '0a2d', '0c5c', '0dc8', '0fcd', '12eb', '13cd', '143c', '157b', '15c8', '16c2'],
  '1010': ['0059', '00b2', '00fc', '0136', '03ce', '040e', '0463', '04a2', '0a38', '0b67', '0e74', '14bf', '1551', '1a0d', '1a88', '1b00', '1c41', '1d69', '1e50'],
  '1018': ['0540', '0673', '06bf', '089b', '0b46', '0b87', '0c21', '0c62', '0d11', '0d50', '0e7b', '0eb5', '1e60', '1eb6', '1ed4', '1ef5'],
  '1020': ['0000', '0085', '00ba', '0106', '013f', '019c', '026e', '081c', '082a'],
  '1040': ['076a', '079e', '07e6', '085a', '089a'],
};
for (const [segment, offsets] of Object.entries(scope)) for (const offset of offsets) {
  const address = segment + ':' + offset;
  if (names[address]?.status !== 'verified') console.log(address, names[address]?.name ?? 'unknown', names[address]?.status ?? '');
}
"
```

For each function listed:

- Its checklist row (in `story.md` or `island.md`) is `fixed` or `match` and the findings describe it: set it `verified` in `names.json`.
- It is in OQ-35 (dialogs, password, Windows plumbing, sound loading): leave it `named`; check that OQ-35 names its address.
- It is unreferenced (`1018:0e7b`, and `1010:0059`, `1010:00b2` if step 4 found no caller): the findings must say nothing calls it (`rg -n "<address>" re/out/index.tsv re/out/relocations.tsv`). Set it `verified`.

Then run `node scripts/re/function-map.mjs`.

- [ ] **Action 2: Check both checklists**

Every address of the overview's `Function scope` has exactly one row in `docs/re/story.md` (segments `1000`, `1008`, `1018`, `1020`, `1040`) or `docs/re/island.md` (segment `1010`), and every `open` row has an entry in `docs/re/open-questions.md` that names that address. Check that the `file:line` references still match:

Run: `rg -n "^export function|^function|^export class" src/story/*.ts src/island/*.ts src/engine/*.ts`

Fix whatever is missing or stale.

- [ ] **Action 3: Check the carry-over notes**

Run: `rg -n "Resolve in:\*\* chunk 7" docs/re/open-questions.md`
Expected: every match belongs to an entry whose status is `resolved (chunk 7)` (OQ-1, OQ-6, OQ-24, OQ-26, OQ-28, OQ-29, OQ-30), `resolved (chunk 7), by choice` (OQ-21), or `open, by choice`. Any other open entry with chunk 7 is either finished now or moved to the chunk that owns it, with a sentence saying why.

Run: `rg -n "Resolve in:\*\* chunk 8" docs/re/open-questions.md`
Expected: at least OQ-25, describing the walk bridge of step 7.

Run: `rg -n "story-data|storyScenes|storyTick|storyPlayScene|storyAnimateBg|islandInit|islandAnimate|islandRedrawHoliday|randomIslandState|playingTicks|WATCHDOG|msPerTick|legacy-island" docs/re src`
Expected: matches only in resolved entries, past-fix notes, or text that says the code was deleted. Fix any open entry or finding that still points at the old code (for example the `Where` lines of OQ-25, the `Story interface` section of `docs/re/ads.md`, and `docs/re/segments.md`).

## Part B: Past fixes

- [ ] **Action 4: Review the chunk 7 rows of "Past fixes to re-check"**

The table in `docs/re/open-questions.md` lists these commits for chunk 7: `8adc66a` (various consistency fixes; its `src/ads` part was reviewed in chunk 6), `1204c0d` (chain instant phase transitions in one tick), `c037b5f` (order storyTick → adsTick → storyAnimateBg), `194d7fb` (thread leak sweeps; its `src/ads` part was reviewed in chunk 6), `613b3c2` (8000-tick watchdog), `d39b9ac` (clear saved zones between scenes). For each:

Run: `git show --stat <commit>` and `git show <commit> -- src/story src/island src/main.ts src/engine`

Compare what it changed with the findings. Add a section `Past fixes reviewed` to `docs/re/story.md`, after `Emulated` and before `Side-by-side checklist`, with one bullet per commit:

```markdown
- `<commit>` (<summary>): <what it changed, in one sentence>. Original: <what the findings say, with the address>. Verdict: <matches the original | differs: ... | only mattered in the old story; replaced by src/story/story.ts>.
```

Hints from the findings:

- Phase chaining (`1204c0d`): the original has no phases; one `1018:06bf` per `WM_TIMER` does whatever the current entry needs, and a new sequence is built and its first entry run in the same step.
- Tick order (`c037b5f`): `1018:06bf` runs the island step first (`1010:040e(0)`), then the walk or the entry's ADS tick, then the holiday redraw and the restore pass.
- Leak sweeps (`194d7fb`, story part): no ADS runs during a walk, and every new sequence drops the cached ADS (`1018:0673`).
- Watchdog (`613b3c2`): no time limit in `1018:06bf`; see OQ-1.
- Saved zones between scenes (`d39b9ac`): the layer pipeline it patched was deleted in chunk 5.
- `8adc66a`: review only its story and island parts here.

Then, in the table, change the Chunk cell of each reviewed row: `7` becomes `7 (reviewed, see docs/re/story.md)`; `6 (reviewed, see docs/re/ads.md), 7` becomes `6 (reviewed, see docs/re/ads.md), 7 (reviewed, see docs/re/story.md)`. Change nothing else in the table.

## Part C: Comments and docs

- [ ] **Action 5: Audit the comments**

Run: `rg -n "//|/\*" src/story src/island src/engine src/testing/island-recorder.ts src/walk/walk.ts src/main.ts`

For each comment, apply the overview's rule: keep it only if a competent engineer would be surprised without it, and only if `docs/re/story.md` or `docs/re/island.md` backs its claim. Test citations `// SCRANTIC ssss:oooo` stay. Known comments to judge:

- `src/main.ts`: `// fire-and-forget: ...`. Keep if true.
- `src/walk/walk.ts`: the `walkTick` comment about the last frame and the older phase comments. Walk logic is chunk 8: keep those that are true of the current code and needed; do not add new claims.
- `src/engine/loop.ts`: no comments expected.
- Anything in `src/story` or `src/island` that names jc_reborn, threads, phases, or the old scheduler: delete.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 6: Update `docs/Plan.md` pointers**

Run: `rg -n "story_data|story\.c|island\.c|storyScenes|story-data" docs/Plan.md`

`docs/Plan.md` is guidance only. Where it describes the story or island as a port of `~/dev/jc_reborn/story.c` / `island.c`, add one line under that heading: `Replaced in chunk 7 by a port of SCRANTIC.SCR; see docs/re/story.md and docs/re/island.md.` Change nothing else in it.

- [ ] **Action 7: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/story.md docs/re/island.md docs/re/open-questions.md docs/re/segments.md docs/re/ads.md docs/Plan.md src
git commit -m "docs(re): chunk 7 functions verified, past fixes reviewed, comments audited"
```

## Part D: Full verification

- [ ] **Action 8: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`; `re/out/functions/1018_0540_story_newSequence.c` exists.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_story.py`
Expected: exits 0; `re/fixtures/story/sequences.tsv` has 961 lines.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_island.py`
Expected: exits 0; `re/fixtures/island/traces.tsv` has the row count noted in `docs/re/island.md`, `Emulated`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py`
Expected: exits 0; the row count in `docs/re/ads.md`, `Emulated` (the ADS harness was not changed, so this proves nothing moved).

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/story/scene-table.data.test.ts`, `src/story/random.data.test.ts`, `src/story/sequence.data.test.ts`, `src/story/story.data.test.ts`, `src/island/island.data.test.ts`, `src/ads/tick.data.test.ts`, `src/walk/walk.data.test.ts`, `src/ttm/page-runner.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 9: Smoke test in the browser**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

Ask the user to open both pages and confirm:

- `/`: the intro, a wipe, the island; scenes start, play, and end on their own; Johnny walks between them; new sequences start with a wipe. The same as at the end of step 7, or better.
- `/debug.html`: still works as before.

You cannot see the canvas yourself; do not mark this action done without their answer. Anything wrong goes into the matching open question (or is fixed, if it is a crash or a blank screen).

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

- [ ] **Action 10: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **7. Story and main loop.**` to `- [x]`. Change nothing else in that file.

- [ ] **Action 11: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 7 (story and main loop) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
