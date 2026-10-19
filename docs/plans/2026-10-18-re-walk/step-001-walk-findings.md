# Step 1: Walk Findings

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** none

**Files:**

- Modify: `scripts/re/names.json` (new entries), `docs/re/function-map.md` (regenerated)
- Create: `docs/re/walk.md`
- Modify: `docs/re/segments.md` (the `1018` row; "Tables found")
- Local only (gitignored): `re/out/` (rebuilt), `re/scratch/walk/check.py`

**Interfaces:**

- Consumes: the overview's `Binary facts` (a first reading to confirm), `re/out/functions/1018_*.c` / `.asm`, `re/out/index.tsv`, `re/out/relocations.tsv`, `public/data/SCRANTIC.SCR`, `public/data/RESOURCE.MAP` / `RESOURCE.001` (through `scripts/re/unicorn/corpus.py`, `load_resources`).
- Produces: the six in-scope functions named in `names.json` (status `named`); `docs/re/walk.md` with the sections of Action 7 and a `Side-by-side checklist` with one row per in-scope function. Steps 2 to 4 trace and port exactly what `walk.md` says.

This step writes no TypeScript. Where `walk.md` and the overview's first reading disagree, `walk.md` wins.

## Part A: Names and export

- [x] **Action 1: Add the names**

Insert these entries into `scripts/re/names.json` under `"functions"`, each at its address-sorted position (all between `1018:0000` and `1018:0540`). Each has `"subsystem": "walk"`, `"status": "named"`, `"signature": null`, `"callingConvention": null`. Same shape as the existing `1018:0000` entry:

```json
"1018:004d": {
  "name": "walk_freeJohnWalkBmp",
  "subsystem": "walk",
  "status": "named",
  "note": "Frees the JOHNWALK.BMP bitmap list and clears its pointer",
  "signature": null,
  "callingConvention": null
},
```

| Address | Name | Note |
| --- | --- | --- |
| `1018:004d` | `walk_freeJohnWalkBmp` | Frees the JOHNWALK.BMP bitmap list and clears its pointer |
| `1018:0074` | `walk_resetPath` | Drops the route and segment being walked and wants Johnny's current heading |
| `1018:0094` | `walk_step` | One walk call: when the frame delay ran out, picks a segment, turns, or moves one frame; then draws Johnny, redraws the palm trunk over him, and adds his dirty rects |
| `1018:03ac` | `walk_routeOf` | Route list of a (from, to) spot pair from the table at 1068:0a94, or 0 |
| `1018:03ea` | `walk_segmentFrames` | Frame list address of walk segment 1..34, or 0 |

Keep `1018:0000` (`walk_loadJohnWalkBmp`); rewrite its note after Part B if it is wrong.

- [x] **Action 2: Regenerate the function map**

Run: `node scripts/re/function-map.mjs`
Expected: exits 0 and rewrites `docs/re/function-map.md`. An "unsorted" error means an entry is out of address order; move it.

- [x] **Action 3: Rebuild the export**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `ls re/out/functions/1018_0094_walk_step.c re/out/functions/1018_03ea_walk_segmentFrames.asm`
Expected: both exist.

