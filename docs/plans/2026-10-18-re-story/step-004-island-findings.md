# Step 4: Island Findings

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-story-findings.md` (names and export)

**Files:**

- Create: `docs/re/island.md`
- Modify: `scripts/re/names.json` (notes corrected after reading), `docs/re/function-map.md` (regenerated)
- Local only (gitignored): `re/scratch/island/*.py`

**Interfaces:**

- Consumes: the overview's `Binary facts`, section `Island (1010)`; `re/out/functions/1010_*.c` / `.asm`; `re/out/index.tsv`, `re/out/relocations.tsv`, `re/out/strings.tsv`; `docs/re/graphics.md` (`1038:0ae4`, `1038:0ac2`, `1060:04b2`, `1060:007e`, `1038:06ce`, `1038:1bd8`, `1030:02ef`, clip globals `1068:1ea3`..`1eaa`); `docs/re/story.md` (step 1).
- Produces: `docs/re/island.md` with the sections of Action 4 and a `Side-by-side checklist` with one row per `1010` function of the overview's `Function scope`. Step 6 ports exactly what `island.md` says.

This step writes no TypeScript. Where `island.md` and the overview's first reading disagree, `island.md` wins.

## Part A: Read and confirm

Read every `1010` function's `.c` file, and its `.asm` wherever the pseudo-C is unclear. Ghidra writes signed overflow tests as `SCARRY2(a, b) != (a + b < 0)`: that is the signed result of `a + b < 0`; and `iVar != 0 && SCARRY2(a, b) == iVar < 0` is `a + b > 0` (signed). Keep a list of corrections to the overview.

- [x] **Action 1: Confirm the details most likely to be wrong**

Check each in the assembly and note the answer:

1. `1010:0136`: the order of random draws (ocean screen choice, then the low tide pick, then `1010:1b00`); the draw target at each point (`1068:1eb8` = `1eb0` C, then `1eb2` B); which sprite index each `PUSH word ptr [BX + n]` reads (`n / 2`); the string each `PUSH 0x2b0`, `0x2bc`, `0x2c9`, `0x2d3`, and the table `1068:0262` point to (`re/out/strings.tsv`).
2. `1010:1b00`: unsigned or signed halving (`SHR` or `SAR`), the exact `==` tests on the place word, and which result goes to x and which to y.
3. `1010:14bf`: signed range tests (`JL`/`JGE`), unsigned `DIV` for the remainder, and that x is drawn before y.
4. `1010:0e74`: the counter advance order (`0282 == 0286`, then `0284 == 0282`), the reset value of `0288` (4), which tide branch (`30c0 == 0` is high tide), and the sprite base of each argument (`3`, `6`, `9`, `0x1e`, `0x21`, `0x24`, `0x27`: is it the byte offset / 2 into the BACKGRND table plus a counter?).
5. `1010:0a38` and `1010:0b67`: the cloud kind fallbacks of `0a38` (large → medium → small) and their absence in `0b67`; the post-decrement countdown test; the mirror flag (2 when the wind blows right); that `0a38` always walks 15 records while `0b67` walks `1068:2f34`.
6. `1010:04a2`: the order of the `1018:1ef5(35)` draw and the `30bc > 100` test (does the draw happen when the speed is too low?); which frame table each kind reads (`1068:0268`, `0270`, `0278`); the glint's dirty rects and ages; the `period = 1018:1ef5(30, 50)` call.
7. `1010:1551`: the clip it sets (`1ea4 = x`, `1ea6 = x + w`, `1ea8 = y`, `1eaa = y + h`, inclusive, so one pixel wider than the sprite), that it restores the old clip, and the bottom-edge tests `(x, y + h, w, 1)`.
8. `1010:1d69` and `1010:1e50`: raft frame clamp and positions by tide; holiday value → sprite index and rect.
9. `1010:0059`, `1010:00b2`: any caller or relocation (`rg -n "1010:0059|1010:00b2" re/out/index.tsv re/out/relocations.tsv`). `1010:03ce`: called only from `1008:157b`.
10. `1010:040e`: confirm the overview's reading (clouds only when the argument is set, so they are drawn once per sequence).

- [x] **Action 2: Check the island bitmaps**

Write `re/scratch/island/sheets.py` (gitignored scratch) that loads the archive with `scripts/re/unicorn/corpus.py` (`load_resources(Path("public/data"))`) and prints, for `BACKGRND.BMP`, `MRAFT.BMP`, `HOLIDAY.BMP`, the number of images and each image's width and height (`BMP:INF:` chunk: count word, then the widths, then the heights; `walk_chunks` finds it, as `original_ttm.py` `_bitmap_list` does). Run it with `re/.venv/bin/python -I re/scratch/island/sheets.py`.

Note: the highest BACKGRND index the island code uses (expected 41: the last low-tide surf spot's base 39 plus frame 2; the ocean waves use 18..29, the clouds 15..17); that MRAFT has at least 5 images; that HOLIDAY has 4. Any index past the end is a finding (the original then reads a null record).

- [x] **Action 3: Read the frame tables**

Run: `re/.venv/bin/python -I re/scratch/story/dump.py` (from step 1) or a one-liner over the data segment, and dump `1068:0262..0290`. Expected: `1068:0262` three near pointers (the OCEAN names), `1068:0268` `1a 1b 1c 1d 1c 1b 1a ff`, `1068:0270` `16 17 18 19 18 17 16 ff`, `1068:0278` `12 13 14 15 14 13 12 ff`, `1068:0280` wind `0x0001`, `0282`..`028a` zero.

## Part B: Write the findings

- [x] **Action 4: Write `docs/re/island.md`**

Create the file with this header, then the sections below in this order. One claim per bullet, each starting with its address, in our own words. Follow `docs/re/ads.md` for tone.

```markdown
# Island

How the original draws the island scene: the background, the island and its placement, surf, raft, holiday sprite, clouds, ocean waves, and the redraws that keep island parts in front of moving sprites. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 7. One claim per address. Our own words; no decompiled code. The story calls these from `1018:0540` and `1018:06bf` (`docs/re/story.md`).
```

Sections:

- `Globals`: every `1068` global the island code reads or writes, with its meaning (`30a8`/`30aa`/`30ac` sheets, `30c4`/`30c2` position then offset, `30c0` low tide, `30be` place, `30b2` mode, `30b0` still, `30ae` no raft, `30b4` holiday shown, `30b6` raft frame, `30b8` slot, `30ba` holiday, `30bc` speed, `0280` wind, `0282`..`0286` surf frames, `0288` surf timer, `028a` wave timer, `2e7a`..`2e7e` clouds left, `2e80` cloud records, `2f34` cloud count, `2f36`..`2f3c` waves left, `2f3e` wave count, `2f40` wave records, `2e78` redraw mode), the 6-word record layout (x, y, frame, kind, period, countdown), and the settings each count depends on.
- `Flags from the story`: `1010:1c41` (each flag and place bit, and the reset).
- `Placement`: `1010:1b00`, `1010:14bf`, `1010:00fc` (TTM offset, with the `+1` and `+0x110`).
- `Drawing the island`: `1010:0136` step by step (Action 1 item 1), with the night rule (slot `>= 12` or mode 1) and the color-5 fill.
- `Surf`: `1010:0e74` (both forms; Action 1 item 4), the spot table (rects and sprite bases) for both tides.
- `Raft and holiday`: `1010:1d69`, `1010:1e50` (Action 1 item 8).
- `Clouds`: `1010:0a38`, `1010:0b67` (Action 1 items 5 and 10). Say plainly that clouds never move after the sequence starts.
- `Ocean waves`: `1010:0463`, `1010:04a2` (Action 1 item 6), the frame tables of Action 3, and the speed gate (`docs/re/story.md`, `Timing`: whether `30bc` can exceed 100; if not, say that the original never shows ocean waves and glints).
- `Redrawing over sprites`: `1010:1551` (Action 1 item 7), `1010:1a88`, `1010:1a0d`.
- `Island step`: `1010:040e`.
- `Unreferenced and cleanup`: `1010:0059`, `1010:00b2`, `1010:03ce` (Action 1 item 9).
- `Bitmaps`: the Action 2 counts and sizes.
- `Side-by-side checklist`: one row per `1010` function of the overview's `Function scope`, in address order: `Ours` is `src/island/island.ts` (what handles it today, or `none`) with status `open`; `1010:1c41` points at `src/story/sequence.ts` `applySceneFlags` with status `fixed` (step 3 ported it); unreferenced functions read `none (unreferenced)`, `match`; `1010:03ce` reads `none (nothing to free in JavaScript)`, `match`.

Leave `Emulated` and `Past fixes reviewed` out; steps 5 and 8 add them.

- [x] **Action 5: Correct the names**

If Part A changed what a `1010` function does, rewrite its `note` in `scripts/re/names.json` (our words, one line). Run `node scripts/re/function-map.mjs`.

- [x] **Action 6: Commit**

```bash
git add docs/re/island.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): island findings"
```

If Part A corrected a fact of the overview, list each correction in the commit body, one line each (`<address>: overview said X, the code does Y`).

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
