# Step 2: TTM Findings

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-jump-tables-in-export.md`

**Files:**

- Create: `docs/re/ttm.md`
- Modify: `docs/re/open-questions.md` (OQ-14, OQ-16, OQ-19, new OQ-27), `scripts/re/names.json` (notes corrected where the reading differs), `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes: `re/out/functions/*.{c,asm}` with the switch cases (step 1), `re/out/jump-tables.tsv` (`jump`, `index`, `value`, `target`), `re/out/index.tsv`, `re/out/strings.tsv`. The overview's `Binary facts` (first reading). `docs/re/graphics.md` and `docs/re/decoders.md` for the callees already verified (`1038:06ce`, `1060:007e`, `1038:0ae4`, `1030:03d7`, `1030:01c4`, `1030:0250`, `1030:16d8`, `1030:124a`, `1040:09eb`, `1040:0b08`).
- Produces: `docs/re/ttm.md` with the sections listed in the overview (`Shared pieces`), every claim confirmed against the export and tied to an address. Later steps add to `Emulated`, `Past fixes reviewed`, and `Side-by-side checklist`; this step writes checklist rows only for functions that need no TypeScript.

This step reads and writes. No code changes. Expect most of the session to go into the assembly of `1058:040c` and `1058:1510`; the pseudo-C of those two may still be partial.

## Part A: Read

- [ ] **Action 1: Confirm the page runner**

Read `re/out/functions/1058_040c_*.asm` from the start to `RETF` and `1050_074a_*.c`. Confirm or correct, item by item, the overview's `Page runner` bullets: the entry checks, the replay flag and goto reset, the opcode remaps, the `0x0FF0` stop, the per-instruction `B`/`B` target and source, the arg locals and the stale-local behavior, the string and word-pair cases (`1058:141f`, `1050:04a8`), both offset passes (cases at `1058:05a1`, `05b9`, `0608`, `0620`), the dispatch order, the `0xf10f..0xf19f` string branch (`1058:1005`), the dirty table and its default (`1058:11f0`), and the end-of-page `4640` block (`1058:1212`).

- [ ] **Action 2: Confirm every opcode**

For every row of `re/out/jump-tables.tsv` whose jump is in `1058`, read the case at `target` in the assembly and confirm the overview's `Opcodes` table. Note any difference. Read also `1058:0000` (sound cases), `1058:0144` (draw cases and the effect and text ranges), `1058:1510` (each effect case: `0xa014` `171a`, `0xa024` `1705`, `0xa034`/`0xa094` `1565`, `0xa044` `185f`, `0xa054` `1747`, `0xa064` `1801`, `0xa0b5` `172f`, and the default loop for `0xa074`/`0xa084`), `1058:13a9`, `1058:14e0`, `1058:147a`, `1058:14a8`, `1058:1920`, `1058:1949`, `1058:197c`, `1058:198a`, `1058:1ad0`, `1058:1b1f`, `1058:1be1`, `1058:1c06`.