- [x] **Action 4: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): name the walk functions"
```

## Part B: Read and confirm

Read the `.c` and `.asm` of the six functions, and the parts of `1018:06bf_story_step.asm`, `1008:143c`, `1008:157b`, `1008:16c2`, `1018:0b46`, `1018:0540` that touch the walk globals. For each bullet of the overview's `Binary facts`, decide: confirmed, or corrected. Keep a list of corrections; they go in the commit message and into `walk.md`.

- [x] **Action 5: Confirm the details most likely to be wrong**

Check each in the assembly of `1018:0094` (or the named function) and note the answer:

1. The segment pick (`1018:0105`..`011b`): `rand % 100` is `DIV` (unsigned); the loop subtracts the pair's percent and goes on while the result is greater than 0 (`JG`, signed). So `r = 0` always picks the first pair, and `r` equal to a running total picks that pair.
2. The early return (`1018:0102` → `1018:03a3`): when the marker `-spot` is not in the route, the function returns before drawing and before setting the delay.
3. The turn direction (`1018:01d6`..`0212`): the exact branches for `d = ±4` (random low bit 0 → +1), `d < -4` → -1, `d <= 0` → +1, `d >= 4` → +1, else -1.
4. The order inside one call: a turn that reaches the wanted heading lets part 5 (the segment record) run in the same call, which then replaces the turn frame.
5. The draw (`1018:02b2`..`039d`): it runs on every call with a frame, also when the delay is not 0; the sprite index is `word & 0x7fff` (then times 2 into the list at `30d2`); flags are 2 for bit `0x8000`; the dirty rects take the image's width (`+6`) and height (`+8`) with no padding; the three (source, target, age) pairs (`1068:1eb0` = C, `1eb2` = B, `1eb4` = A, per `scripts/re/unicorn/original_graphics.py`, `DC_GLOBALS`); the last two arguments are 0 (no clip); `30d4 = 4` only after a draw.
6. `1018:03ac`: the address formula (`from × 12 + to × 2 + 0x0a94`) and the test that returns 0 when either argument is 0.
7. `1018:03ea`: the 34 cases and their addresses; 0 for anything else.
8. Every reader and writer of `1068:30c6`, `30c8`, `30ca`, `30cc`, `30ce`, `30d0`, `30d2`, `30d4`, `30dc`, `30e0`:

   Run: `rg -n "0x30(c6|c8|ca|cc|ce|d0|d2|d4|dc|e0)\]" re/out/functions --glob '*.asm'`

   Expected (from planning): only `1008:16c2`, `1018:0000`, `1018:004d`, `1018:0074`, `1018:0094`, `1018:0b46`, and the TTM's shared-list tests (`1050:080c`, `1058:040c`). Note any other.
9. Every caller of the six functions: `rg -n "1018:00(00|4d|74|94)|1018:03(ac|ea)" re/out/functions --glob '*.asm'` (near calls show as `CALL 0x1018:....`). Expected: `1008:143c` → `0000`; `1008:157b` → `004d`; `1018:06bf` → `0094` (twice) and `0074`; `1018:0094` → `03ac`, `03ea`.
10. That `1018:0540` and `1018:06bf` write `30e2`/`30de` but never `30d0`, `30ce`, `30c6`, `30c8`: a new sequence or an ended ADS entry moves Johnny without resetting the walk.

- [x] **Action 6: Check the tables against the data**

Write `re/scratch/walk/check.py` (gitignored scratch):

```python
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path("scripts/re/unicorn").resolve()))
from corpus import load_resources, walk_chunks
from ne_image import NeImage

image = NeImage.load("public/data/SCRANTIC.SCR")
ds = next(s for s in image.segments if s.index == image.auto_data_segment).data
word = lambda at: struct.unpack_from("<h", ds, at)[0]
byte = lambda at: struct.unpack_from("<b", ds, at)[0]

segments = {s: (byte(0x2DE + 3 * s), byte(0x2DF + 3 * s), byte(0x2E0 + 3 * s)) for s in range(1, 35)}
frames, at = {}, 0xAEA
for s in range(1, 35):
    records = []
    while struct.unpack_from("<hhh", ds, at) != (0, 0, 0):
        records.append(struct.unpack_from("<Hhh", ds, at))
        at += 6
    frames[s], at = records, at + 6
print("frame lists end at", hex(at))
standing = [byte(0x347 + spot) for spot in range(7)]
walking = [byte(0x34E + spot) for spot in range(7)]
print("standing", standing, "walking", walking)

starts: dict[int, set[int]] = {}
for f in range(1, 7):
    for t in range(1, 7):
        p = word(0xA94 + 12 * f + 2 * t) & 0xFFFF
        if not p:
            continue
        for spot in range(1, 7):
            assert word(p) == -spot, (f, t, spot)
            p += 2
            pairs = []
            while word(p) >= 0:
                pairs.append((word(p), word(p + 2)))
                p += 4
            total, reach = 0, []
            for segment, percent in pairs:
                reach.append(not reach or (total < 99 and percent > 0))
                total += percent
            if spot == t:
                print(f"route {f}->{t} target group {pairs}")
                continue
            for (segment, _), reachable in zip(pairs, reach):
                starts.setdefault(segment, set()).add(spot)
                if not reachable:
                    print(f"route {f}->{t} spot {spot}: segment {segment} unreachable")
            if total < 100:
                print(f"route {f}->{t} spot {spot}: sum {total}")
        assert word(p) == -7

payload = {r.name: r.payload for r in load_resources(Path("public/data"))}["JOHNWALK.BMP"]
info = next(c for c in walk_chunks(payload) if c.path == "BMP:INF:")
count = struct.unpack_from("<H", payload, info.body_offset)[0]
used = {w & 0x7FFF for records in frames.values() for w, _, _ in records}
print("JOHNWALK sprites", count, "used max", max(used))
for s in range(1, 35):
    print(s, segments[s], len(frames[s]), "starts from", sorted(starts.get(s, [])))
