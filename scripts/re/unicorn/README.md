# Unicorn Harness

Runs one function from the original `SCRANTIC.SCR` in Unicorn, so we can compare its output with our TypeScript port on the same input.

## Setup

    python3 -m venv re/.venv
    re/.venv/bin/pip install -r scripts/re/unicorn/requirements.txt

## Tests

    re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v

They skip without `public/data/SCRANTIC.SCR`. The relocation cross-check also needs `re/out/relocations.tsv` from `scripts/re/ghidra-import.sh`.

## Memory model

x86 real mode. Each NE segment gets its own paragraph: code segments packed from `0x0100`, then the auto data segment with a full 64 KB (`DS = SS = ES`, `SP = 0xFFFE` at call time), then a 4 KB stub segment, then a bump heap up to 1 MB (`emu.alloc`). `__AHSHIFT` and `__AHINCR` resolve to `12` and `0x1000`, so huge pointers walk 64 KB per segment step.

## Calling a function

    emu = Emulator(NeImage.load("public/data/SCRANTIC.SCR"))
    regs = emu.call_far("1000:0302", regs={"ax": 2, "dx": 0, "bx": 3, "cx": 0})

`stack_words` are in push order. For Pascal functions (callee pops, args pushed left to right) pass them left to right. For cdecl (caller pops, args pushed right to left) pass them reversed. Far pointers are two words: push the segment, then the offset.

## Windows imports

Every import is a far pointer into the stub segment. Calling one with no stub raises `UnstubbedImport`, which names the module and ordinal. Add a stub with the number of argument bytes the API pops:

    emu.add_stub("KERNEL", 18, lambda emu: {"ax": 0, "dx": segment}, arg_bytes=2)

Only stub what a test needs. Functions that need many stubs belong in side-by-side review, not here.

## Replacing internal functions

    emu.replace_function("1018:14e9", lambda emu: {"ax": next_byte()})

Patches the function entry with a far jump to a stub slot, so the handler runs instead. `emu.arg(i)` reads argument `i` of a far cdecl function (`[BP+6]` is argument 0). Caller-pops functions keep `arg_bytes=0`. `emu.near_alloc(size)` returns zeroed DS offsets above the data segment's static data.

## Original decompressor

    re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py --edge-cases

The first runs `1028:0615` / `1028:0a0d` / `1028:0875` on every compressed chunk in `RESOURCE.001` and writes the output to `re/fixtures/decompressed/` (gitignored), with `index.tsv` listing resource, chunk path, body offset, method, header size, bytes produced, and file. The second prints the edge-case table kept in `docs/re/resources.md`. The file layer (`1018:1287`, `1018:14e9`, `1018:1398`, `1018:1475`) and allocators (`1038:06a8`, `1038:063b`, `1030:199a`, `1030:1b63`) are replaced by Python handlers in `original_decompress.py`.

## Original loaders

    re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py chunks

Runs the original chunk lookup and loaders on every resource and writes fixtures to `re/fixtures/loaders/` (gitignored). `original_loaders.py` replaces the resource file layer (`1018:1019`, `1018:1204`, `1018:1287`, `1018:1398`, `1018:1475`, `1018:14e9`) with handlers that serve resource payloads by name, plus the allocators. Each loader's drawing or bitmap call is replaced by a handler that captures what the loader hands it.

## Original graphics

    re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py brushes masks

Runs original graphics code that needs no drawing (brush and mask builders, row mirror, and later the dirty-rect lists and wipe geometry) and writes fixtures to `re/fixtures/graphics/` (gitignored). `original_graphics.py` stubs the few GDI and KERNEL imports involved with handlers that capture their arguments. Inside a stub, `pascal_args(emu, n)` returns the import's arguments in declared order.

## Original TTM page runner

    re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py

