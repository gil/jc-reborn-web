# Reverse Engineering the ADS Scheduler (Chunk 6) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every function of the original ADS code (segment `1048`) against our engine, replace `src/ads/scheduler.ts` with a literal port of it, prove the port matches the original tick for tick on every section of every ADS script, wire it into the engine, and delete the scheduler workarounds the original does not need.

**Architecture:** The original does not have a thread pool. When an ADS loads, every `0x1111` tag of every TTM it lists becomes a *node* (one per TTM id and tag, in a linked list), and each ADS *section* (the code after a tag word, up to `0xFFFF`) has a state word. Every story step the ADS tick (`1048:1acb`) re-runs the script of each running section from its start: condition blocks look at node modes and decide which scenes to start or stop. Then every node whose mode says it plays runs its current TTM page through the chunk 5 page runner and advances by due times on the clock `1068:2e70`. The port lives in `src/ads/state.ts` (record, nodes, sections), `src/ads/script.ts` (script interpreter), and `src/ads/tick.ts` (tick, page advance, start, busy check). A Unicorn harness runs the original loader and tick on every section of every ADS with the real page runner and the chunk 5 recorders, and a data test compares that trace with ours.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 at `$GHIDRA_INSTALL_DIR` (`/Applications/ghidra`), exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 6).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunks 1 to 5 built the toolchain and checked the archive, decompression, decoders, graphics, and the TTM page runner. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. `docs/re/ttm.md` is the model for the findings file this chunk writes (`docs/re/ads.md`); its `ADS side` section is what chunk 5 already read of `1048:1acb` and `1048:196e`.