```

Run: `re/.venv/bin/python -I re/scratch/walk/check.py`
Expected: no assertion error; "frame lists end at 0x1660"; every target group is `[(0, 0)]`; no sum below 100; the turn sets (all-zero segments) have 8 records and are never chosen by a route; the used sprite maximum is below the JOHNWALK count. Note for `walk.md`: which choices are unreachable (the overview expects route (1, 5), spot 1, segment 1), whether every walking segment starts from exactly one spot (a segment chosen at two spots would draw Johnny jumping), and whether any route can loop back to a spot it already left.

## Part C: Write the findings

- [x] **Action 7: Write `docs/re/walk.md`**

Create the file with this header, then the sections below in this order. One claim per bullet, each starting with its address, in our own words. Follow `docs/re/island.md` for tone and density.

```markdown
# Walk

How the original walks Johnny between spots: routes, segments, turn sets, the walk step, and how the story drives it. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 8. One claim per address. Our own words; no decompiled code.
```

Sections (the overview's `Binary facts` has the first reading of each):

- `Globals`: one bullet per global of the overview's table, with who writes it (Action 5 item 8) and its start value.
- `Tables`: the segment table, the two turn-set tables, the route lists and the route table, the frame lists (layout, order, terminators, the mirrored bit, that x and y are island-relative). Data facts from Action 6: counts, target groups, sums, unreachable choices, start spots per segment, loops.
- `Loading and freeing`: `1018:0000` (when it loads, the mirrored copies, the three globals it sets, its caller), `1018:004d`, the shared list with the TTM (`docs/re/ttm.md` mentions `1058:079f`).
- `Route choice`: `1018:03ac`, `1018:03ea`, `1018:0094` parts 1 and 2 (Action 5 items 1, 2, 6, 7), including the case of a segment with no frames.
- `Turning`: `1018:0094` parts 3 and 4 (Action 5 item 3), which turn set is used where, and that a stale wanted heading (left over from before an ADS entry) is turned toward first (Action 5 item 10).
- `Walking a segment`: `1018:0094` part 5, the arrival, when the route is cleared, the same-call order (Action 5 item 4).
- `Drawing`: the draw block (Action 5 item 5), `1010:1551` mode 0 (link `docs/re/island.md`, `Redrawing over sprites`), and that the walk draws on whatever target is current (`1010:040e` sets B just before, in `1018:06bf`).
- `Timing`: `30d4`, `1008:16c2`, and what that means at 50 ms per story step and 16 ms per tick. Say plainly that there is no rest on arrival.
- `Story interface`: `1018:0b46`, the three calls in `1018:06bf` (`1018:073a`, `0771`, `0776`), `1018:0540` and the end of an ADS entry moving Johnny without a walk reset (Action 5 item 10), and when Johnny can be at spot 0 (only as the first entry of a sequence that starts anywhere, and that entry plays at once: `1018:0094` is never called there; check the scene table in `src/story/scene-table.ts` or `docs/re/story.md`, `Scene table`).
- `Side-by-side checklist`:

```markdown
## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1018:0000` | `walk_loadJohnWalkBmp` | `src/walk/walk.ts` `startWalk` (loads per walk) | open |
| `1018:004d` | `walk_freeJohnWalkBmp` | none (nothing to free in JavaScript) | match |
| `1018:0074` | `walk_resetPath` | `src/story/story.ts` (`state.walk = null`) | open |
| `1018:0094` | `walk_step` | `src/walk/walk.ts` `walkTick`, `walkAnimate`, `walkDraw`, `walkHold` | open |
| `1018:03ac` | `walk_routeOf` | `src/walk/calcpath.ts` `calcPath` (a search, not a table) | open |
| `1018:03ea` | `walk_segmentFrames` | `src/walk/walk-data.ts` (jc_reborn bookmarks) | open |
```

Every `open` row is covered by OQ-25 (it names `src/walk/walk.ts` and the bridge); step 4 replaces the rows. Leave `Emulated` and `Past fixes reviewed` out; steps 2 and 5 add them.

- [x] **Action 8: Update the segment overview**

In `docs/re/segments.md`: in the `1018` row, name `1018:0000`..`1018:03ea` as the walk. Under "Tables found", add one line each for `1068:02de` (walk segments), `1068:0347` / `034e` (turn sets), `1068:0362`..`0aa1` (route lists), `1068:0a94` (route table, used from `0aa2`), `1068:0aea`..`165f` (walk frames), `1068:30c6`..`30d4` (walk state).

- [x] **Action 9: Commit**

```bash
git add docs/re/walk.md docs/re/segments.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): walk findings"
```

If Action 5 or 6 corrected a fact of the overview, list each correction in the commit body, one line each (`<address>: overview said X, the code does Y`).

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
