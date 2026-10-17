> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, requirements, or wording — needs explicit user approval
> first. Once the described work is implemented, treat this document as possibly
> out of date: the code, tests, and non-planning docs are the source of truth,
> not this file.

# Reverse Engineering SCRANTIC.SCR: Validation Design

## Goal

Raise the engine's accuracy by decompiling the original `public/data/SCRANTIC.SCR` ourselves. Use it to validate and fix the parsers, interpreters, scheduler, story logic, and main loop. Fill gaps and remove workarounds.

## Context

- `SCRANTIC.SCR` is a 16-bit Windows 3.x NE executable (295,952 bytes), built with Borland C++ 1991. Imports: KERNEL, MMSYSTEM, SCRNSAVE.
- REA cannot open NE files. Ghidra can (built-in NE loader). Ghidra is installed at `$GHIDRA_INSTALL_DIR` (`$GHIDRA_INSTALL_DIR/support/analyzeHeadless`). JDK 26 is present.
- The current engine (`src/`, ~4k lines) is a port of `~/dev/jc_reborn`, refined by comparing it with other community ports.
- `public/data/*` is gitignored.

## Source of truth

**The code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only.** They come from earlier manual reverse engineering and may be wrong. Read them as hints, never as facts.

Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else (guidance only).

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

## Decisions

- **Static analysis only.** No full-program emulator. Exception: single pure functions run in Unicorn (see Validation).
- **Raw decompiled output stays local.** It is derived from a copyrighted binary. Only our own notes and scripts are committed.
- **The original wins over workarounds.** If the decompile shows the original never does something (e.g. the 8000-tick watchdog, the thread leak sweeps, force-stopping orphan TTM threads after ADS END), find the real root cause, fix it the original's way, then delete the workaround. If no root cause is found yet, the workaround stays and is logged in `docs/re/open-questions.md`.
- **Structure: bottom-up vertical slices.** One chunk per subsystem, in dependency order. Each chunk ships on its own.

## Layout

| Path | Committed | Contents |
| --- | --- | --- |
| `re/` | No (gitignored) | Ghidra project, raw pseudo-C and assembly exports (`re/out/`, one file per function), Unicorn scratch |
| `scripts/re/ghidra-import.sh` | Yes | Runs `analyzeHeadless`: imports the NE file, analyzes, applies `names.json` |
| `scripts/re/ExportFunctions.java` (or `.py`) | Yes | Ghidra script: dumps pseudo-C and assembly for each function into `re/out/` |
| `scripts/re/names.json` | Yes | `segment:offset` → name, signature, one-line note. Re-running the import rebuilds the Ghidra project with no data living only in Ghidra |
| `scripts/re/unicorn/` | Yes | Python harness that runs one function from the binary with stubbed Windows calls |
| `docs/re/function-map.md` | Yes | Address, name, subsystem, status (`unknown`, `named`, `verified`) |
| `docs/re/<subsystem>.md` | Yes | Findings per chunk, written in our words, each with its source address. Includes the side-by-side review checklist |
| `docs/re/open-questions.md` | Yes | Unresolved behavior and every workaround kept without a root cause |

## Validation

Three layers, plus Unicorn for pure functions.

1. **Behavior-pinning tests (every chunk).** Each rule taken from the decompile becomes a Vitest test that cites its address (e.g. `// SCRANTIC 1008:04A2`). A test fails if our code breaks the rule.
2. **Whole-corpus tests on real data.** Files: `src/**/*.data.test.ts`. They skip automatically when `public/data/` files are missing.
   - Every resource in `RESOURCE.001` decompresses to the exact size stated in its header.
   - Every BMP, SCR, and PAL decodes with no leftover or missing bytes.
   - Every TTM and ADS script parses from start to end with no unknown opcodes and no bad arg counts.
   - An opcode coverage table lists every opcode the data uses next to how our engine handles it. Unhandled opcodes are gaps to fill.
   - Snapshot hashes of decoded output, so a later refactor can't change pixels without us noticing.
3. **Side-by-side review for each function.** A checklist in `docs/re/<subsystem>.md`: original function (address, name) ↔ our function (`file:line`), status `match` / `fixed` / `open`. This covers logic that byte tests can't reach: the loop, scheduler, story.
4. **Unicorn function emulation (chunks 2 and 3, maybe parts of 5).** Load the NE segments into Unicorn (`pip install unicorn`). Run a pure function (decompressors, resource/bytecode parsers) with stubbed Win16 calls. Feed it the same input as our TS function and compare outputs byte for byte, over the full data corpus where practical. Run with `python3 -I`.

## Per-chunk cycle

1. Find the functions in Ghidra. Start from string xrefs (e.g. `ADS:RES:` → ADS loader, `RESOURCE.MAP` → archive code, `JOHNCAST.PAL`, `NIGHT.SCR`, `HOLIDAY.BMP`, INI keys → story/settings). Add names to `names.json`.
2. Export pseudo-C and read it next to our TS.
3. Write findings in `docs/re/<subsystem>.md`, one claim per address.
4. Write tests that pin those findings. They are expected to fail against current code wherever the code is wrong.
5. Fix the code. Rewrite or delete comments that turned out wrong or unbacked.
6. Remove workarounds made unneeded by the findings, or log them in `open-questions.md`.
7. Fix lint, run the full test suite, smoke-test with `pnpm dev` and `debug.html`.

**Chunk done when:**

- Every function in scope is `verified` in `function-map.md` or listed in `open-questions.md`.
- Its tests pass, including corpus tests when data is present.
- No comment in its files makes a claim the findings don't back.

## Chunks

Each chunk gets its own implementation plan before work starts.

- [x] **1. Toolchain.** Install Unicorn. Import script, export script, `names.json`, `re/` gitignore entry, Unicorn harness skeleton, initial function map from strings and imports. Blocks everything.
- [x] **2. Resources.** `RESOURCE.MAP` / `RESOURCE.001` parsing, RLE and LZW decompression (`src/io/`, `src/resource/`). Validated with Unicorn and corpus tests.
- [x] **3. Decoders.** PAL, SCR, BMP, TTM loader, ADS loader, sub-chunk tags such as `BMP:INF:`, `SCR:DIM:`, `ADS:RES:` (`src/decode/`). Validated with Unicorn and corpus tests.
- [ ] **4. Graphics.** Primitives, sprites, flipped sprites, zones, clipping, palette, fade, compositing (`src/gfx/`).
- [ ] **5. TTM interpreter.** Every opcode, timers, slots, tags (`src/ttm/`). Needs 3 and 4.
- [ ] **6. ADS scheduler.** Threads, timers, conditions, random choices, END handling (`src/ads/`). Needs 5.
- [ ] **7. Story and main loop.** Scene choice, day/night, holidays, INI-driven behavior, tick timing, island layout (`src/story/`, `src/engine/`, `src/island/`). Watchdog and leak-sweep workarounds are judged here. Needs 6.
- [ ] **8. Walk.** Walking and pathfinding data and logic (`src/walk/`). Needs 7.

## Out of scope

CRT shader, UI controls, debug page, sound playback quality. None of these exist in the original.

## Risks

- Borland 16-bit code uses far pointers and segment arithmetic. Pseudo-C will be noisy, and some functions need the assembly read by hand.
- Win16 API names may not resolve. Fall back to labeling by ordinal from the NE import table.
- Unicorn stubs get fiddly for functions that allocate memory or do file I/O. Limit Unicorn to pure or nearly pure functions. Anything else falls back to side-by-side review.
- Timing and random-number behavior can only be checked by reading code. Record exact formulas (tick length, RNG algorithm and seeding) in findings so tests can pin them.
