# Step 5: Chunk 8 Wrap-Up

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-walk-findings.md` through `step-004-walk-port.md`

**Files:**

- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/walk.md` (`Past fixes reviewed`, checklist check), `docs/re/story.md` and `docs/re/island.md` (stale walk references only), `docs/re/open-questions.md`, `docs/re/segments.md` (stale references only)
- Modify (comments only): `src/walk/*.ts`, `src/story/story.ts`, `src/engine/timers.ts`, `src/testing/walk-recorder.ts`, `src/main.ts`
- Modify: `docs/Plan.md` (one pointer line), `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (tick one checkbox only)

**Interfaces:**

- Consumes: everything steps 1 to 4 produced. `node scripts/re/function-map.mjs`, `scripts/re/ghidra-import.sh`, `re/.venv/bin/python -I scripts/re/unicorn/dump_walk.py`, `dump_island.py`, `dump_story.py`.
- Produces: chunk 8 meets the spec's "done" rule.

The spec's done rule for a chunk:

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

## Part A: Status

- [ ] **Action 1: Verify the in-scope functions**

Run:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const names = JSON.parse(readFileSync('scripts/re/names.json', 'utf8')).functions;
for (const offset of ['0000', '004d', '0074', '0094', '03ac', '03ea']) {
  const address = '1018:' + offset;
  console.log(address, names[address]?.name ?? 'unknown', names[address]?.status ?? '');
}
"
```

For each function: when its row in `docs/re/walk.md`, `Side-by-side checklist`, is `fixed` or `match` and `walk.md` describes it, set `"status": "verified"` in `names.json`, and rewrite its note if `walk.md` says something more exact. `1018:004d` counts as `match` (nothing to free in JavaScript).

Run: `node scripts/re/function-map.mjs`
Expected: exits 0; the `walk` section of `docs/re/function-map.md` shows six `verified` rows.

- [ ] **Action 2: Check the checklist and the carry-over notes**

Every function of the overview's `Function scope` has exactly one row in `docs/re/walk.md`, and no row is `open`. Check that the `file:line` references still match:

Run: `rg -n "^export function|^function" src/walk/walk.ts src/story/story.ts src/engine/timers.ts`

Run: `rg -n "Resolve in:\*\* chunk 8" docs/re/open-questions.md`
Expected: every match belongs to an entry whose status is `resolved (chunk 8)` (OQ-25) or `open, by choice`. Anything else is finished now or gets a sentence saying why it stays open.

Run: `rg -n "calcpath|calcPath|walk-data|walkData|walkHold|walkTick|walkAnimate|startWalk|WalkContext|holdJohnny|newWalk|chunk 8" docs/re src`
Expected: matches only in resolved entries, past-fix notes, or text that says the code was deleted. Fix any finding that still points at the old code or says "chunk 8" for something now done: for example `docs/re/story.md` (`Story step`: the `1018:0074` and `1018:0094` bullets now point to `docs/re/walk.md`; `Timing`: `30d4` is the walk's frame delay, `Timers.walk`), and `docs/re/island.md` if it names the old walk.

## Part B: Past fixes

- [ ] **Action 3: Review the walk history**

Run: `rg -n "\| 8" docs/re/open-questions.md`
Expected: no row of "Past fixes to re-check against the original" names chunk 8.

Run: `git log --oneline -- src/walk`
Expected (from planning): `052884d` (the first jc_reborn walk port) and the reverse-engineering commits of chunks 5 to 8. For `052884d`, run `git show --stat 052884d` and compare what it built with the findings.

Add a section `Past fixes reviewed` to `docs/re/walk.md`, after `Emulated` and before `Side-by-side checklist`:

```markdown
## Past fixes reviewed

No row of the "Past fixes to re-check" table in `docs/re/open-questions.md` belongs to chunk 8.

- `052884d` (walking + pathfinding): ported jc_reborn's walk: a depth-first path search over a spot connection matrix with a random path, frame "bookmarks", a 6-tick frame delay, and an 80-tick rest on arrival. Original: no search; a route table of per-spot segment choices by percent (`1018:03ac`, `1018:0094`), a 4-tick delay, no rest. Verdict: replaced by `src/walk/walk.ts`.
```

Adjust the bullet if `git show` says something different. Add one bullet for any other commit in the log that is not part of this reverse-engineering effort.

## Part C: Comments and docs

- [ ] **Action 4: Audit the comments**

Run: `rg -n "//|/\*" src/walk src/story/story.ts src/engine/timers.ts src/testing/walk-recorder.ts src/main.ts`

For each comment, apply the overview's rule: keep it only if a competent engineer would be surprised without it, and only if `docs/re/walk.md` or `docs/re/story.md` backs its claim. Test citations `// SCRANTIC ssss:oooo` stay. The generated header of `src/walk/walk-tables.ts` stays. Anything that names jc_reborn, bookmarks, the tree, `calcpath`, or spots 0..5: delete.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 5: Update `docs/Plan.md`**

Run: `rg -n "walk|calcpath|pathfinding" docs/Plan.md`

`docs/Plan.md` is guidance only. Where it describes walking as a port of `~/dev/jc_reborn` (`walk.c`, `calcpath.c`), add one line under that heading: `Replaced in chunk 8 by a port of SCRANTIC.SCR; see docs/re/walk.md.` Change nothing else in it.

- [ ] **Action 6: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/walk.md docs/re/story.md docs/re/island.md docs/re/open-questions.md docs/re/segments.md docs/Plan.md src
git commit -m "docs(re): chunk 8 functions verified, past fixes reviewed, comments audited"
```

## Part D: Full verification

- [ ] **Action 7: Rebuild everything from scratch and run every test**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`; `re/out/functions/1018_0094_walk_step.c` exists.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_walk.py`
Expected: exits 0; `re/fixtures/walk/traces.tsv` has the row count noted in `docs/re/walk.md`, `Emulated`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_island.py`
Expected: exits 0; the row count in `docs/re/island.md`, `Emulated` (the island harness did not change, so this proves nothing moved).

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass, and none of these is reported as skipped: `src/walk/walk.data.test.ts`, `src/walk/walk-tables.data.test.ts`, `src/story/story.data.test.ts`, `src/island/island.data.test.ts`, `src/story/sequence.data.test.ts`. If one is skipped, its input is missing; fix that before going on.

- [ ] **Action 8: Check that the pages load**

Run in the background: `pnpm dev --port 5173 --strictPort`

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/`
Expected: `200`. Same for `http://localhost:5173/debug.html`.

The user checked the walk in the browser at the end of step 4. If Parts A to C changed any code beyond comments, ask them to look once more (Johnny walks, turns, stays visible, goes behind the palm trunk, no trails) and wait for the answer.

Stop the dev server: `lsof -ti :5173 -sTCP:LISTEN | xargs kill -9`

- [ ] **Action 9: Tick the spec**

In `docs/specs/2026-10-17-reverse-engineering-validation-design.md`, tick `- [ ] **8. Walk.**` to `- [x]`. Change nothing else in that file.

- [ ] **Action 10: Commit**

```bash
git add docs/specs/2026-10-17-reverse-engineering-validation-design.md
git commit -m "docs: chunk 8 (walk) done"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
