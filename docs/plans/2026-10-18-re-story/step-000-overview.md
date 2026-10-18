# Reverse Engineering the Story and Main Loop (Chunk 7) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every story, island, timing, and settings function of the original against our engine, replace `src/story/` and `src/island/` with literal ports of segments `1018` and `1010`, run the engine at the original's step and clock rates, and delete the story workarounds the original does not need (the 8000-tick watchdog, the picker fallback, the chained phase transitions).

**Architecture:** The original has no story "phases". A Windows timer fires every 50 ms and runs one story step (`1018:06bf`); a separate timer callback adds 1 to the clock `1068:2e70` every 16 ms and counts down a few timers (`1008:16c2`). When the scene queue is used up, the step builds a new *sequence* (`1018:0540`): a wipe, the time-of-day slot, the holiday, the day counters, a queue of entries picked by weight from an 80-entry scene table (`1068:1756`) within a 300-unit budget, and a fresh island drawing (`1010:0136`). Each step then animates the island (`1010:040e`), walks Johnny to the current entry's start spot or plays the entry (an ADS tag, or an idle wait), redraws the holiday sprite, and runs the dirty-rect restore pass. The port lives in `src/story/` (scene table, random generator, calendar, sequence builder, step), `src/island/` (island drawing through a small device interface), and `src/engine/` (clock and timers). Two Unicorn harnesses run the original sequence builder and island code with the original random generator, and data tests compare their traces with ours.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 at `$GHIDRA_INSTALL_DIR` (`/Applications/ghidra`), exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 7).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunks 1 to 6 built the toolchain and checked the archive, decompression, decoders, graphics, the TTM page runner, and the ADS scheduler. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. `docs/re/ads.md` is the model for the findings files this chunk writes (`docs/re/story.md`, `docs/re/island.md`).

The current `src/story/story.ts` and `src/story/story-data.ts` are jc_reborn's design: a phase machine (`splash`, `advance`, `walking`, `playing`, `fading`), a scene list with jc_reborn's flags, a day counter kept in `localStorage`, `Math.random` everywhere, a 20 ms tick for everything, and an 8000-tick watchdog. `src/island/island.ts` draws a jc_reborn island (no moving clouds, no ocean waves, different positions and holiday sprites). None of this matches the original. This chunk replaces those files; it does not patch them.

## Decisions made with the user (2026-10-18)

