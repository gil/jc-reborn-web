# Step 4: Seed the Function Map

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ghidra-import-export.md`, `step-002-function-map-docs.md`

**Files:**

- Modify: `scripts/re/names.json`
- Modify: `docs/re/function-map.md` (regenerated, never hand-edited)
- Create: `docs/re/segments.md`

**Interfaces:**

- Consumes:
  - `scripts/re/ghidra-import.sh` (no args, rebuilds `re/out/`, non-zero exit on failure).
  - `re/out/strings.tsv` (`address	text	scalarHits`, hits formatted `instructionAddress@functionEntry`), `re/out/imports.tsv` (`slot	import	callers`), `re/out/index.tsv`, `re/out/functions/<ssss>_<oooo>_<name>.c`.
  - `node scripts/re/function-map.mjs` (validates `names.json`, regenerates the map, exits 1 with errors).
- Produces: `names.json` entries that chunks 2 to 8 start from, and `docs/re/segments.md`, which says which code segment holds which subsystem.

This step is reverse engineering work, not coding. The goal is a starting map: find the functions behind known strings and imports, read enough of each to give it an honest name and a one-line note, and stop there. Deep reading is for chunks 2 to 8.

## Rules for this step

- Status is always `named`. Nothing gets `verified` in this step.
- Name what you can see in the pseudo-C, not what the old port says it should be. If a function only opens a file, call it `..._openResourceMap`, not `..._loadAllResources`.
- If you can't tell what a function does after a few minutes, skip it. A missing entry is better than a wrong name.
- Notes are your own words. Never paste decompiled code into `names.json` or `docs/`.
- Use the subsystem list from the overview. Windows glue (window, message loop, INI, memory) goes under `platform`.
- Keep `names.json` sorted by address. The validator rejects unsorted files.

- [x] **Action 1: Fresh export**

Run: `scripts/re/ghidra-import.sh`
Expected: `export written to .../re/out`.

- [x] **Action 2: Name the three known string users**

Already confirmed by probing (instruction → function):

| String | Address | Loaded at | Function |
| --- | --- | --- | --- |
| `JOHNCAST.PAL` | `1068:024a` | `1008:14bd` | `1008:143c` |
| `NIGHT.SCR` | `1068:02d3` | `1010:0213` | `1010:0136` |
| `RESOURCE.MAP` | `1068:1cbc` | `1018:179b` | `1018:1771` |

For each function, read `re/out/functions/<ssss>_<oooo>_FUN_<ssss>_<oooo>.c`, decide name, subsystem, and note, and add an entry to `scripts/re/names.json`, e.g.:

```json
"1018:1771": {
  "name": "resources_openResourceMap",
  "subsystem": "resources",
  "status": "named",
  "note": "Opens RESOURCE.MAP and reads the archive index",
  "signature": null,
  "callingConvention": null
}
```

The example name and note are placeholders for what you actually read. Replace them with what the pseudo-C shows.

- [x] **Action 3: Name the functions behind the other anchor strings**

For each string below, find its row in `re/out/strings.tsv` (use `rg -n -F '<text>' re/out/strings.tsv`). Take the function after `@` in each scalar hit, read its `.c` file, and name it per the rules. One function often covers several strings. Name it once.

| Strings | Likely subsystem |
| --- | --- |
| `BMP:INF:`, `BMP:BIN:`, `BMP:VGA:`, `BMP:MTX:` | `decoders` |
| `SCR:DIM:`, `SCR:BIN:`, `SCR:VGA:` | `decoders` |
| `PAL:VGA:` | `decoders` |
| `ADS:RES:`, `ADS:SCR:` | `decoders` |
| `INTRO.SCR`, `OCEAN00.SCR`, `OCEAN01.SCR`, `OCEAN02.SCR`, `HOLIDAY.BMP`, `BACKGRND.BMP`, `MRAFT.BMP`, `JOHNWALK.BMP` | `story` |
| `ACTIVITY.ADS`, `BUILDING.ADS`, `FISHING.ADS`, `JOHNNY.ADS`, `MARY.ADS`, `MISCGAG.ADS`, `STAND.ADS`, `SUZY.ADS`, `VISITOR.ADS`, `WALKSTUF.ADS`, `Unable to load ADS file` | `story` or `ads` |
| `New Scene` | `story` |
| `%2d:%02d %cm` | `story` or `ttm` |
| `WAVESFX` | `audio` |
| `SCRANTIC.INI`, `Background`, `Clouds`, `Waves`, `Sounds`, `NumDays`, `CurrentYear`, `StartTime` | `platform` |
| `Insufficent memory` | `platform` |

The subsystem column is a guess. Use what the code shows.

Strings with no scalar hit may be reached through a table. If a hit lands on a table address, note the table in `docs/re/segments.md` (action 6) and move on.

- [x] **Action 4: Name the main users of key imports**

Open `re/out/imports.tsv`. For each import below, look at its callers. Name a caller when its role is clear from the pseudo-C (for example, the one function that reads all INI keys, or the one that wraps `BITBLT` for sprite blits). Skip callers that are generic wrappers you can't place yet.

| Imports | Look for |
| --- | --- |
| `GETPRIVATEPROFILEINT`, `GETPRIVATEPROFILESTRING`, `WRITEPRIVATEPROFILESTRING` | settings load/save (`platform`) |
| `SNDPLAYSOUND`, `MCISENDCOMMAND` | sample playback (`audio`) |
| `BITBLT`, `SETPIXEL`, `LINETO`, `MOVETO`, `ELLIPSE`, `RECTANGLE` | drawing primitives (`gfx`) |
| `GLOBALALLOC`, `GLOBALLOCK`, `GLOBALFREE` | memory wrappers (`platform`) |
| Any `USER` timer or message function (`SETTIMER`, `KILLTIMER`, `GETMESSAGE`, `PEEKMESSAGE`, `DISPATCHMESSAGE`) and `GETTICKCOUNT` / `GETCURRENTTIME` if present | main loop and tick timing (`story`) |

Also name the `SCREENSAVERPROC` export (window procedure) under `platform`. Find its address with `rg -n -i screensaverproc re/out/index.tsv`. If it isn't in the index by name, look it up in `re/ghidra-import.log` or skip it.

- [x] **Action 5: Validate, apply, and regenerate**

Run: `node scripts/re/function-map.mjs`
Expected: `wrote .../docs/re/function-map.md`. On errors, fix `names.json` and re-run.

Run: `scripts/re/ghidra-import.sh`
Expected: `export written to .../re/out`. This applies the new names in Ghidra. Callers' pseudo-C now shows them.

Run: `node scripts/re/function-map.mjs`
Expected: the unknown count in `docs/re/function-map.md` matches the fresh export.

- [x] **Action 6: Write `docs/re/segments.md`**

Use what the named functions show. One row per segment. Write "unclear" when you don't know. Never guess past the evidence.

```markdown
# Segment Overview

