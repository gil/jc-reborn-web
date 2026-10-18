# Step 1: ADS Findings

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

- Modify: `scripts/re/names.json` (new `1048` entries), `docs/re/function-map.md` (regenerated)
- Create: `docs/re/ads.md`
- Modify: `docs/re/segments.md` (row for `1048`)
- Local only (gitignored): `re/out/` (rebuilt), `re/scratch/ads/*.py`

**Interfaces:**

- Consumes: the overview's `Binary facts` (a first reading to confirm), `re/out/functions/1048_*.c` / `.asm`, `re/out/jump-tables.tsv`, `re/fixtures/decompressed/*.ADS.ADSSCR.bin`.
- Produces: every `1048` function named in `names.json` (status `named`, except those already `verified`); `re/out/functions/1048_118a_ads_whileEnd.c` / `.asm`; `docs/re/ads.md` with every section from the overview except `Emulated` and `Past fixes reviewed`, and a `Side-by-side checklist` with one row per in-scope function. Steps 3 and 4 port exactly what `ads.md` says.

This step writes no TypeScript. It is the reading step: the port in steps 3 and 4 follows `docs/re/ads.md`, and where `ads.md` and the overview's first reading disagree, `ads.md` wins.

## Part A: Names and export

- [ ] **Action 1: Add the names**

Insert these entries into `scripts/re/names.json` under `"functions"`, each at its address-sorted position (the file already has `1048:0044`, `0079`, `0303`, `040f`, `04fc`, `0b3e`, `196e`, `1acb`, `1e5a`; leave those as they are). Every entry has `"subsystem": "ads"`, `"status": "named"`, `"signature": null`, `"callingConvention": null`. Same shape as the existing entries:

```json
"1048:0000": {
  "name": "ads_init",
  "subsystem": "ads",
  "status": "named",
  "note": "Unloads every ADS slot and every TTM (1048:001b), sets up the dirty-rect pool, returns 1",
  "signature": null,
  "callingConvention": null
},
```