- **Tables from the binary are committed as TypeScript constants**, like `src/walk/walk-data.ts` already does: the scene table (`1068:1756`), the random generator's start table (`1068:1ce4`), the ADS file table (`1068:166e`), the ocean wave frame tables (`1068:0268`). A data test checks each byte for byte against `SCRANTIC.SCR` when it is present.
- **Intro:** the original shows `INTRO.SCR` only until the first story step (about 50 ms). We hold it for 2 s before the first step. This is a logged deviation (OQ-32).
- **Wipe speed (OQ-21):** the original draws a wipe as fast as the machine allows. We keep the current pacing: 16 story steps per wipe. Logged as a deliberate choice.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files at runtime (fixtures, traces, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Committed: our own notes, scripts, tests, snapshots, `names.json`, `jump-tables.json`, and the TypeScript table constants the user approved (see Decisions).
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves. The unittest runner (`-m unittest discover -s scripts/re/unicorn`) puts that folder on the path for test modules.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1018:06bf`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- `scripts/re/names.json` keeps its entries under `"functions"`, sorted by address; `node scripts/re/function-map.mjs` rejects an unsorted file. Insert new entries in address order. After editing it, run `node scripts/re/function-map.mjs` (regenerates `docs/re/function-map.md`). Subsystem prefixes allowed: `rtl`, `platform`, `resources`, `decoders`, `gfx`, `ttm`, `ads`, `story`, `walk`, `audio`. Island code is `story_`.
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or the fixture they compare against) are missing.
- The original wins over workarounds. A difference or workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.
- Scope fence: walking (`1018:0000`, `1018:004d`, `1018:0074`, `1018:0094`, `1018:03ac`, `1018:03ea`, and `src/walk/`) is chunk 8. Change `src/walk/walk.ts` only as far as step 7 lists, and log every made-up connection in OQ-25 with **Resolve in:** chunk 8.
- If a finding in `docs/re/story.md` (step 1) or `docs/re/island.md` (step 4) contradicts a fact or a code block in this plan, the finding wins: follow it, and say in the commit message which fact changed.

## Binary facts (first reading, 2026-10-18)

These come from reading the export during planning. Steps 1 and 4 confirm or correct each and write the confirmed version as a finding. Address format `ssss:oooo`; NE segment `n` is selector `0x1000 + (n - 1) * 8`; `1068` is the auto data segment (DS). Far cdecl: first argument at `[BP+6]`, caller pops.

### Timing and the main loop

- `1008:0fcd` (window procedure): `WM_CREATE` loads settings (`1008:0c5c`) and calls `SetTimer(hwnd, 1, 50, 0)`. `WM_TIMER` (`0x113`), unless `1068:2d86` is set: runs the timer callbacks (`1040:089a`), calls the idle callback `1068:2d90` (= `1008:15c8`), then loops on `PeekMessage` running `1040:089a` until a message is waiting. `WM_DESTROY` saves settings (`1008:0dc8`). `WM_USER` (`0x400`) runs `1008:143c` once. Windows never queues more than one `WM_TIMER`, so a late step does not cause a burst of steps.
- `1040:076a(13)`: base tick `1068:45de = 1000 / (13 × 18) = 4` ms. `1040:07e6(1008:16c2, 4)` registers the clock callback with interval `4 × 4 = 16` ms against `GetCurrentTime`. `1040:089a` fires every slot whose time is due, catching up all missed intervals.
- `1008:16c2` (clock callback, no direct caller): `1068:2e70`/`2e72` += 1 (32-bit); then each of `1068:30d4` (walk frame delay, chunk 8), `334c` (idle-entry wait), `0288` (surf timer), `028a` (ocean-wave timer), `3f2c` (no other reference found) is decremented when non-zero.
- `1008:15c8` (idle callback): runs `1018:06bf`, then computes `1068:30bc = (1068:2e14 × 100000 / elapsed ms) / 10`. `1068:2e14` is 0 in the data segment and no instruction names it except this read, so `30bc` stays 0 (step 1 confirms). `1010:04a2` spawns ocean waves only when `30bc > 100`.
- `1008:143c` (startup, from `WM_USER`): reads `RESOURCE.MAP`, screen 640 × 480, scale modes 3, display init, loads `JOHNCAST.PAL`; draws `INTRO.SCR` (`1068:0257`) into B and copies B to A; `1040:076a(13)`; registers `1008:16c2`; seeds the random generator (`1018:1ed4`); calls `1010:0136` once (first call only loads `BACKGRND.BMP`, `MRAFT.BMP`); loads `JOHNWALK.BMP` (`1018:0000`); `1048:0000`; `1068:287a = 0`; loads sounds; sets the idle callback `1008:15c8` and the cleanup callback `1008:157b`.

### Random numbers

- `1018:1e60`: additive lagged Fibonacci over 56 words at `1068:1ce8`, read index `1068:1ce4` (start 24), write index `1068:1ce6` (start 55): `table[w] += table[r]` (16-bit), both indices + 1 mod 56, returns the new `table[w]` (`w` before the increment). One generator for everything: story, island, ADS random blocks (`1048:0cda`), TTM `0x2022` (`1058:040c`).
- `1018:1ed4` (seed): calls `1018:1eb6(n)`, which discards `n` values, with `n` = low word of `time(NULL)` (`1000:082c`).
- `1018:1ef5(w1, w2, ..., 0)` (percent pick): `r = 1018:1e60()`; for `i = 1, 2, ...`: `t = (wi × 0x28f) & 0xffff`; if `t > r` (unsigned) return `i`; else `r -= t`. Returns 0 when the zero-terminated list ends.

### Settings (`SCRANTIC.INI`, section `ScreenAntics`)

`1008:0c5c` reads, with the current value as the default: `Background` → `1068:00b6` (default 1), `Clouds` → `00b8` (1), `Waves` → `00ba` (1), `Sounds` → `00bc` (1), `Password`, `NumDays` → `2d9b` (byte, 0), `Introduction` → `2d9a` (byte, 0), `CurrentYear` → `2d98`, `CurrentMonth` → `2d96`, `CurrentDay` → `2d94` (all 0), `StartTime` → `00be` (900, an HHMM number). Key strings at `1068:00e5`..`0146`. `1008:0dc8` writes them back on `WM_DESTROY`.

### Scene table (`1068:1756`, 80 entries of 17 bytes, ends with a 0 word)

Byte `+0x00` word id (200..215, a group number), `+0x02` weight, `+0x03`/`+0x04` start spot/heading, `+0x05`/`+0x06` end spot/heading, `+0x07` length (budget units), `+0x08`/`+0x09` time slots `[from, to)`, `+0x0a` day (0 = any; 1..11 = a day scene), `+0x0b` word flags, `+0x0d` word place (low 6 bits; bit `0x8000` = pending, bit `0x4000` = candidate mark, both runtime), `+0x0f` ADS id (101..111, or -1 = idle entry), `+0x10` ADS tag. Spots are 1..6 (0 = anywhere), headings 0..7. All bytes are signed. Entry 0 (id 200) is all zero and never matches.

Flags (`+0x0b`): `0x01` may open a sequence (kind 1; on the closing scene it means the sequence is that scene alone), `0x02` may fill the middle (kind 2), `0x04` may close a sequence (kind 4), `0x08` may repeat 1..6 times in a row, `0x10` hides the holiday sprite, `0x200` no low tide, `0x400` TTM x offset + `0x110`, `0x800` island mode 1 (night screen always), `0x1000` still island (no surf/raft animation, no ocean waves), `0x2000` island mode 2 (no island), `0x4000` no raft.

ADS ids (`1068:166e`, 17-byte entries: id word, 13-byte name, cached slot word): 101 `ACTIVITY.ADS`, 102 `BUILDING.ADS`, 104 `FISHING.ADS`, 105 `JOHNNY.ADS`, 106 `MARY.ADS`, 107 `MISCGAG.ADS`, 108 `STAND.ADS`, 109 `SUZY.ADS`, 110 `VISITOR.ADS`, 111 `WALKSTUF.ADS`; first entry id -2 (no name), ends at id 0.

### Sequence building

- `1018:0540` (new sequence): `1018:0673` (wipe `1020:0364(0)`, unload the ADS of every queued entry through `1018:0d11`, empty the queue `1068:30f2`, position `1068:30f0 = 0`); time slot `30b8 = (1018:0c21(hhmm) - 1018:0c21(StartTime) + 16) % 16` with `hhmm = hour × 100 + (minute >= 30 ? 30 : 0)` (`1000:020f` writes hour, minute, second, hundredths at its near pointer); holiday `30ba` from `1000:01f4` (writes day, month, year word, weekday): October > 28 → 1, December 23..25 → 2, December > 28 → 3, January 1 → 3, March 15..17 → 4, else 0; `1010:1c41(-1, -1)`; `1018:0b87`; `1018:089b(slot, 300)`; Johnny's spot `30e2` and heading `30de` = the first queued entry's start spot and heading; `30f0 = 0`; `1010:0136`.
- `1018:0c21(hhmm)` = `(hhmm / 50 + (hhmm % 100) / 30 + 14) % 16` (half-hour slots in an 8-hour cycle).
- `1018:0b87` (day counters): when today's date differs from `CurrentYear/Month/Day`: `NumDays += 1` if `NumDays < Introduction`; then if `NumDays > 11` or `NumDays < 2`: both = 1; store the date. Then, if `30ee` (new sequence) and `30ec` (the last sequence picked a day scene of the current Introduction day) and `Introduction <= NumDays`: `Introduction += 1`. Clears `30ec` and `30ee`.
- `1010:1c41(flags, place)`: `(-1, -1)` resets: place `30be = 0xffff`, low tide `30c0 = 0xffff`, mode `30b2 = 0`, still `30b0 = 0`, no raft `30ae = 0`, holiday shown `30b4 = 1`. Otherwise flags `0x200` → low tide 0, `0x4000` → no raft, `0x10` → holiday hidden, `0x1000` → still, `0x800` → mode 1, `0x2000` → mode 2; when `30be == 0xffff` and `place & 0x3f` → `30be = 0`; place `0x20` → `30be = 1`, else `0x10` → `30be = 2`; then `0x01`, `0x02`, `0x04`, `0x08` set `30be` bits `0x04`, `0x08`, `0x10`, `0x20`.
- `1018:0eb5(flags, place)` (fits the island so far): true when `30be == 0xffff`; false when the place bits clash with `30be` (eight rules over masks `0x2a`, `0x15`, `0x30`, `0x0c`).
- `1018:0d50(kind, slot, budget)` (weighted pick): kind 4 → budget 999; kind `0x80` (day scene) → 90% return 0, else `Introduction = NumDays`, budget 999. Marks every entry that matches: kind `0x80`: `day == Introduction`; other kinds: `flags & kind`, tag ≠ 0, `from <= slot < to`, day 0, `length / 2 < budget`, `1018:0eb5`. Sum of weights 0 → none; else `k = rand % sum + 1`, the first marked entry where the running weight reaches `k`.
- `1018:089b(slot, 300)` (queue): a day scene (kind `0x80`) that is neither of the last sequence's two picks (`30e6`, `30e8`) becomes `30ea` and is the closing scene if it has flag 4, else an extra; the closing scene is picked (kind 4) until it differs from `30e6` and is not a whole-sequence scene while an extra is pending; budget minus their lengths; `1010:1c41` for each; `30ec` set when either is a day scene of the current Introduction; opening: when the closing scene has no flag 1, the extra if it has flag 1 and a 50% pick, else a kind-1 pick; middle: while budget ≠ 0 and fewer than `0x12a` entries: the extra with a 5% pick, else a kind-2 pick (none → stop) repeated `1018:1ef5(10, 20, 30, 20, 10, 10)` times when it has flag 8 (redrawn while the repeats overshoot the budget); closing scene last; every queued entry marked pending.

### The story step (`1018:06bf`)

Unless `1068:334a` (no writer found): entry = queue[position]; when it is 0 (or `1068:1dbc == 2`): `30ee = 1`, `1018:0540`, re-read the entry. `1010:040e(0)`. When the entry is not pending, or `1018:0b46(start spot, start heading)` says Johnny is there:

- idle entry (ADS id -1): on its first step (pending) clear pending, idle wait `334c = rand % 240 + 180`, `1018:0074`; every step `1018:0094`; when `334c == 0`: spot/heading = end spot/heading, mark pending, position + 1.
- ADS entry: on its first step `30e4 = 1018:0c62(id)`, `1048:04fc(slot)`, `1048:0874(tag)`, clear pending, `1010:00fc(flags & 0x400)`; every step `1048:04fc(slot)`, `1048:1acb`, and when `1048:0766(tag)` is 0: spot/heading = end spot/heading, mark pending, position + 1, spot 0 → `rand % 6 + 1`, heading 0 → `rand & 7`.

Otherwise `1018:0094` (walk toward the start). Then `1010:1e50(0)`; when `30ea` is this entry: sound 25 (`1020:00ba(0x19)`), `30ea = 0`; `1060:03d3(0)`.

- `1018:0b46(spot, heading)`: stores the walk target (`30e0 = spot` unless 0, `30dc = heading` unless -1); true when (spot 0 or Johnny's spot) and (heading -1 or Johnny's heading).
- `1018:0c62(id)`: when `id` differs from `1068:334e`, unloads `334e`'s ADS (`1018:0d11`) and stores `id`; returns the cached slot or loads the file (`1048:0079`).
- `1010:00fc(left)`: TTM island offset `46e4 = islandX + 1 (+ 0x110 when left)`, `46e2 = islandY`; both 0 in mode 2.

### Island (`1010`)

- `1010:0136` (draw island): loads `HOLIDAY.BMP` once when a holiday is set; the first call loads `BACKGRND.BMP` and `MRAFT.BMP` and returns. Later calls draw into C: a color-5 filled screen (Background off or mode 2), a random `OCEAN0x.SCR` (`1068:0262`, mode 0 and slot < 12), else `NIGHT.SCR`; low tide random when unset; `1010:1b00` places the island and the offset becomes `(x - 0x121, y - 0x117)`; `1010:00fc(0)`; unless mode 2: raft (`1010:1d69(1)`), island sprite 0, low-tide sprites 1 and 2, surf reset and drawn (`1010:0e74(0)`), trees 14, 13, 12; copies C to B and marks the whole screen `(B → A, 0)`; ocean waves on (30) unless Waves is off or the island is still (`1010:0463`); clouds on (15) unless Clouds is off (`1010:0a38`); `1010:040e(1)`; `1010:1e50(1)`.
- `1010:040e(first)`: nothing in mode 2; target B, source C; ocean waves (`1010:04a2`); clouds (`1010:0b67`) only when `first`; then unless (not `first` and still): surf (`1010:0e74(0)`) and raft (`1010:1d69(0)`). So clouds are drawn once per sequence and never move.
- `1010:0e74`: three surf spots at high tide, four at low tide, each with a frame counter `0282`/`0284`/`0286` advanced every 4 clock ticks (`0288`); a spot is redrawn when the counters advanced or a presented rect overlaps it.
- `1010:1d69`, `1010:1e50`: raft (frame `NumDays - 1` clamped to 1..5) and holiday sprite, redrawn when a presented rect overlaps them.
- `1010:1551(image, x, y)`: redraws the island parts in front of a sprite, clipped to the sprite's rect: only the palm trunk for a walking Johnny (`1068:2e78 = 0`), the island, low-tide bits, surf, and trees for clouds, waves, and the raft (`2e78 = 1`).
- `1010:14bf`, `1010:1a88`, `1010:1a0d`: random placement in a range, a rect overlap test (2 = inside, 1 = touching), and three dirty rects for a drawn sprite.

## Trace formats

### Sequences (steps 2 and 3)

Step 2 writes `re/fixtures/story/sequences.tsv` from the original; step 3 builds the same rows from our port. Header: `case	build	event	values`. Each case is a fresh emulator: set the data-segment globals of the case, discard `n` random values (`1018:1eb6(n)`), then for `build = 0..29`: set the wall clock, set `30ee = 1`, call `1018:0540`, write the rows. `1018:0540` runs as original code except: `1010:0136` (draw island), `1020:0364` (wipe), `1018:0d11` (unload), and `1020:081c` (log) do nothing; `1000:020f` and `1000:01f4` write the wall clock. `values` are joined with one space.

| Event | Values |
| --- | --- |
| `queue` | scene table indices (0..79) of the queue, in order |
| `state` | slot `30b8`, holiday `30ba`, NumDays `2d9b`, Introduction `2d9a`, year `2d98`, month `2d96`, day `2d94`, place `30be`, low tide `30c0`, mode `30b2`, still `30b0`, no raft `30ae`, holiday shown `30b4`, spot `30e2`, heading `30de`, last closing `30e6`, last extra `30e8`, day scene `30ea`, day scene picked `30ec`, new sequence `30ee`, random write index `1ce6` |

Entry pointers (`30e6`, `30e8`, `30ea`) are written as table indices, `-1` for none. Byte globals are signed; `30be` and `30c0` are unsigned words.

Case `k` for `k = 0..15`:

- discard `n = [0, 1, 55, 56, 1000, 4096, 31337, 65535][k % 8]`
- NumDays `= k % 13`, Introduction `= (5 × k) % 13`
- stored date `(1992, 6, 1)` when `k` is odd, else `(0, 0, 0)` (year, month, day)
- StartTime `= [900, 0, 1230, 2330][k % 4]`
- first wall clock: date `[(1992, 10, 29), (1992, 12, 24), (1992, 12, 31), (1993, 1, 1), (1993, 3, 16), (1992, 6, 1)][k % 6]` at hour `(3 × k) % 24`, minute `(7 × k) % 60`
- build `b`: the first wall clock plus `b / 3` days (integer division) plus `97 × b` minutes, in plain calendar arithmetic (no time zones)

### Random (steps 2 and 3)

`re/fixtures/story/random.tsv`, header `kind	seed	call	value`. For each discard `n` in `0, 1, 55, 1000, 65535`: a fresh generator, discard `n`, then 300 rows `next n i value`. Then one more fresh generator with discard 0 and, for each weight list in this order, 200 calls of `1018:1ef5`: `[50]`, `[5, 10, 15]`, `[20, 30, 50]`, `[10, 20, 30, 20, 10, 10]`, `[35, 5, 5, 5]`, `[30, 50]`, `[35]`, `[30]`, rows `percent:<weights joined by ,> 0 i value` (the generator continues across lists).

### Island (steps 5 and 6)

Step 5 writes `re/fixtures/island/traces.tsv` from the original; step 6 builds the same rows from our port. Header: `case	step	event	values`. Each case is a fresh emulator: `1010:0136` once with nothing set (it only loads the bitmaps; its rows are dropped), the case's globals, the clip off with rect `(0, 0, 639, 479)`, discard `n` random values, `1010:0136` again (rows with step `-1`, then a `state` row), then for `step = 0..59`: `1 + step % 4` calls of `1008:16c2`, `1010:040e(0)`, `1010:1e50(0)`, and a `state` row. Surfaces: 0 = A, 1 = B, 2 = C. The `n`-th call of `1060:04b2` in a case (zero-based, counted from the second `1010:0136`) answers 1 when `n % 3 == 1`, else 0.

| Event | Values |
| --- | --- |
| `sheet` | name (a `1030:124a` load) |
| `screen` | target, name (`1030:16d8`) |
| `fill` | target, x, y, w, h, color (`1038:1bd8` with the fill flag on and foreground = background) |
| `sprite` | target, sheet name, index, x, y, flags, clip on (0/1), clip x1, y1, x2, y2 (`1038:0ae4`, and `1038:0ac2` as flags 0) |
| `line` | target, x1, y1, x2, y2, foreground (`1030:02ef`) |
| `copy` | source, target, x, y, w, h (`1038:06ce`) |
| `dirty` | source, target, age, x, y, w, h (`1060:007e`, kind 1) |
| `overlaps` | target, age, x, y, w, h, answer (`1060:04b2`) |
| `state` | island x `30c4`, y `30c2`, low tide `30c0`, place `30be`, raft frame `30b6`, surf `0282 0284 0286`, wind `0280` (signed), surf timer `0288`, wave timer `028a`, clouds left `2e7a 2e7c 2e7e`, waves left `2f36 2f38 2f3a 2f3c`, random write index `1ce6`, then each cloud record (`2e80`, 15 × 6 words) and each wave record (`2f40`, 30 × 6 words) as `x,y,frame,kind,period,countdown` (signed) |

Case `k` for `k = 0..23`: mode `30b2 = [0, 0, 0, 1, 2][k % 5]`; place `30be = [0xffff, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0c, 0x30][k % 10]`; low tide `30c0 = [0xffff, 0, 1][k % 3]`; still `30b0 = 1` when `k % 7 == 3`; no raft `30ae = 1` when `k % 6 == 5`; holiday shown `30b4 = 0` when `k % 4 == 2`, else 1; holiday `30ba = k % 5`; slot `30b8 = 13` when `k` is odd, else 0; Background `00b6 = 0` when `k % 8 == 7`, else 1; Clouds `00b8 = 0` when `k % 9 == 8`, else 1; Waves `00ba = 0` when `k % 10 == 9`, else 1; NumDays `2d9b = [1, 3, 9][k % 3]`; speed `30bc = 200` when `k` is even, else 0; discard `n = 997 × k`.

## Shared pieces

Made by earlier chunks (exist now):

- TypeScript: `src/types.ts` (`SCREEN_W = 640`, `SCREEN_H = 480`, `Palette`), `src/decode/ads-loader.ts` (`decodeAds`), `src/decode/bmp.ts` (`decodeBmp(payload).sprites`), `src/decode/scr.ts` (`decodeScr`), `src/ads/state.ts` (`makeAdsState(ads, archive, random: () => number): AdsState`), `src/ads/tick.ts` (`adsStartSection(state, tag)`, `adsTick(state, env, palette, now): boolean`, `adsSectionBusy(state, tag): boolean`, `adsActiveNodeCount(state)`), `src/ttm/page-runner.ts` (`TtmEnv { device; draw; islandX; islandY; pendingPalette; mirrorNextLoad; keepDrawings }`, `makeTtmEnv(device, draw)`), `src/ttm/gdi-device.ts` (`new GdiDevice(display, draw, archive, { playSound, random })`), `src/gfx/gdi/display.ts` (`Display` with `surfaces`, `window`, `dirty` (`DirtyLists`: `add(x, y, w, h, kind, source, target, age, clip)`, `overlaps(x, y, w, h, target, age): number`), `source`, `target`, `screenIsB`, `copyRect`, `blitScreen`, `restorePass(which)`; `SURFACE_A = 0`, `SURFACE_B = 1`, `SURFACE_C = 2`), `src/gfx/gdi/dirty.ts` (`COPY_RECT = 1`), `src/gfx/gdi/surface.ts` (`Surface`, `ClipRect { x1; y1; x2; y2 }` inclusive, `DrawState { foreground; background; fill; clipOn; clip }`, `makeDrawState()`, `rawIndices`), `src/gfx/gdi/sprite.ts` (`drawSprite(surface, draw, image, x, y, flags, mirroredCopy?)`, `spriteSurface`, `MIRROR = 2`), `src/gfx/gdi/primitives.ts` (`drawLine(surface, draw, x1, y1, x2, y2)`, `drawRect(surface, draw, x, y, w, h)`), `src/gfx/fade.ts` (`FadeState`, `nextFadeState()`, `fadeDone(f)`, `applyFade`, `WIPE_TICKS = 16`), `src/walk/walk.ts` (`startWalk(archive, bgSprites, fromSpot, fromHdg, toSpot, toHdg, dx, dy): WalkContext | null`, `walkTick(walk, display)`, `walkDraw`; spots 0..5), `src/testing/corpus.ts` (`hasCorpus`, `hasFixture(path)`, `readFixtureRows(path)`, `readFixtureBytes(path)`, `loadArchive()`).
- Python (`scripts/re/unicorn/`): `emulator.py` (`Emulator`, `call_far(address, stack_words=[...])` returning registers (`["ax"]`), `replace_function(address, handler)`, `arg(i)`, `near_alloc`, `read`, `write`, `data_segment`; `stack_words` for cdecl list the args last first), `ne_image.py` (`NeImage.load(path)`, `.segments`, `.auto_data_segment`), `original_loaders.py` (`new_loader_emulator(image, payloads)`, `put_string`, `c_string`, `read_word`), `original_graphics.py` (`set_word`, `set_byte`, `signed`, `DC_GLOBALS`, `DC_A`, `DC_B`, `DC_C`, `SOURCE_DC`, `TARGET_DC`, `SCREEN_WIDTH`, `SCREEN_HEIGHT`, `CLIP_ON`, `CLIP_X1`, `CLIP_Y1`, `CLIP_X2`, `CLIP_Y2`, `FOREGROUND` is in `original_ttm.py`), `original_ttm.py` (`TtmTracer._bitmap_list(name)` builds a bitmap table of records with width and height; `SURFACES`), `corpus.py` (`load_resources(data_dir)`, `walk_chunks`).

Made in this chunk (each step's Interfaces block has the exact signatures):

- `docs/re/story.md` (step 1 creates, steps 2, 3, 7, 8 extend), `docs/re/island.md` (step 4 creates, steps 5, 6, 8 extend). Sections are listed in those steps. One claim per bullet, each starting with its address. Each ends with `Side-by-side checklist`: `| Original | Name | Ours | Status |`, status `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). Functions with no TypeScript counterpart write `none (reason)` and count as `match` when the finding explains why nothing is needed.
- `scripts/re/unicorn/original_story.py`, `dump_story.py`, `test_original_story.py`, fixtures under `re/fixtures/story/` (step 2).
- `src/story/scene-table.ts`, `src/story/random.ts`, `src/story/calendar.ts`, `src/story/sequence.ts` (step 3).
- `scripts/re/unicorn/original_island.py`, `dump_island.py`, `test_original_island.py`, fixture `re/fixtures/island/traces.tsv` (step 5).
- `src/island/island.ts` (rewritten), `src/island/island-device.ts`, `src/testing/island-recorder.ts` (step 6).
- `src/story/story.ts` (rewritten), `src/story/settings.ts`, `src/engine/clock.ts` (rewritten), `src/engine/timers.ts`, `src/main.ts`; `src/story/story-data.ts` deleted (step 7).