For the opcodes the data uses (those with a count above 0 in the overview's table), write down the exact arguments of every call they make; step 4 ports them literally.

- [ ] **Action 3: Confirm the helpers and state**

Read `1050:0000`, `1050:0061`, `1050:0152`, `1050:0799`, `1050:07c6`, `1050:080c`, `1050:0a6e`, `1050:0a85`, `1050:0b31`, `1050:0b74`, and the stubs `1030:07c3`, `1030:07d4`, `1040:0c13`, `1040:0c21`, `1040:0c31`. Confirm the TTM record and thread node layouts in the overview (`TTM record and thread node`), using `1048:0b3e`, `1050:0177` (record allocation, size `0xd4`), and `1050:042a` (node allocation, size `0x3d`).

Confirm the runtime values: `rg -n "\[0x2641\]|\[0x287a\]|\[0x1ebf\]" re/out/functions/*.asm` shows no write to `2641` other than `1050:0152`, the one write to `287a` in `1008:143c`, and no write to `1ebf`. Read the data segment words with:

```bash
re/.venv/bin/python -I -c "
import struct, sys
sys.path.insert(0, 'scripts/re/unicorn')
from ne_image import NeImage
image = NeImage.load('public/data/SCRANTIC.SCR')
data = image.segments[image.auto_data_segment - 1].data
for address in (0x2641, 0x287a, 0x27c0, 0x27c2, 0x46e4, 0x46e2, 0x1ebf):
    print(hex(address), hex(struct.unpack_from('<H', data, address)[0]) if address + 2 <= len(data) else 'bss (0)')
print(data[0x27d2:0x27df])
"
```

Expected: `2641` = 4, `287a` = 1, `1ebf` = 0, and `b'JOHNWALK.BMP\x00'`.

- [ ] **Action 4: Read the ADS side for the interface**

Read `1048:1acb`, `1048:196e`, `1048:0b3e`, `1048:1e5a`, and `1018:06bf` (`story_stepScene`). Confirm the overview's `ADS side` bullets. Do not go further into the ADS logic (chunk 6); write only what the TTM side depends on: which globals the ADS loads from the node before a run, which results it reads after (`46e6`, `4644`, `4642`, the return value), when the ran flag `[7]` is set and cleared, and the order of calls in one story step.

## Part B: Write the findings

- [ ] **Action 5: Write `docs/re/ttm.md`**

Create the file with this header, then one section per heading below, in this order. One claim per bullet, each starting with its address, in our own words, never pasted code. Model: `docs/re/graphics.md`.

```markdown
# TTM Interpreter

How the original runs TTM scripts: pages, opcodes, what each draws where, and which state it keeps. Trust order and conventions: `docs/re/README.md`.
```

Sections and what goes in each:

1. `Page runner`: `1050:074a`, `1058:040c` entry, per-instruction work, dispatch order, end-of-page block, return value. State plainly that a page is the code between two `0x0FF0` and that the runner never keeps an instruction pointer between calls.
2. `Arguments and offsets`: arg locals and stale values, strings and word pairs, both offset passes with their exception tables (`1058:138d`, `1058:1379`), the island offset setter `1010:00fc` (one bullet, chunk 7 owns it).
3. `Thread and record state`: the TTM record fields and the thread node fields this chunk uses, the reset values (`1048:0b3e`), and the runtime values of `2641`, `287a`, `429e`, `1ebf`, `1ebd`.
4. `Opcodes`: one table, every opcode of the four `1058` tables plus the remaps, the text-string range, and `0x0FF0`: `| Opcode | Handler | Uses in the data | Effect |`. Uses come from `docs/re/decoders.md`, `TTM opcode coverage` (0 when absent). Effects in short words; details go to the sections below.
5. `Drawing and dirty rects`: the per-instruction B target, `1050:0a85` and its three rects, the dirty table `1058:1275` row by row and the default, the line and circle oddities (`x - 20`, `w + 48`, `h + 1`; the `+ 8` / `+ 2` default), and why `0xa601` is not a clear: with the restore pass erasing B from C every step (`1060:03d3`, `docs/re/graphics.md`), nothing needs clearing.
6. `Resources`: `0x0080`, `0xf01f` (`1028:1813` then `1050:0b31`), `0xf02f` (`JOHNWALK.BMP` and `1068:30d2`, `1068:4106`/`46d6`), `0x2012`, `0xf05f`, `0x0070`, `0x1061`; names are passed as the bytecode spells them; which functions free what (`1028:1845`, `1040:0bc7`).
7. `Palettes`: the pending palette `1068:4646`/`4648`, who sets it, and that it becomes active only at the end of the ADS tick (`1050:0799` from `1048:1acb`) or through `0x4114`/`0x4124`; every other palette opcode runs only with `1068:1ebf` set, which never happens, and reaches empty stubs.
8. `Zones and effects`: the twelve zone slots, `0xa054`/`0xa064` (zone 0 only, saved from B, restored into B at the saved rect, run only on the first run and inside the screen), `0x00c0`, `0x1121`, `0xa601`; then the other effects of `1058:1510` in one bullet each, marked as unused by the data.
9. `Delays`: `0x1021`, `0x2022` with the exact formula and the unsigned divide, `1018:1e60` (the generator, one bullet; seeding is chunk 7), and how the ADS turns `46e6` into a due time (`1048:1acb`, `1048:196e`).
10. `Text and fonts`: `0xf04f`, `0x1071`, `0x0090`, `0xf10f..0xf19f`, `0xa204..0xa294`, `1030:0765`, `1030:04ce`, `1030:04ee`, the two empty font stubs; no TTM script uses any of them.
11. `Stubs and dead branches`: every return-0 stub reached from `1058` (`1028:17c8`, `1028:187e`, `1028:188e`, `1028:18ae`, `1028:195e`, `1028:19ec`..`1028:1acc`) with the opcode that reaches it; the `1ebf` branches; `1050:0000`/`1050:0061` (`0xb000`/`0xb013`); the BMP matrix opcodes.
12. `Unloading`: `1050:07c6`, `1050:080c`, `1050:0a6e`, `1050:0152`.
13. `ADS side`: the bullets from Action 4, marked "read for the interface; chunk 6 verifies".
14. `Emulated`: one line for now: `Step 3 of the chunk 5 plan adds the trace comparison here.` (step 3 replaces it).
15. `Past fixes reviewed`: one line for now: `Filled in at the end of chunk 5.` (step 7 replaces it).
16. `Side-by-side checklist`: the table header and one row per function that needs no TypeScript, `Ours` = `none (<reason>)`, status `match`: the five empty stubs, `1050:0000`, `1050:0061`, `1050:0152`, `1050:07c6`, `1050:080c`, `1050:0a6e`, `1058:14a8`, `1058:147a`, `1058:141f`, `1058:1920`, `1058:197c`, `1058:198a`, `1058:1ad0`, `1058:1b1f`, `1058:1be1`, `1058:1c06`. Reasons are short: `empty`, `no TTM script uses 0xb000`, `garbage collection frees records`, `strings are decoded by readTtmInstruction`, and so on. Steps 4 to 6 add the rest.

```markdown
| Original | Name | Ours | Status |
| --- | --- | --- | --- |
```

- [ ] **Action 6: Correct the names**

Where Part A found that a `names.json` note from step 1 is wrong or vague, fix the note. Run: `node scripts/re/function-map.mjs`. Expected: no errors.

## Part C: Open questions

- [ ] **Action 7: Settle OQ-14, OQ-16, OQ-19, add OQ-27**

In `docs/re/open-questions.md`:

1. OQ-14 (`1028` stub group): move to `## Resolved` with: `Settled by chunk 5: every stub that 1058 code reaches returns 0 and is reached only from opcodes no TTM script uses (docs/re/ttm.md, Stubs and dead branches). The 25 stubs without a reference stay unreferenced.` Keep its original bullets above that line.
2. OQ-16 (text drawing): move it under `## Not reviewed on purpose`. Set **Status:** `open, by choice` and add a bullet: `- **Chunk 5:** only TTM opcodes 0xa204..0xa294 draw text, through 1030:04ce; no TTM script uses them or the font opcodes (docs/re/ttm.md, Text and fonts). The engine does not draw text.`
3. OQ-19 (stretched sprites): move to `## Resolved` with: `Settled by chunk 5: 1030:03d7 is reached only from 1058:025b for opcodes 0xa506, 0xa516, 0xa526, 0xa536, which no TTM script uses (docs/re/ttm.md, Opcodes). The pixel rule stays GDI behavior, irrelevant to the data.`
4. Add under `## Not reviewed on purpose`:

```markdown
### OQ-27: TTM opcodes the data never uses

- **Where:** `src/ttm/page-runner.ts` (no case for them)
- **What it does:** our runner treats these as doing nothing (apart from the default dirty rect for `0xAxxx` opcodes): the effects `0xa014`, `0xa024`, `0xa034`, `0xa044`, `0xa074`, `0xa084`, `0xa094`, `0xa0b5` (`1058:1510`); the palette effects `0x0400`, `0x2302`..`0x2322`, `0x2402`, `0x4136` (they need `1068:1ebf`, never set), and `0x4114`, `0x4124` (copy B to the screen and select the pending palette); text and fonts (OQ-16); the BMP matrix `0x00e0`, `0x2032`, `0xa704`, `0xf08f` (no resource has `BMP:MTX:`); `0xb000`, `0xb013` (`1050:0000`, `1050:0061`); `0x0010`, `0x1011`, `0x1041`, `0x1031`, `0xaf02`, `0xaf1f`, `0xaf2f`, `0xa5a7`, the `0xCxxx` opcodes other than `0xc051`.
- **Original:** `docs/re/ttm.md`, `Opcodes`, `Zones and effects`, `Palettes`, `Stubs and dead branches`.
- **Why not reviewed:** no TTM script uses any of them (`docs/re/decoders.md`, TTM opcode coverage), so nothing can check a port against the original's output.
- **Status:** open, by choice
```

If Part A found that the runner must model one of them (for example because the data does use it after all), take it off this list and tell step 4 in the commit message.

- [ ] **Action 8: Commit**

```bash
git add docs/re/ttm.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): TTM interpreter findings"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