The current `src/ads/scheduler.ts` is jc_reborn's design: 10 thread slots, a chunk scanner with bookmarks, a grace period that force-stops threads 100 ticks after `END`, a sweep that frees threads with no TTM, and `mini`-tick pacing. None of these exist in the original. This chunk replaces the file; it does not patch it.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files (fixtures, traces, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Only our own notes, scripts, tests, snapshots, `names.json`, and `jump-tables.json` are committed.
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves. The unittest runner (`-m unittest discover -s scripts/re/unicorn`) puts that folder on the path for test modules.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1048:1acb`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- `scripts/re/names.json` keeps its entries under `"functions"`, sorted by address; `node scripts/re/function-map.mjs` rejects an unsorted file. Insert new entries in address order. After editing it, run `node scripts/re/function-map.mjs` (regenerates `docs/re/function-map.md`).
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or the fixture they compare against) are missing.
- The original wins over workarounds. A difference or workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.
- Scope fence: change chunk 7 and 8 logic (`src/story/`, `src/island/`, `src/walk/`, `src/engine/`, `src/main.ts`, `src/debug/`) only as far as step 5 lists. Every place where step 5 makes up behavior to connect the port gets an open-questions entry with **Resolve in:** the owning chunk.
- If a finding in `docs/re/ads.md` (step 1) contradicts a fact or a code block in this plan, the finding wins: follow it, and say in the commit message which fact changed.

## Binary facts (first reading, 2026-10-18)

These come from reading the export during planning. Step 1 confirms or corrects each and writes the confirmed version as a finding. Address format `ssss:oooo`; NE segment `n` is selector `0x1000 + (n - 1) * 8`; `1068` is the auto data segment (DS). Far cdecl: first argument at `[BP+6]`, caller pops. Every `1048` switch is a Borland linear search; `re/out/jump-tables.tsv` maps each case address to its opcode (tables `1048:0354`, `1048:10a8`, `1048:12ab`, `1048:1554`).

### Record and globals

- ADS slots: 10 far pointers at `1068:460c` (offset) / `460e` (segment); current slot `1068:2608` (`-1` = none). Record `0x472` bytes: word `+0x00` indexed flag, `+0x02` section count, `+0x04`/`+0x06` bytecode far pointer, `+0x08`/`+0x0a` last byte pointer, `+0x0c`/`+0x0e` TTM list head, `+0x10` node list head (near), `+0x12 + 2i` section state (80 words), `+0xb2 + 2i` section loop counter, `+0x152 + 4i` section start far pointer (just after the tag word), `+0x292 + 4i` section resume far pointer (0 = none), `+0x3d2 + 2i` section scene list (near, zero-terminated list of node pointers, or 0).
- `1068:2606`: index of the section the tick is running. `1068:4608` high word: "end of block" counter, raised by `0x1500`, `0x1510`, `0x1520`. `1068:4634`: result of the last condition chain. `1068:2e70`/`2e72`: the 32-bit clock, `+1` per timer callback in `1008:16c2` (chunk 7 owns the rate). `1068:463a`, `4636`, `4638`: compared by conditions `0x1380`..`0x13c1`; nothing in the binary writes them, and the data segment holds 0 there.
- `1068:260a`: the 2 opcodes that name scenes for the scene lists (`0x2000`, `0x2005`).

### Nodes (`0x3d` bytes, made by `1050:042a` when a TTM loads, appended at the list tail)

Word `[0]` TTM id, `[1]` tag, `[2]` tag page, `[3]` next page (`0xFFFF` none), `[4]` current page, `[5]` page run this tick (`0xFFFF` none), `[6]` self-goto flag, `[7]` ran flag (replay). `+0x10..+0x16` font, palette, BMP, zone slots. `+0x1e`/`+0x1f` foreground/background, `+0x20` clip on, `+0x21..+0x27` clip. `+0x29` delay, `+0x2b` section state copy, `+0x2d` play count, `+0x2f` mode, `+0x31` plays left, `+0x33`/`+0x35` end time, `+0x37`/`+0x39` due time, `+0x3b` next node. Only `0x1111` tags make nodes (`1050:04d6`); our `decodeTtm(...).tags` lists exactly those, in file order.

Modes (`+0x2f`): 0 idle, 1 play once, 2 play `+0x31` more times, 3 play until the end time, 4 done (visible to conditions for one script pass, then idle), 5 hold (replays its page, never advances). Section states (`+0x12 + 2i`, low bits): 0 idle, 1 running, 2 stopped, 3 restart (reset its nodes, then run), 4 start (run), 5 freeze (nodes replay, never advance or finish), 6 hide (nodes do not run); bit `8` = fresh (next run starts at the section start; set for all 80 sections by `1048:04fc`).

### Functions

- `1048:0079` load: one slot, loads every `ADS:RES:` TTM through `1048:0044` (nodes appended per TTM); any failed TTM fails and unloads the whole ADS (`1048:001b`). `1048:04fc(slot + 1)` on first use: indexes sections, builds scene lists (`1048:040f`), sets every section state to 8, resets every node (`1048:0bc5` → `1048:0b3e`).
- `1048:0b3e` node reset: palette, BMP, zone slots 0; page = tag page; next page none; colors 15; `+0x1c` 0; delay, due time, plays left, play count, ran flag, mode, section state, self-goto 0; clip on, `(0, 0, 639, 479)`. End time and `[5]` are not touched.
- `1048:0bf4(ttm, tag)`: first node in list order with that TTM id and tag, or 0. `1048:19e7(tag)`: index of the section whose tag word is `tag`, or `-1`.
- `1048:0874(tag)` (story start, through `1048:0805(slot, tag, 3)`): clears the section's resume pointer, state = `(state & 8) | 3`.
- `1048:0766(tag)` (story busy check): 0 when the tag has no section; 1 when the state without bit 8 is 1 or 4; else 1 when any node in the section's scene list has a mode other than 0 and 4 and no self-goto flag; else 0.
- `1048:1acb` tick:
  1. For each section `i`: `s = state & ~8`; for each node in its scene list: `s == 3` → reset the node, else node `+0x2b = s`.
  2. For each section `i` in order: if bit 8 is set, clear it and start at the section start; else start at `1048:0c30(start)` (the section start, or just past the first word `0x0005` found at an instruction start before `0xFFFF`). A non-zero resume pointer overrides the start. State 3 or 4 becomes 1. `2606 = i`. When the start is non-null and the state is 1, run `1048:1925(start)`.
  3. For each node in list order: `[5] = 0xFFFF`; `s = +0x2b`, `m = mode`. If `s != 6` and `m` is 1, 2, 3, or 5: select its TTM, load colors and clip from the node, purge 0, delay `0xFFFF`, run its page `[4]` (`1050:074a`).
     - Not run (or `s == 5`): unless `s == 5`, `[3] = [2]` and mode 4.
     - Run: `[7] = 1`, `[5] = [4]`, tick result 1. A delay that is set and differs from `+0x29` becomes the delay with due time `now + delay`. No purge: a goto sets `[3]`, and `[6] = 1` when it equals `[4]`; then unless mode 5, `1048:196e`. Purge: `[3] = [2]`; mode 2 with plays left ≠ 0 → `196e`, and if it advanced, plays left − 1; mode 3 with end time ≠ 0 → `196e`; otherwise `196e`, and if it advanced, mode 4 and delay 0.
     - Not playing (`s == 6` or `m` is 0 or 4): when `s` is not 5 or 6 and `m == 4`, mode 0.
     - Then, when `m == 3` and the end time `<= now`, mode 4.
  4. Pending palette becomes active (`1050:0799`), clip on, whole screen. Returns 1 when any page ran.
- `1048:196e` advance: when delay ≠ 0 and `now < due`, returns 0. Otherwise (delay ≠ 0) due = `now + delay`; ran flag 0; page = next page (next page cleared) or page + 1; returns 1.
- `1048:1925(p)` run block: loop: `0xFFFF` at `p` → return 0; `p = 1048:1519(p)`; end-of-block counter set → clear it, return `p`; `p` null → return 0.
- `1048:1519(p)` one instruction (table `1048:1554`): `0x0001`, `0x0005` → `p + 2`. `0xFFFF` → 0. `0x1500` (else) → skip to its end (`1048:106b(p + 2)`), counter + 1, return that. `0x1510` (end if) → counter + 1, return `p`. `0x1520` (end while) → counter + 1, return 0. `0x2000` → `1048:0e2e`, `0x2005` → `1048:0db6`, both `p + 10`. `0x2010` → `1048:0e9b`, `0x2015` → `1048:0e6e`, `0x2020` → `1048:0ec8`, `0x4000` → `1048:0f8c`, `0x4010` → `1048:0ef2`, all `p + 8`. `0x3010` → `1048:0cda(p + 2)`. `0x1420`, `0x1430`, `0x3020` → 0. `0xF000`: no current section → 0; else current section state 2, return 0. `0xF010 t`: section = current when `t == 0xFFFF` else `19e7(t)`; if found, state 2; return 0 when it is the current section, else `p + 4`. `0xF200 t` → that section's state = `(state & 8) | 4`, `p + 4`. `0xF210 t` → `| 3`, `p + 4`. `0x1310`..`0x13c1` → if block. `0x1010`..`0x1080` → while block. Any other word → 0.
- If block (`1048:1758` case): `q = 1048:1223(p)`; condition true → `r = 1925(q)`; false → `r = 1048:11db(q)`; return `r + 2` when `r` is non-null, else 0.
- While block (`1048:17a0` case): `q = 1223(p)`; true → section counter + 1, section resume = `p`, `1925(q)`, return 0 (the section's pass ends here; next tick it resumes at `p`). False → counter 0, resume 0, return `1048:118a(q) + 2`.
- `1048:118a(p)` (not a function in the export yet): scans forward; `0xFFFF` or a 0 word → 0; `0x1520` → its address.
- `1048:106b(p)` skip: scans forward; 0 word → 0; `0x1500` or `0x1510` → its address; `0xFFFF` → 0; a nested `0x1310`..`0x13c1` → skip its condition chain (`1223`, which also evaluates it), its body (`106b`), an else body when the body ends at `0x1500` (`106b(p + 2)`), then one instruction past the end. `0x10xx` conditions are not treated as nesting.
- `1048:11db(p)`: `r = 106b(p)`; when `r` is at `0x1500`, `r = 1925(r + 2)` (runs the else body).
- `1048:1223(p)` condition chain: evaluates the condition at `p`, then while the next instruction is `0x1420` (and) or `0x1430` (or): true and `or` → remember "some or was true", skip the next condition; true and `and` → result false, evaluate the next; false and `or` → evaluate the next; false and `and` → skip the next. Result (`4634`) = result or "some or was true". Returns the pointer after the chain.
- Conditions (low byte, same for `0x10xx` and `0x13xx`; node = `0bf4(arg0, arg1)`): `0x10` node in mode 5; `0x20` not that; `0x30` no node or play count 0; `0x40` node with play count ≠ 0; `0x50` node in mode 4; `0x60` no node or mode 0 or 4; `0x70` node in mode 1, 2, or 3. `0x1080 n`: section counter `<= n` (signed). `0x1380 n`: `n >= [463a]`; `0x1390 n`: `[463a] >= n` (signed); `0x13a0`/`13a1 n`: `n >= [4636 + 2 × (op & 0xf)]`; `0x13b0`/`13b1`: `var >= n`; `0x13c0`/`13c1`: `var == n` (unsigned). With every variable 0.
- `1048:0db6(ttm, tag, n)` (`0x2005`): no node → nothing. `n == 0` → mode 1; `n < 0` → mode 3, end time `now - n`; `n > 0` → mode 2, plays left `n - 1`. Then play count + 1. `1048:0e2e` (`0x2000`): page = tag page, then `0db6`. `0e9b` (`0x2010`): mode 0. `0e6e` (`0x2015`): mode 5. `0ec8` (`0x2020`): reset. `0f8c` (`0x4000`): moves the node to the list tail. `0ef2` (`0x4010`): moves it to the head. Nodes run in list order, so these set the drawing order.
- `1048:0cda(p)` random block (after `0x3010`): sums the weights of the instructions up to `0x30FF` (`1048:0c8d`: word `+8` for `0x2000`/`0x2005`, `+2` for `0x3020`, `+6` otherwise); total 0 → return past `0x30FF`; else `k = abs(int16(rand % total)) + 1` with `rand` from `1018:1e60`; walks again subtracting weights until `k < 1`; runs that instruction through `1519` unless it is `0x3020`; returns past `0x30FF`.
- Unreferenced (no call, no relocation): `1048:0894`, `0920`, `0940`, `0993`, `09e3`, `0a33`, `0a86`, `0ad9` (section state setters for one or all sections: 4, 6, 5, 3, 4, 6, 5, 8 plus node reset), `1a4b`/`1aaf` (section tag iterator), `1e5a` (redraw every node's last page as a replay).
- `1018:06bf` (story step, chunk 7) calls `1048:04fc(slot)`, `1048:0874(tag)` once when a scene starts, then each step `1048:04fc(slot)`, `1048:1acb`, `1048:0766(tag)`; the scene ends when `0766` returns 0. Walk entries (ADS id `-1`) do not call the ADS tick.

### Data facts

- Opcodes in the 10 ADS scripts (`docs/re/decoders.md`, `ADS opcode coverage`): `0x1070` (1), `0x1330` (55), `0x1350` (500), `0x1360` (76), `0x1370` (30), `0x1420` (47), `0x1430` (30), `0x1510` (584), `0x1520` (1), `0x2005` (867), `0x2010` (111), `0x3010` (77), `0x3020` (17), `0x30ff` (77), `0x4000` (4), `0xf010` (67), `0xf200` (12), `0xffff` (66). No `0x1500`, `0x2000`, `0x2015`, `0x2020`, `0x4010`, `0xf000`, `0xf210`, no other condition.
- Every section in `FISHING.ADS` starts with `0x1330 ttm tag` (the first scene was never played), its body adds scenes and ends at `0x1510`; later blocks are `0x1350` (that scene is done) chains; the last block calls `0xf010 0xffff` (stop this section).
- Raw decompressed ADS bytecode for reading: `re/fixtures/decompressed/<NAME>.ADS.ADSSCR.bin`.

## Trace format (steps 2 and 4)

Step 2 writes `re/fixtures/ads/traces.tsv` from the original; step 4 builds the same rows from our port. Header: `ads	tag	tick	event	values`. One run per section of every ADS file: a fresh load, `1048:04fc(slot)`, `1048:0874(tag)`, then ticks `0, 1, 2, ...`. Before tick `t` the clock is `now(t)`: `now(0) = 1`, `now(t + 1) = now(t) + 1 + (t % 3)`. Each tick: `1048:04fc(slot)`, `1048:1acb`, `1048:0766(tag)`. The run stops after the first tick where `0766` returns 0, or after tick 1999. `values` are joined with one space.

Rows of one tick, in this order:

| Event | When | Values |
| --- | --- | --- |
| `tick` | every tick | ran (`1acb` result, 0/1), busy (`0766` result, 0/1), random calls during this tick |
| `order` | tick 0, and when the node list order changed | one `ttm:tag` per node, in list order |
| `section` | tick 0 for every section, then for each section whose values changed | index, state (whole word, bit 8 included), counter (signed), resume (byte offset from the bytecode start, or `-1`) |
| `node` | tick 0 for every node, then for each node whose values changed, in list order | ttm, tag, mode, page, next page, page run (`[5]`), self-goto (0/1), ran flag (0/1), play count, plays left (signed), section state copy, delay (signed), due time, end time (both unsigned 32-bit) |

Pages, `[3]`, and `[5]` are signed (`-1` = none). Run setup as in chunk 5's TTM trace: island offsets `46e4 = 7`, `46e2 = 5`, fill on, `2641 = 4`, `287a = 0`, `1ebf = 0`, color mode 2, screen 640 × 480. The random source `1018:1e60` returns `(call * 25173 + 13849) & 0xffff` for the zero-based call count since the run's load; ADS random picks and TTM `0x2022` share it.

## Shared pieces

Made by earlier chunks (exist now):

- TypeScript: `src/types.ts` (`SCREEN_W = 640`, `SCREEN_H = 480`, `Palette`), `src/decode/ads-loader.ts` (`decodeAds(payload): AdsResource { subResources: { slot; name }[]; bytecode: Uint8Array; sections: { tag; offset }[]; tags }`, `offset` = byte offset just after the section's tag word), `src/decode/ads-bytecode.ts` (`adsArgCount(opcode)`, `indexAdsSections`), `src/decode/ttm-loader.ts` (`decodeTtm(payload): TtmResource { pageCount; bytecode; pageOffsets; tags: { id; page }[] }`), `src/ttm/state.ts` (`TtmSlot { id; ttm; bitmaps; palettes; zones }`, `TtmThread`, `makeTtmSlot(id, ttm)`, `makeThread(slot)`, `loadThreadDrawState(thread, draw)`, `resetDrawClip(draw)`), `src/ttm/page-runner.ts` (`TtmEnv { device; draw; islandX; islandY; pendingPalette; mirrorNextLoad; keepDrawings }`, `makeTtmEnv(device, draw)`, `runTtmPage(env, thread, page): { ran; delay: number | null; gotoPage: number | null; purge }`, `activatePendingPalette(env, palette)`), `src/ttm/gdi-device.ts` (`new GdiDevice(display, draw, archive, { playSound, random })`), `src/testing/ttm-recorder.ts` (`RecordingDevice(draw, archive)` with `events`, `random()`; `traceRandom(call)`), `src/testing/build-chunks.ts` (`ascii`, `words`, `concat`, `chunk(tag, body, container?)`, `storedBody`), `src/testing/corpus.ts` (`hasCorpus`, `hasFixture(path)`, `readFixtureRows(path)`, `loadArchive()`), `src/gfx/palette.ts` (`makePalette()`).
- Python (`scripts/re/unicorn/`): `emulator.py` (`Emulator`, `call_far(address, stack_words=[...])` returning a register dict (`["ax"]`, `["dx"]`; `stack_words` lists cdecl args last arg first, e.g. `find(handle, path, 0)` is `stack_words=[0, path, handle]`), `replace_function`, `arg(i)`, `near_alloc`, `read`, `write`, `data_segment`), `original_loaders.py` (`new_loader_emulator(image, payloads)`, `put_string`, `read_word`, `CURRENT_ADS_SLOT = 0x2608`, `ADS_SLOTS = 0x460C`), `original_graphics.py` (`set_word`, `set_byte`, `signed`), `original_ttm.py` (`TtmTracer(image, resources, name)` with `_load`, `_set_globals`, `_new_thread`, `_install_hooks`, `_bitmap_list`, `events`, `random_calls`), `corpus.py` (`load_resources(data_dir)`).

Made in this chunk (each step's Interfaces block has the exact signatures):

- `docs/re/ads.md` (step 1 creates, steps 2 to 6 extend). Sections, in this order: `Record and slots`, `Nodes`, `Sections`, `Tick`, `Page advance`, `Script runner`, `Blocks`, `Conditions`, `Scene operations`, `Random`, `Section control`, `Story interface`, `Loading and unloading`, `Unreferenced`, `Emulated` (step 2), `Past fixes reviewed` (step 6), `Side-by-side checklist`. One claim per bullet, each starting with its address. Checklist rows: `| Original | Name | Ours | Status |`, status `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). Functions with no TypeScript counterpart write `none (reason)` and count as `match` when the finding explains why nothing is needed.
- `scripts/re/unicorn/original_ads.py`, `dump_ads.py`, `test_original_ads.py`, fixture `re/fixtures/ads/traces.tsv` (step 2).
- `src/testing/ads-build.ts`, `src/ads/state.ts`, `src/ads/script.ts` (step 3).
- `src/ads/tick.ts`, `src/testing/ads-trace.ts` (step 4).
- `src/walk/walk.ts` `WalkContext`, `startWalk`, `walkTick`; the engine switch; deletion of `src/ads/scheduler.ts` and `src/ads/opcodes.ts` (step 5).