| Address | Name | Note |
| --- | --- | --- |
| `1048:0000` | `ads_init` | Unloads every ADS slot and every TTM (1048:001b), sets up the dirty-rect pool, returns 1 |
| `1048:001b` | `ads_unloadAll` | Unloads the 10 ADS slots (1048:067f), then every TTM (1050:07c6) |
| `1048:067f` | `ads_unload` | Unloads ADS slot n (0 = current): its TTMs, scene lists, bytecode and record; clears the current slot when it was this one |
| `1048:0766` | `ads_sectionBusy` | Story busy check for a section tag: 1 while the section runs or starts, or while a node of its scene list plays without a self-goto |
| `1048:0805` | `ads_setSectionState` | Sets a section's state, keeping the fresh bit 8, and clears its resume pointer |
| `1048:0874` | `ads_startSection` | Story start of a section: state 3 (reset its nodes, then run) through 1048:0805 |
| `1048:0894` | `ads_resumeSection` | State 4 (run without reset) through 1048:0805; unreferenced |
| `1048:08b4` | `ads_setSectionStateUnlessFresh` | Clears a section's resume pointer and sets its state, unless the state is exactly 8 |
| `1048:0920` | `ads_hideSection` | State 6 (its nodes do not run) through 1048:08b4; unreferenced |
| `1048:0940` | `ads_freezeSection` | State 5 (its nodes replay without advancing) through 1048:08b4; unreferenced |
| `1048:0960` | `ads_slotIndex` | Slot argument n (0 = current) to an index, or -1 when that slot is empty |
| `1048:0993` | `ads_restartAllSections` | State 3 for every section of a slot; unreferenced |
| `1048:09e3` | `ads_startAllSections` | State 4 for every section of a slot; unreferenced |
| `1048:0a33` | `ads_hideAllSections` | State 6 for every section; unreferenced |
| `1048:0a86` | `ads_freezeAllSections` | State 5 for every section; unreferenced |
| `1048:0ad9` | `ads_resetAllSections` | State 8 for every section of a slot, then resets every node; unreferenced |
| `1048:0bc5` | `ads_resetAllNodes` | Resets every node of the current ADS (1048:0b3e) |
| `1048:0bf4` | `ads_findNode` | First node of the current ADS with a TTM id and tag, or 0 |
| `1048:0c30` | `ads_sectionResumePoint` | The section start, or just past the first word 0x0005 met before 0xFFFF |
| `1048:0c8d` | `ads_randomWeight` | Weight of an instruction in a random block: word +8 for 0x2000/0x2005, +2 for 0x3020, +6 otherwise |
| `1048:0cda` | `ads_randomBlock` | Runs one weighted pick (1018:1e60) among the instructions up to 0x30FF, unless it is 0x3020; returns the pointer past 0x30FF |
| `1048:0db6` | `ads_addScene` | 0x2005: sets a node's mode from its count argument (0 once, n > 0 n times, n < 0 until now - n) and counts the play |
| `1048:0e2e` | `ads_restartScene` | 0x2000: page = tag page, then 1048:0db6 |
| `1048:0e6e` | `ads_holdScene` | 0x2015: node mode 5 (replays its page, never advances) |
| `1048:0e9b` | `ads_stopScene` | 0x2010: node mode 0 |
| `1048:0ec8` | `ads_resetScene` | 0x2020: resets the node (1048:0b3e) |
| `1048:0ef2` | `ads_drawFirst` | 0x4010: moves a node to the head of the node list |
| `1048:0f8c` | `ads_drawLast` | 0x4000: moves a node to the tail of the node list |
| `1048:106b` | `ads_skipBlock` | Skips forward to the 0x1500 or 0x1510 that ends a block, stepping over nested 0x13xx blocks; 0 at 0xFFFF or a 0 word |
| `1048:118a` | `ads_whileEnd` | Scans forward to the 0x1520 that ends a while block; 0 at 0xFFFF or a 0 word |
| `1048:11db` | `ads_skipFalseBlock` | Skips a block whose condition is false and runs its else part when it has one |
| `1048:1223` | `ads_evalConditions` | Evaluates a chain of conditions joined by 0x1420 (and) and 0x1430 (or) into 1068:4634; returns the pointer after the chain |
| `1048:1519` | `ads_runInstruction` | Runs one ADS instruction (44-entry table at 1048:1875); returns the next pointer, or 0 to end the block |
| `1048:1925` | `ads_runBlock` | Runs instructions until 0xFFFF, a null pointer, or an end-of-block marker; returns where it stopped |
| `1048:19e7` | `ads_sectionIndex` | Index of the section of the current ADS whose tag word is the argument, or -1 |
| `1048:1a4b` | `ads_nextSectionTag` | Section tag iterator: stores the next section's tag, returns 1 at the end; unreferenced |
| `1048:1aaf` | `ads_firstSectionTag` | Restarts the section tag iterator; unreferenced |

`1048:118a` is not a function in the export yet (it is called from `1048:1853`). `ApplyNames.java` disassembles and creates a function at any named address that has none.

- [ ] **Action 2: Regenerate the function map**

Run: `node scripts/re/function-map.mjs`
Expected: exits 0 and rewrites `docs/re/function-map.md`. An "unsorted" error means an entry is out of address order; move it.

- [ ] **Action 3: Rebuild the export**

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

Run: `ls re/out/functions/1048_118a_ads_whileEnd.c re/out/functions/1048_1519_ads_runInstruction.asm`
Expected: both files exist. If `1048_118a` is missing, read `re/ghidra-import.log` for `JCR_FAIL`.

- [ ] **Action 4: Commit**

```bash
git add scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): name every ADS function"
```

## Part B: Read and confirm

Read every in-scope function's `.c` file, and its `.asm` wherever the pseudo-C is unclear (signed versus unsigned compares, far pointer arithmetic, the switch cases; case addresses map to opcodes in `re/out/jump-tables.tsv`). For each bullet of the overview's `Binary facts`, decide: confirmed, or corrected. Keep a list of corrections; they go in the commit message and into `ads.md`.

- [ ] **Action 5: Confirm the details most likely to be wrong**

Check each in the assembly and note the answer:

