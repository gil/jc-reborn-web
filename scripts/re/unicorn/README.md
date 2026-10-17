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
