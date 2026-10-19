# Step 1: Story Findings

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

- Modify: `scripts/re/names.json` (new and renamed entries), `docs/re/function-map.md` (regenerated)
- Create: `docs/re/story.md`
- Modify: `docs/re/segments.md` (rows for `1008`, `1010`, `1018`, `1020`, `1040`; "Tables found")
- Modify: `docs/re/open-questions.md` (OQ-35)
- Local only (gitignored): `re/out/` (rebuilt), `re/scratch/story/*.py`

**Interfaces:**

- Consumes: the overview's `Binary facts` (a first reading to confirm), `re/out/functions/<seg>_<off>_*.c` / `.asm`, `re/out/index.tsv`, `re/out/relocations.tsv`, `re/out/strings.tsv`, `public/data/SCRANTIC.SCR`.
- Produces: every function of the overview's `Function scope` named in `names.json` (status `named` unless already `verified`); `docs/re/story.md` with the sections listed in Action 8 and a `Side-by-side checklist` with one row per in-scope function of segments `1000`, `1008`, `1018`, `1020`, `1040` (step 4 writes the `1010` rows in `docs/re/island.md`). Steps 3 and 7 port exactly what `story.md` says.

This step writes no TypeScript. It is the reading step for the story, timing, settings, and random code. Where `story.md` and the overview's first reading disagree, `story.md` wins.

## Part A: Names and export

- [x] **Action 1: Add and rename the names**

Insert these entries into `scripts/re/names.json` under `"functions"`, each at its address-sorted position. Every new entry has `"status": "named"`, `"signature": null`, `"callingConvention": null`, and the subsystem of its name prefix. Same shape as the existing entries:

```json
"1018:0540": {
  "name": "story_newSequence",
  "subsystem": "story",
  "status": "named",
  "note": "Wipes, computes the time slot and holiday, resets the island flags, updates the day counters, builds the scene queue, puts Johnny at its first start spot, draws the island",
  "signature": null,
  "callingConvention": null
},
```

| Address | Name | Note |
| --- | --- | --- |
| `1000:01f4` | `rtl_getdate` | getdate: DOS 0x2A into 5 bytes at a near pointer: day, month, year word, weekday |
| `1000:020f` | `rtl_gettime` | gettime: DOS 0x2C into 4 bytes at a near pointer: hour, minute, second, hundredths |
| `1000:082c` | `rtl_time` | time(): seconds since 1970 in DX:AX from the DOS date and time; stores them too when the pointer is not null |
| `1008:033e` | `platform_alwaysTrue` | Returns 1; asked by WinMain and the exit request |
| `1008:034f` | `platform_configureDialog` | Exported dialog procedure of the settings dialog (/c): loads and saves the settings |
| `1008:0517` | `platform_configureDialogItems` | Helper of the settings dialog; read it and replace this note with what it does |
| `1008:0a2d` | `platform_changePasswordDialog` | Exported dialog procedure that sets a new password |
| `1008:157b` | `platform_shutdownSaver` | Cleanup callback: closes MCI, ends the sequence, frees the island, walk, ADS, cursors, display |
| `1008:16c2` | `platform_clockTick` | Timer callback every 16 ms: adds 1 to the clock 1068:2e70 and counts down five timers |
| `1018:0673` | `story_endSequence` | Wipes the screen, unloads the ADS of every queued entry, empties the queue |
| `1018:089b` | `story_buildQueue` | Builds the scene queue of a sequence: day scene, closing scene, opening scene, middle scenes within a budget |
| `1018:0b46` | `story_isAtSpot` | Stores the walk target and says whether Johnny already stands at a spot and heading (0 and -1 = any) |
| `1018:0b87` | `story_advanceDays` | Moves NumDays and Introduction on when the date changed and a day scene was picked |
| `1018:0c21` | `story_halfHourSlot` | Maps an HHMM time to one of 16 half-hour slots of an 8-hour cycle |
| `1018:0d11` | `ads_unloadAdsById` | Unloads the cached ADS of an ADS id (1048:067f) and forgets its slot |
| `1018:0d50` | `story_pickScene` | Weighted random pick from the scene table of an entry of a kind, slot, and budget |
| `1018:0e7b` | `story_findScene` | Finds the n-th scene table entry with an id; unreferenced |
| `1018:0eb5` | `story_fitsIsland` | Whether an entry's island place bits fit the place chosen so far |
| `1018:1eb6` | `story_discardRandom` | Draws and drops n random numbers |
| `1018:1ed4` | `story_seedRandom` | Seeds the random generator by dropping time() & 0xffff numbers |
| `1018:1ef5` | `story_randomPercent` | Picks 1..n from a zero-terminated list of percentages, or 0 when none hits |
| `1020:0106` | `platform_encodePassword` | Stores a password XORed with a fixed string plus 0x21 |
| `1020:013f` | `platform_checkPassword` | Compares a typed password with the stored encoded one |
| `1020:026e` | `platform_passwordDialog` | Exported dialog procedure that asks for the password on exit |
| `1020:082a` | `platform_adsControlDialog` | Exported dialog procedure that returns 0 |
| `1040:076a` | `platform_initTimers` | Sets the base tick 1068:45de to 1000 / (n * 18) ms, once |
| `1040:079e` | `platform_clearTimers` | Empties the five timer callback slots and clears the base tick |
| `1040:085a` | `platform_removeTimerCallback` | Empties one timer callback slot 1..4 |