1. `1048:1223`: the compare instruction for `0x1080`, `0x1380`, `0x1390` (`JL`/`JG` = signed) and for `0x13a0`..`0x13c1` (`JB`/`JA` = unsigned).
2. `1048:196e` and the end-time test at the end of `1048:1acb`: 32-bit compares, high word first, unsigned.
3. `1048:0db6`: how `n` is tested (`n == 0`, `n < 0` signed), and that the end time is `now - n` with `n` sign-extended.
4. `1048:1acb`: which mode value the end-time test uses (the mode read before the page ran, or after); and whether the "not run" branch tests the section-state copy `+0x2b` (`s`) or the mode.
5. `1048:1519` case `0xF010`: what it returns when the section is not found and no section is current.
6. `1048:0766`: the exact set of modes that count as busy, and the self-goto test (`[6]`, byte `+0x0c`).
7. `1048:118a`: confirm the overview's reading (scan to `0x1520`; `0xFFFF` or a 0 word → 0).
8. `1048:106b`: confirm that only `0x1310`..`0x13c1` count as nested blocks (the table at `1048:1142`), and that the nested condition chain goes through `1048:1223`.
9. `1018:06bf`: confirm that a walk entry (byte `+0x0f` of the queue entry is `-1`) does not reach `1048:1acb`.

- [ ] **Action 6: Check the data against the edge cases**

Write `re/scratch/ads/scan.py` (gitignored scratch):

```python
import struct
import sys
from pathlib import Path

ARGS = {0xF000: 0, 0xF010: 1, 0xF200: 1, 0xF210: 1, 0x1080: 1, 0x3020: 1,
        0x2000: 4, 0x2005: 4, 0x2010: 3, 0x2015: 3, 0x2020: 3, 0x4000: 3, 0x4010: 3}
for op in (0x1010, 0x1020, 0x1030, 0x1040, 0x1050, 0x1060, 0x1070,
           0x1310, 0x1320, 0x1330, 0x1340, 0x1350, 0x1360, 0x1370):
    ARGS[op] = 2
for op in (0x1380, 0x1390, 0x13A0, 0x13A1, 0x13B0, 0x13B1, 0x13C0, 0x13C1):
    ARGS[op] = 1

for path in sorted(Path(sys.argv[1]).glob("*.ADS.ADSSCR.bin")):
    data = path.read_bytes()
    words = struct.unpack(f"<{len(data) // 2}H", data[: len(data) // 2 * 2])
    i, section_start = 1, True
    while i < len(words):
        op = words[i]
        if op in (0x0001, 0x0005, 0x0000) and not section_start:
            print(f"{path.name}: word {op:#06x} as an instruction at byte {2 * i}")
        if op == 0xFFFF:
            i += 2
            section_start = True
            continue
        section_start = False
        if op in (0x1070, 0x1520, 0x4000):
            print(f"{path.name}: {op:#06x} at byte {2 * i}: " + " ".join(f"{w:#06x}" for w in words[i : i + 12]))
        i += 1 + ARGS.get(op, 0)
```

Run: `re/.venv/bin/python -I re/scratch/ads/scan.py re/fixtures/decompressed`
Expected: no "as an instruction" line (so `1048:0c30` always returns the section start in practice; if a line appears, note it as a finding). The `0x1070`, `0x1520`, and `0x4000` lines show the one while block (`ACTIVITY.ADS`) and the four draw-order uses; describe each in `ads.md` (`Blocks`, `Scene operations`) with its file and byte offset.

## Part C: Write the findings

- [ ] **Action 7: Write `docs/re/ads.md`**

Create the file with this header, then the sections below in this order. One claim per bullet, each starting with its address, in our own words. Follow `docs/re/ttm.md` for tone and density.

```markdown
# ADS Scheduler

How the original runs ADS scripts: the record, the nodes made from TTM tags, the section scripts re-run every tick, and how a node's TTM pages advance. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 6. One claim per address. Our own words; no decompiled code. Opcode counts come from the 10 ADS scripts (`docs/re/decoders.md`, `ADS opcode coverage`).
```