## Open-question numbers

The last existing entry is OQ-28. New entries use these numbers so steps agree:

- OQ-29: one ADS tick per engine tick, with the tick count as the clock (step 5, chunk 7).
- OQ-30: the ADS is loaded fresh for every scene (step 5, chunk 7).
- OQ-31: ADS interpreter guards where the original reads through a null pointer (step 3, by choice).

Entries this chunk resolves: OQ-2, OQ-3, OQ-11, OQ-12, OQ-13, OQ-22 (steps 3 to 5); OQ-4 and OQ-5 (step 5, from `1018:06bf`). Entries it updates: OQ-1, OQ-25, OQ-26, OQ-28 (step 5).

## Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- `1048:0000 001b 0079 0303 040f 04fc 067f 0766 0805 0874 0894 08b4 0920 0940 0960 0993 09e3 0a33 0a86 0ad9 0b3e 0bc5 0bf4 0c30 0c8d 0cda 0db6 0e2e 0e6e 0e9b 0ec8 0ef2 0f8c 106b 118a 11db 1223 1519 1925 196e 19e7 1a4b 1aaf 1acb 1e5a`

(`1048:0044` is already `verified` from chunk 3.) Read for the interface, named but not verified here: `1018:06bf`, `1018:0c62`, `1018:0d11`, `1008:16c2` (chunk 7).