## Open-question numbers

The last existing entry is OQ-31. New entries use these numbers so steps agree:

- OQ-32: the intro is held 2 s before the first story step (step 7, by choice).
- OQ-33: settings are saved after each new sequence, not on window destroy (step 7, by choice).
- OQ-34: story guards where the original reads through a null entry (step 3, by choice).
- OQ-35: Windows plumbing, dialogs, password, and sound loading are not modeled (step 1, by choice).
- OQ-36: the clock ticks evenly every 16 ms; on Windows 3.x `GetCurrentTime` moves in 55 ms jumps, so the original's clock callback fired in bursts (step 7, by choice).

Entries this chunk resolves: OQ-1, OQ-6, OQ-24, OQ-26, OQ-28, OQ-29, OQ-30 (steps 3, 6, 7); OQ-21 becomes a deliberate choice (step 7). Entry it updates: OQ-25 (step 7, the walk bridge).

## Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- `1000:01f4 020f 082c`
- `1008:0000 0221 033e 034f 0517 0a2d 0c5c 0dc8 0fcd 12eb 13cd 143c 157b 15c8 16c2`
- `1010:0059 00b2 00fc 0136 03ce 040e 0463 04a2 0a38 0b67 0e74 14bf 1551 1a0d 1a88 1b00 1c41 1d69 1e50`
- `1018:0540 0673 06bf 089b 0b46 0b87 0c21 0c62 0d11 0d50 0e7b 0eb5 1e60 1eb6 1ed4 1ef5`
- `1020:0000 0085 00ba 0106 013f 019c 026e 081c 082a`
- `1040:076a 079e 07e6 085a 089a`