What each section covers (the overview's `Binary facts` has the first reading of each):

- `Record and slots`: the 10 slots, the `0x472`-byte record layout, the current slot `1068:2608`, the current section `1068:2606`, `1068:4608` (high word), `1068:4634`, the clock `1068:2e70`/`2e72` (`1008:16c2` adds 1 per timer callback), `1068:463a`/`4636`/`4638` (never written, 0 in the data segment), `1048:0960`.
- `Nodes`: the node layout, where nodes come from (`1050:042a` via `1050:04d6`, one per `0x1111`), list order, `1048:0b3e`, `1048:0bc5`, `1048:0bf4`; the mode values and what sets each.
- `Sections`: section starts and tags (`1048:04fc`, chunk 3), the state word and its values, the fresh bit, the loop counter, the resume pointer, scene lists (`1048:040f`, only `0x2000`/`0x2005`, distinct, unknown nodes dropped), `1048:19e7`, `1048:0c30` (with the Action 6 result).
- `Tick`: `1048:1acb` step by step (the three passes, what each node branch does, the return value), with the confirmed answers of Action 5, items 2 and 4.
- `Page advance`: `1048:196e`.
- `Script runner`: `1048:1925`, `1048:1519` (every opcode of the `1048:1554` table, and the default), the end-of-block counter.
- `Blocks`: if blocks (`1758` case), else (`0x1500`), `1048:106b`, `1048:11db`, while blocks (`17a0` case), `1048:118a`, the `ACTIVITY.ADS` while block from Action 6. Say plainly that every if block of a running section is re-checked on every tick, and that a true while block ends the section's pass and makes the next pass start at it.
- `Conditions`: `1048:1223` (and/or rules), every condition opcode with its node test, compare signedness (Action 5, item 1), and which ones the data uses.
- `Scene operations`: `1048:0db6`, `0e2e`, `0e6e`, `0e9b`, `0ec8`, `0ef2`, `0f8c` and the draw-order consequence.
- `Random`: `1048:0cda`, `1048:0c8d`, the formula `abs(int16(rand % total)) + 1`, what happens when `0x3020` is picked.
- `Section control`: `0xF000`, `0xF010`, `0xF200`, `0xF210` (inside `1048:1519`), `1048:0805`, `1048:08b4`, `1048:0874`.
- `Story interface`: `1048:0874`, `1048:04fc` (called every step), `1048:0766`; `1018:06bf` (when it calls each, that walk entries skip the ADS tick, Action 5 item 9). Mark these as read for the interface; chunk 7 owns `1018`.
- `Loading and unloading`: `1048:0079` (the all-or-nothing TTM load, OQ-13), `1048:0044`, `1048:067f`, `1048:001b`, `1048:0000`.
- `Unreferenced`: `1048:0894`, `0920`, `0940`, `0993`, `09e3`, `0a33`, `0a86`, `0ad9`, `1a4b`, `1aaf`, `1e5a`: what each would do, and that nothing calls or relocates to it (check with `rg -n "1048:0894|..." re/out/index.tsv re/out/relocations.tsv`).
- `Side-by-side checklist`: the table below.

```markdown
## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1048:0000` | `ads_init` | none (nothing to free in JavaScript) | match |
```

One row per function of the overview's `Function scope`, in address order. For now, `Ours` is `src/ads/scheduler.ts` (whatever handles it today, or `none`) and status `open`; steps 3 to 5 replace the rows as the port lands. Rows for unreferenced functions read `none (unreferenced)` with status `match`. `1048:0303` and `1048:04fc` point at `src/decode/ads-bytecode.ts` as `docs/re/decoders.md` does.

Leave `Emulated` and `Past fixes reviewed` out; steps 2 and 6 add them.

- [ ] **Action 8: Update the segment overview**

In `docs/re/segments.md`, set the `1048` row (Code10) to describe it as the ADS loader, section scripts, and tick. Under "Tables found", add one line each for `1068:460c` (ADS slots), `1068:2608` (current slot), `1068:2606` (current section), `1068:4608` (end-of-block counter, high word), `1068:4634` (condition result), `1068:2e70` (clock), and the four `1048` switch tables (`1048:0383`, `1048:1142`, `1048:14bd`, `1048:1875`).

- [ ] **Action 9: Commit**

```bash
git add docs/re/ads.md docs/re/segments.md
git commit -m "docs(re): ADS scheduler findings"
```

If Action 5 or 6 corrected a fact of the overview, list each correction in the commit body, one line each (`<address>: overview said X, the code does Y`).

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
