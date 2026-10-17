# Reverse Engineering SCRANTIC.SCR

We decompile the original `SCRANTIC.SCR` (16-bit Windows 3.x NE, Borland C++ 1991) and use it to validate and fix the engine.

## Trust order

1. Decompiled `SCRANTIC.SCR` logic and byte-level facts from the data files.
2. Findings in this folder, each tied to an address.
3. Everything else: code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, other ports. **Guidance only. May be wrong.**

When code or comments contradict level 1, fix the code and comments.

## Rebuild the decompile

Needs `public/data/SCRANTIC.SCR` and `$GHIDRA_INSTALL_DIR` (Ghidra 12.1.4, decompiler built with `buildNatives`).

    scripts/re/ghidra-import.sh

Output goes to `re/` (gitignored). Never commit anything under `re/`. It is derived from a copyrighted binary.

| File | Contents |
| --- | --- |
| `re/out/functions/<ssss>_<oooo>_<name>.c` / `.asm` | Pseudo-C and assembly per function |
| `re/out/index.tsv` | Every function: address, name, size, calling convention, signature, callers, callees |
| `re/out/strings.tsv` | Printable runs in the data segment, with instructions whose operand equals the string offset |
| `re/out/imports.tsv` | Windows imports and the functions that call them |
| `re/out/relocations.tsv` | NE relocation records |

Ghidra makes almost no string references in this binary. Use `strings.tsv` `scalarHits` to find who uses a string.

## Addresses

`ssss:oooo` in lowercase hex, as Ghidra prints them. NE segment `n` (1-based) is selector `0x1000 + (n - 1) * 8`: `Code1` = `1000`, `Code2` = `1008`, ..., `Data14` = `1068` (auto data segment).

## Naming

Names live in `scripts/re/names.json`. Ghidra state is rebuilt from it on every import, so nothing lives only in Ghidra. After editing, run:

    node scripts/re/function-map.mjs
    scripts/re/ghidra-import.sh

Rules: `<subsystem>_<lowerCamelCase>`. Subsystems: `rtl`, `platform`, `resources`, `decoders`, `gfx`, `ttm`, `ads`, `story`, `walk`, `audio`. Notes are one line in our words. Never paste decompiled code into committed files.

Status: `named` = we know roughly what it does. `verified` = fully read, findings written, our TS checked against it. Not in `names.json` = unknown.

## Findings and tests

- `function-map.md`: generated, do not edit.
- `<subsystem>.md`: findings per subsystem. One claim per address. Includes the side-by-side checklist: original function ↔ our `file:line`, status `match` / `fixed` / `open`.
- `open-questions.md`: unresolved behavior and workarounds kept without a root cause.

Tests that pin original behavior cite the address: `// SCRANTIC 1008:04a2`.

## Emulating single functions

`scripts/re/unicorn/` runs one original function in Unicorn (x86 real mode) with stubbed Windows imports. Setup and usage are in `scripts/re/unicorn/README.md`.