Which NE segment holds which subsystem, based on the functions named so far. Update when a chunk learns more.

| Segment | Ghidra | Size | Main subsystem | Evidence |
| --- | --- | --- | --- | --- |
| Code1 | `1000` | `0x28a9` | `rtl` | Borland runtime helpers (`rtl_lxmul`, `rtl_scopy`, shifts) |
| Code2 | `1008` | `0x1711` | ... | ... |
| Code3 | `1010` | `0x1f6f` | ... | ... |
| Code4 | `1018` | `0x1f5f` | ... | ... |
| Code5 | `1020` | `0x083c` | ... | ... |
| Code6 | `1028` | `0x1b1e` | ... | ... |
| Code7 | `1030` | `0x1bb4` | ... | ... |
| Code8 | `1038` | `0x1ec8` | ... | ... |
| Code9 | `1040` | `0x11db` | ... | ... |
| Code10 | `1048` | `0x1f1f` | ... | ... |
| Code11 | `1050` | `0x0bc7` | ... | ... |
| Code12 | `1058` | `0x1c30` | ... | ... |
| Code13 | `1060` | `0x0a7e` | ... | ... |
| Data14 | `1068` | `0x47c0` | data | Auto data segment: globals, strings, heap, stack |

## Tables found

(Address, what it seems to hold, which function reads it.)
```

Replace every `...` with what you found or with "unclear". Under "Tables found", list each table you hit in action 3, or write "None yet."

- [x] **Action 7: Run tests**

Run: `pnpm test`
Expected: all pass. That includes `function-map.test.ts`'s check that the committed map matches `names.json`, and `export.data.test.ts`'s check that every name was applied.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py'`
Expected: OK. Skip this if step 3 hasn't run yet (`re/.venv` missing).

- [x] **Action 8: Commit**

Run: `git status --short`
Expected: only `scripts/re/names.json`, `docs/re/function-map.md`, `docs/re/segments.md`. Nothing under `re/`.

```bash
git add scripts/re/names.json docs/re/function-map.md docs/re/segments.md
git commit -m "docs(re): seed function map from string and import anchors"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