The `1010` functions are named here too, so the export is rebuilt once (step 4 reads them):

| Address | Name | Note |
| --- | --- | --- |
| `1010:0059` | `story_presentFromB` | Presents the whole screen with B as source and target; check for callers |
| `1010:00b2` | `story_presentFromA` | Presents the whole screen with A as source and target; check for callers |
| `1010:03ce` | `story_freeIslandBitmaps` | Frees BACKGRND.BMP and MRAFT.BMP |
| `1010:040e` | `story_animateIsland` | Island step: ocean waves, clouds on the first call only, surf and raft unless still |
| `1010:0463` | `story_resetOceanWaves` | Empties the 30 ocean wave records and refills the per-kind counts |
| `1010:04a2` | `story_animateOceanWaves` | Spawns, moves, and draws glints and wave sprites on the ocean |
| `1010:0a38` | `story_initClouds` | Picks the wind direction and places up to 15 clouds |
| `1010:0b67` | `story_animateClouds` | Spawns, moves, and draws the clouds |
| `1010:0e74` | `story_drawSurf` | Advances the surf frames every 4 clock ticks and redraws surf spots; with an argument draws one spot |
| `1010:14bf` | `story_randomPlace` | Random x and y in a range minus a BACKGRND sprite's size, or 0, 0 when it does not fit |
| `1010:1551` | `story_redrawIslandOver` | Redraws the island parts in front of a sprite, clipped to it |
| `1010:1a0d` | `story_markIslandDrawn` | Adds the three dirty rects of a sprite drawn on B |
| `1010:1a88` | `story_rectOverlap` | 2 when a rect lies inside another, 1 when they touch, else 0 |
| `1010:1b00` | `story_placeIsland` | Island position from the place bits and low tide |
| `1010:1c41` | `story_setIslandFlags` | Turns an entry's flags and place bits into island globals; (-1, -1) resets them |
| `1010:1d69` | `story_drawRaft` | Draws the raft frame for the day count; redraws it when a presented rect overlaps |
| `1010:1e50` | `story_drawHoliday` | Draws the holiday sprite; redraws it when a presented rect overlaps |

Rename these existing entries (keep their status; rewrite the note in our words if it is wrong after Part B):

| Address | Old name | New name |
| --- | --- | --- |
| `1018:06bf` | `story_stepScene` | `story_step` |
| `1010:0136` | `story_drawIsland` | keep |
| `1008:15c8` | `story_idleTick` | keep |

- [x] **Action 2: Regenerate the function map**

Run: `node scripts/re/function-map.mjs`
Expected: exits 0 and rewrites `docs/re/function-map.md`. An "unsorted" error means an entry is out of address order; move it.

