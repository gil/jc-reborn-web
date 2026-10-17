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