Loads each TTM script with the original loader, resets one thread node with `1048:0b3e`, and runs every page twice through `1050:074a` (first run, then replay with the thread's ran flag set). Drawing, copying, dirty-rect, zone, loading, sound, and random calls are replaced by handlers that write one trace row each (`original_ttm.py`); everything else runs as original code. Writes `re/fixtures/ttm/traces.tsv` (gitignored). The row format is documented in `docs/plans/2026-10-17-re-ttm/step-000-overview.md`, `Trace format`, and in `docs/re/ttm.md`, `Emulated`.

## Original ADS tick

    re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py

Loads each ADS script with the original loader (`1048:0079`) and, for every section, starts it with `1048:0874` and runs ticks (`1048:04fc`, `1048:1acb`, `1048:0766`) with the clock set before each, until the section is no longer busy or the tick limit. The page runner is the original one with the TTM recorders of `original_ttm.py` (`AdsTracer` extends `TtmTracer`). Writes `re/fixtures/ads/traces.tsv` (gitignored), which `src/ads/tick.data.test.ts` compares with the TypeScript port. The row format is documented in `docs/plans/2026-10-18-re-ads/step-000-overview.md`, `Trace format`, and in `docs/re/ads.md`, `Emulated`. `test_original_ads.py` pins the harness on a synthetic ADS.

## Original story sequences

    re/.venv/bin/python -I scripts/re/unicorn/dump_story.py

Runs the original random generator (`1018:1e60`, `1018:1eb6`, `1018:1ef5`) and the sequence builder (`1018:0540`) for 16 cases of 30 sequences each, with the wall clock, start time, and day counters set per case. Drawing, the wipe, the ADS unload, and the debug log are replaced by handlers that do nothing; the DOS date and time calls return the case's wall clock. Writes `re/fixtures/story/` (gitignored): `sequences.tsv`, `random.tsv`, and the raw scene and random tables. `src/story/sequence.data.test.ts` and `src/story/random.data.test.ts` compare them with the TypeScript port. Formats: `docs/plans/2026-10-18-re-story/step-000-overview.md`, `Trace formats`, and `docs/re/story.md`, `Emulated`.

## Original island

    re/.venv/bin/python -I scripts/re/unicorn/dump_island.py

Runs the original island code (`1010:0136`, then 60 steps of `1008:16c2` ticks, `1010:040e(0)`, and `1010:1e50(0)`) for 24 cases of island flags, settings, holiday, slot, and day count, with the original random generator. Loading, drawing, copying, and dirty-list calls are replaced by recorders (`original_island.py`, `IslandTracer` extends `TtmTracer`); `1060:04b2` answers 1 on every third call. Writes `re/fixtures/island/traces.tsv` (gitignored), which `src/island/island.data.test.ts` compares with the TypeScript port. Format: `docs/plans/2026-10-18-re-story/step-000-overview.md`, `Trace formats`, and `docs/re/island.md`, `Emulated`.

## Original walk

    re/.venv/bin/python -I scripts/re/unicorn/dump_walk.py

Runs the original walk step (`1018:0094`) with the original route choice, turns, and random generator for 36 cases (every start and target spot pair), each with six legs toward targets set through `1018:0b46`, idle stretches (`1018:0074`), and Johnny moved between legs as an ADS entry would. The island is drawn first with the original code so the island offset and the palm trunk redraw (`1010:1551`) are real. Drawing and dirty-list calls use the recorders of `original_island.py` (`WalkTracer` extends `IslandTracer`). A code hook at `1018:011d` stops a case with a `bad` row when the walk picks a pair outside Johnny's group (the original reads on into garbage from there). Writes `re/fixtures/walk/` (gitignored): `walk-data.bin` (the walk tables, `1068:02e1`..`165f`) and `traces.tsv`, which `src/walk/walk-tables.data.test.ts` and `src/walk/walk.data.test.ts` compare with the TypeScript port. Format: `docs/plans/2026-10-18-re-walk/step-000-overview.md`, `Trace format`, and `docs/re/walk.md`, `Emulated`.