- [x] **Action 3: Rebuild the export**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `ls re/out/functions/1018_0540_story_newSequence.c re/out/functions/1010_0e74_story_drawSurf.asm re/out/functions/1008_16c2_platform_clockTick.c`
Expected: all three exist.

- [x] **Action 4: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): name the story, island, timing, and settings functions"
```

## Part B: Read and confirm

Read every in-scope function's `.c` file of segments `1000`, `1008`, `1018`, `1020`, `1040`, and its `.asm` wherever the pseudo-C is unclear (signed versus unsigned compares, byte versus word reads, which local is which). For each bullet of the overview's `Binary facts` sections `Timing and the main loop`, `Random numbers`, `Settings`, `Scene table`, `Sequence building`, `The story step`, decide: confirmed, or corrected. Keep a list of corrections; they go in the commit message and into `story.md`.

- [x] **Action 5: Confirm the details most likely to be wrong**

Check each in the assembly and note the answer:

1. `1018:0540`: which byte of the `1000:020f` buffer is the hour and which the minute (the overview says `[BP-6]` hour, `[BP-5]` minute, since `1000:020f` stores `CH` then `CL`); the holiday compares (`JC`/`JA`, unsigned, so the exact day ranges); `IDIV` for the slot (signed).
2. `1018:0d50`: every compare's signedness (`fromSlot <= slot`, `slot < toSlot`, `length / 2 < budget`, `day == Introduction`), whether `rand % sum` is `DIV` (unsigned) or `IDIV`, and what `(place & (kind >> 15))` adds (the overview says nothing, since every kind is below `0x8000`).
3. `1018:089b`: the exact loop condition for re-picking the closing scene; the repeat-count retry condition (`length × n > budget`); the queue limit `0x12a`; which entries get the pending bit.
4. `1018:0b87`: the order of the `NumDays < Introduction` increment and the `> 11 or < 2` reset; that the date compares are year word, month byte, day byte.
5. `1018:06bf`: what `1068:334a` and `1068:1dbc` are (find every instruction that writes them: `rg -n "0x334a\]|0x1dbc\]" re/out/functions/*.asm`; also look for `0x334a`/`0x1dbc` as immediates); whether the idle wait test reads `334c` after `1018:0094`; which entry the sound-25 test compares (the one read at the start of the step).
6. `1008:15c8`: every writer of `1068:2e14` (`rg -n "2e14" re/out/functions/*.asm`, then `rg -n "2e14" re/out/relocations.tsv re/out/strings.tsv`); if none, `30bc` is always 0 and `1010:04a2` never spawns an ocean wave.
7. `1008:16c2`: every reader and writer of `1068:3f2c`.
8. `1040:089a`: that a due slot fires once per missed interval (the inner `while`), and what the `1068:257c` branch does (reset after a pause).
9. `1008:0fcd`: the `SetTimer` interval (`0x32`), and that the `WM_TIMER` branch runs the idle callback once and then loops on `PeekMessage`.
10. `1018:1ef5`: the multiply constant (`0x28f`) and that the compare is `JBE` (unsigned, `t > r` returns).

- [x] **Action 6: Dump the scene table and globals for reading**

Write `re/scratch/story/dump.py` (gitignored scratch):

```python
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path("scripts/re/unicorn").resolve()))
from ne_image import NeImage

image = NeImage.load("public/data/SCRANTIC.SCR")
ds = next(s for s in image.segments if s.index == image.auto_data_segment).data
p, i = 0x1756, 0
while struct.unpack_from("<H", ds, p)[0] != 0:
    e = ds[p:p + 17]
    small = [struct.unpack_from("b", e, k)[0] for k in range(2, 11)]
    flags, place = struct.unpack_from("<HH", e, 0xB)
    print(i, struct.unpack_from("<h", e, 0)[0], small, f"{flags:#06x}", f"{place:#06x}", struct.unpack_from("b", e, 15)[0], struct.unpack_from("b", e, 16)[0])
    p, i = p + 17, i + 1
for name, at in (("settings 00b6..00bf", 0xB6), ("days 2d94..2d9b", 0x2D94), ("random 1ce4..1ce7", 0x1CE4), ("speed 2e14", 0x2E14), ("334a", 0x334A), ("1dbc", 0x1DBC)):
    print(name, ds[at:at + 10].hex(" "))
```

Run: `re/.venv/bin/python -I re/scratch/story/dump.py`
Expected: 80 entries (indices 0..79), entry 0 all zero, entries 54..67 with ADS id -1. Use the output for the `Scene table` section of `story.md` (describe the columns and the groups; do not paste the 80 rows).

- [x] **Action 7: Check the data against the story rules**

Extend the scratch script (or write `re/scratch/story/check.py`) to answer, and note the answers for `story.md`:

1. For every slot 0..15: how many entries could close a sequence (flag 4, tag ≠ 0, day 0, slot in range)? If any slot has none, `1018:089b` loops forever there; the overview expects every slot to have some.
2. For every slot: how many entries have flag 1 or flag 2? (A kind-1 pick that finds nothing makes `1018:089b` queue a null entry; see OQ-34.)
3. Which day scenes (`day` 1..11) exist, their ADS ids and tags, and which are closing scenes (flag 4).
4. Which entries have the place bits `0x01`..`0x20`, and which flags `0x200`, `0x400`, `0x800`, `0x1000`, `0x2000`, `0x4000`, `0x10`, `0x08` each.

## Part C: Write the findings

- [x] **Action 8: Write `docs/re/story.md`**

Create the file with this header, then the sections below in this order. One claim per bullet, each starting with its address, in our own words. Follow `docs/re/ads.md` for tone and density.

```markdown
# Story and Main Loop

How the original picks and plays scenes: the timer-driven step, the clock, sequences built from the scene table, day counters, holidays, time slots, settings, and the random generator. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 7. One claim per address. Our own words; no decompiled code. The island drawing is in `docs/re/island.md`; walking is chunk 8.
```

What each section covers (the overview's `Binary facts` has the first reading of each):

- `Startup and shutdown`: `1008:0000` (command line, `/c`, `/s`), `1008:0fcd` (`WM_CREATE`, `WM_USER`, `WM_DESTROY`, paint), `1008:143c` (startup order, the intro screen, which globals it sets), `1008:157b`, `1008:033e`.
- `Timing`: `1008:0fcd` (`SetTimer` 50 ms, the `WM_TIMER` branch), `1040:076a`, `1040:07e6`, `1040:089a`, `1040:079e`, `1040:085a`, `1008:16c2` (the clock and each countdown, with what owns it), `1008:15c8` (the step call, then `30bc`, with Action 5 item 6). Say plainly: one story step per `WM_TIMER`, at most one per timer period; the clock runs at 62.5 Hz independent of steps.
- `Random`: `1018:1e60` (the formula, the start indices, who calls it), `1018:1eb6`, `1018:1ed4`, `1000:082c`, `1018:1ef5` (formula with `0x28f`).
- `Settings`: `1008:0c5c`, `1008:0dc8` (every key, its global, its default, when it is read and written), `1008:12eb` (StartTime normalization in the dialog).
- `Scene table`: the entry layout at `1068:1756`, the flag and place bits (with Action 7 item 4), the ADS id table `1068:166e`, the idle entries, the day scenes (Action 7 item 3), `1018:0e7b` (unreferenced).
- `Time slots and holidays`: `1000:020f`, `1000:01f4`, `1018:0c21`, the slot formula in `1018:0540` (Action 5 item 1), the holiday table, which slots are night (`1010:0136` reads slot `>= 12`).
- `Day counters`: `1018:0b87` (Action 5 item 4), how `1018:0d50` kind `0x80` moves Introduction, and `30ec`/`30ee`. Walk through one example: a fresh install (all 0) over three dates.
- `Sequence building`: `1018:0540`, `1018:0673`, `1010:1c41` (as the story uses it; `island.md` owns the island side), `1018:0eb5`, `1018:0d50`, `1018:089b` (Action 5 items 2 and 3, Action 7 items 1 and 2).
- `Story step`: `1018:06bf` step by step (Action 5 item 5), `1018:0b46`, `1018:0074` and `1018:0094` (read for the interface only, chunk 8), the end-of-entry spot and heading rules, sound 25.
- `ADS by id`: `1018:0c62`, `1018:0d11`; that the loaded ADS is kept while consecutive entries use the same id (OQ-30) and dropped at the end of every sequence (`1018:0673`).
- `Exit and dialogs`: `1008:0221`, `1008:034f`, `1008:0517`, `1008:0a2d`, `1020:0106`, `1020:013f`, `1020:019c`, `1020:026e`, `1020:082a`, `1020:081c`; one line each; none of them affects the screen saver's picture. Sound loading and playback (`1020:0000`, `1020:0085`, `1020:00ba`) in one line each: which sample the story plays and when.
- `Side-by-side checklist`: the table below.

```markdown
## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1000:01f4` | `rtl_getdate` | `src/story/story.ts` (`Date`) | open |
```

One row per function of the overview's `Function scope` in segments `1000`, `1008`, `1018`, `1020`, `1040`, in address order. For now `Ours` is whatever handles it today (`src/story/story.ts`, `src/engine/clock.ts`, `src/main.ts`, or `none`) and status `open`; steps 3 and 7 replace the rows as the port lands. Rows for dialogs, password, and sound loading read `none (out of scope, OQ-35)` with status `match`. `1020:0364` and its wipes stay in `docs/re/graphics.md`.

Leave `Emulated` and `Past fixes reviewed` out; steps 2 and 8 add them.

- [x] **Action 9: Log OQ-35**

Add to `docs/re/open-questions.md`, section `Not reviewed on purpose`, after OQ-31:

```markdown
### OQ-35: Windows plumbing, dialogs, password, and sound loading are not modeled

- **Where:** `1008:0000`, `1008:0221`, `1008:033e`, `1008:034f`, `1008:0517`, `1008:0a2d`, `1008:12eb`, `1008:13cd`, `1020:0000`, `1020:0085`, `1020:0106`, `1020:013f`, `1020:019c`, `1020:026e`, `1020:081c`, `1020:082a`
- **What it does:** command-line handling, the settings and password dialogs, exit on mouse or key input, message pumping during wipes, debug logging (empty in this build), and loading the WAVESFX samples through MMSYSTEM.
- **Why not reviewed:** none of them changes what the screen saver draws or when; the browser has its own page, controls, and sound playback (`docs/re/story.md`, `Exit and dialogs`).
- **Status:** open, by choice
```

- [x] **Action 10: Update the segment overview**

In `docs/re/segments.md`: set the `1008` row to window procedure, timing, settings, startup; the `1010` row to the island (drawing, surf, raft, holiday, clouds, ocean waves); the `1018` row to the story step and sequence builder (`1018:0000`..`1018:0eb5`), the resource layer (unchanged text), and the random generator (`1018:1e60`..`1018:1ef5`); the `1020` row to add the password helpers; the `1040` row to add the timer callbacks (`1040:076a`..`1040:089a`). Under "Tables found", add one line each for `1068:1756` (scene table), `1068:30f2` / `1068:30f0` (queue and position), `1068:1ce4` (random indices and table), `1068:00b6`..`00be` (settings), `1068:2d94`..`2d9b` (day counters), `1068:45ac` (timer slots), `1068:30e2`/`30de`/`30e0`/`30dc` (Johnny's spot and heading, walk target), `1068:30b8` (slot), `1068:30ba` (holiday), `1068:334e` (current ADS id), `1068:30bc` (speed, with Action 5 item 6).

- [x] **Action 11: Commit**

```bash
git add docs/re/story.md docs/re/segments.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): story, timing, and settings findings"
```

If Action 5 or 7 corrected a fact of the overview, list each correction in the commit body, one line each (`<address>: overview said X, the code does Y`).

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