## Steps

- [x] `step-001-ads-findings.md`: every `1048` function named (including `1048:118a`), the export rebuilt, and `docs/re/ads.md` written from it.
- [x] `step-002-original-ads-trace.md`: Unicorn runs the original ADS loader and tick on every section of every ADS and writes `re/fixtures/ads/traces.tsv`.
- [x] `step-003-ads-state-and-script.md`: `src/ads/state.ts` and `src/ads/script.ts`, pinned by unit tests.
- [x] `step-004-ads-tick.md`: `src/ads/tick.ts`, pinned by unit tests and equal to the original trace on the whole corpus.
- [x] `step-005-wire-engine.md`: story, walk, and main loop switch to the port; old scheduler and its workarounds deleted; open questions updated; browser check.
- [x] `step-006-chunk-wrap-up.md`: every in-scope function `verified` or logged, past fixes reviewed, comment audit, full rebuild and test run, spec checkbox ticked.

Order: run the steps one at a time, in number order. Step 2 needs step 1's export (for `1048:118a`; the harness itself uses addresses only). Step 3 needs step 1's findings. Step 4 needs step 3 and, for its data test, step 2's fixture. Step 5 needs step 4. Step 6 needs all of them. Steps 1 to 6 all extend `docs/re/ads.md` and `docs/re/open-questions.md`.

## Leftovers Protocol

Finishing your step completely is the goal. `step-999-leftovers.md` is a
last resort for work that genuinely cannot happen in your session (a missing
credential, an upstream bug, a discovery that changes scope). It is not a
place to park work that is hard, boring, or long.

If you must defer something, append an entry to `step-999-leftovers.md` in
this directory (create the file if it doesn't exist):

### [step file] - [short title]

- **What:** the undone work, specific enough to act on without your
  session's context
- **Why deferred:** the concrete blocker
- **Where:** files and tests involved
- **Done when:** how to verify it's resolved

Write down everything you defer. If it's not done and not in leftovers,
it's lost.