Read for the interface, left to chunk 8: `1018:0000`, `1018:004d`, `1018:0074`, `1018:0094`, `1018:03ac`, `1018:03ea`.

## Steps

- [ ] `step-001-story-findings.md`: every in-scope function named, the export rebuilt, and `docs/re/story.md` written (story step, sequences, scene table, calendar, random, settings, timing, startup).
- [ ] `step-002-original-story-trace.md`: Unicorn runs the original random generator and sequence builder and writes `re/fixtures/story/` (traces and table dumps).
- [ ] `step-003-story-port.md`: `src/story/scene-table.ts`, `random.ts`, `calendar.ts`, `sequence.ts`, pinned by unit tests and equal to the original traces.
- [ ] `step-004-island-findings.md`: `docs/re/island.md` written from every `1010` function.
- [ ] `step-005-original-island-trace.md`: Unicorn runs the original island drawing and animation and writes `re/fixtures/island/traces.tsv`.
- [ ] `step-006-island-port.md`: `src/island/` rewritten as a port through `IslandDevice`, pinned by unit tests and equal to the original trace.
- [ ] `step-007-story-step-and-loop.md`: the story step, ADS by id, settings, the 50 ms step and 16 ms clock, the walk bridge, `src/main.ts`; old story code and its workarounds deleted; open questions updated; browser check.
- [ ] `step-008-chunk-wrap-up.md`: every in-scope function `verified` or logged, past fixes reviewed, comment audit, full rebuild and test run, spec checkbox ticked.

Order: run the steps one at a time, in number order. Step 2 needs step 1's names (addresses only, but its findings say what to trace). Step 3 needs steps 1 and 2. Step 4 needs step 1's export. Step 5 needs step 4. Step 6 needs steps 3 (`StoryRandom`, `IslandFlags`) and 5. Step 7 needs steps 3 and 6. Step 8 needs all of them.

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
