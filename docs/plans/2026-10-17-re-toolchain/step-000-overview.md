# Reverse Engineering Toolchain (Chunk 1) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable toolchain that decompiles the original `public/data/SCRANTIC.SCR`, records our naming knowledge in the repo, runs single original functions in an emulator, and seeds the first function map.

**Architecture:** Ghidra headless imports the binary into a gitignored `re/` folder, applies names from the committed `scripts/re/names.json`, and exports pseudo-C, assembly, strings, imports, and relocations as plain files under `re/out/`. A Python + Unicorn harness loads the NE segments in x86 real mode, applies relocations, stubs Windows imports, and calls one function at a time. A small Node script renders `docs/re/function-map.md` from `names.json`.

**Tech Stack:** Ghidra 12.1.4 headless (Java scripts, bundled Gson), JDK 26, Python 3.11 + `unicorn==2.1.4` in a venv, Node 24 + Vitest for the TS/JS side, pnpm.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 1).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** The decompiled `SCRANTIC.SCR` is the source of truth. Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

Chunk 1 builds tools only. It does not change engine code in `src/`.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) lives only under `re/`, which is gitignored. Never commit it. Only our own notes, scripts, and `names.json` are committed.
- Ghidra lives at `$GHIDRA_INSTALL_DIR` (`/Applications/ghidra`). Headless runner: `$GHIDRA_INSTALL_DIR/support/analyzeHeadless`.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1000:0302`) are allowed.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`.

## Binary facts (verified 2026-10-17)

- `SCRANTIC.SCR`: 295,952 bytes, 16-bit Windows 3.x NE executable, Borland C++ 1991.
- Ghidra loader: "New Executable (NE)", language `x86:LE:16:Protected Mode`, about 590 functions after auto-analysis.
- 14 NE segments. Ghidra names them `Code1`..`Code13` and `Data14`. Ghidra address of NE segment `n` (1-based) is selector `0x1000 + (n - 1) * 8`. So `Code1` = `1000:xxxx`, `Code2` = `1008:xxxx`, ..., `Data14` = `1068:xxxx`.
- Segment 14 is the auto data segment (DGROUP: globals, strings, heap, stack).
- Imported modules, 1-based: `MMSYSTEM`=1, `GDI`=2, `KERNEL`=3, `USER`=4. Import names resolve in Ghidra (e.g. `KERNEL::GETPRIVATEPROFILEINT`).
- Imports appear in Ghidra as slots in a memory block named `EXTERNAL` (`1160:xxxx`). Calls reference those slots.
- `KERNEL` ordinal 113 is `__AHSHIFT` (huge-pointer shift constant). Ordinal 114 is `__AHINCR`.
- 1346 relocation records total. Per segment 1..14: `27, 250, 89, 134, 54, 59, 205, 206, 107, 33, 49, 104, 19, 10`. Source types used: 2 (selector), 3 (far pointer), 5 (offset). Targets used: internal reference, import by ordinal. No OS fixups, no import by name. Ghidra's relocation table has exactly one entry per record, at the record's first site.
- Entry table: 5 movable entries.
- Ghidra makes almost no references from code to strings (1 of 101 defined strings). Code loads string addresses as immediates, e.g. `MOV AX,0x24a` for `JOHNCAST.PAL` at `1068:024a`. String usage must be found by matching data offsets against instruction scalar operands.
- Some strings (e.g. `ADS:RES:`) are not defined as strings by Ghidra. Strings must be found by scanning the data segment bytes.
- Headless signature parsing works with `CParserUtils.parseSignature((DataTypeManagerService) null, program, "void name(void * a)", true)`. A calling convention keyword inside the signature string fails to parse. Set it separately with `Function.setCallingConvention(...)`. Available: `__cdecl16far`, `__cdecl16near`, `__stdcall16far`, `__stdcall16near`, `__regcall`, `__thiscall`.
- `Code1` holds the Borland runtime library. Known by reading the assembly:
  - `1000:0302`: 32-bit multiply. In: `DX:AX`, `CX:BX`. Out: low 32 bits of the product in `DX:AX`. Far return.
  - `1000:033a`: far struct copy. Stack: `[BP+6]` far source pointer, `[BP+0xa]` far destination pointer. `CX` = byte count. Callee pops 8 bytes (`RETF 0x8`).
  - `1000:0488`: 32-bit shift left, `DX:AX` by `CL`.
  - `1000:04a9`: 32-bit arithmetic shift right, `DX:AX` by `CL`.
  - `1000:04c9`: 32-bit logical shift right, `DX:AX` by `CL`.
- The Ghidra decompiler native binary for macOS ARM is not shipped. It has to be built once with `buildNatives` (step 1). Without it, there is no pseudo-C.

## `names.json` schema

`scripts/re/names.json` is the committed naming knowledge. Ghidra state is rebuilt from it on every import.

```json
{
  "functions": {
    "1000:0302": {
      "name": "rtl_lxmul",
      "subsystem": "rtl",
      "status": "named",
      "note": "Borland RTL 32-bit multiply: DX:AX * CX:BX -> DX:AX (low 32 bits)",
      "signature": null,
      "callingConvention": null
    }
  }
}
```

- Key: Ghidra address, lowercase hex, `ssss:oooo`.
- `name`: `<subsystem>_<lowerCamelCase>`, regex `^[a-z]+_[A-Za-z0-9]+$`, unique.
- `subsystem`: one of `rtl`, `platform`, `resources`, `decoders`, `gfx`, `ttm`, `ads`, `story`, `walk`, `audio`.
- `status`: `named` (we know roughly what it does) or `verified` (fully read, findings written, our TS checked against it). Functions not in the file count as `unknown`.
- `note`: one line in our own words. Never paste decompiled code.
- `signature`: optional C prototype without a calling convention, e.g. `"void rtl_scopy(void * src, void * dst)"`, or `null`.
- `callingConvention`: optional, one of the Ghidra names above, or `null`.
- Entries are kept sorted by address.

## `re/out/` export layout

Produced by `scripts/re/ghidra-import.sh`:

- `re/out/functions/<ssss>_<oooo>_<name>.c`: pseudo-C for each function.
- `re/out/functions/<ssss>_<oooo>_<name>.asm`: assembly, one line per instruction: `address  hex-bytes  instruction`.
- `re/out/index.tsv`: header `address	name	size	callingConvention	signature	callers	callees`. Callers and callees are comma-separated entry addresses.
- `re/out/strings.tsv`: header `address	text	scalarHits`. One row per printable run of 4+ bytes in non-executable blocks. `scalarHits` is a comma-separated list of `instructionAddress@functionEntry` whose scalar operand equals the string's offset.
- `re/out/imports.tsv`: header `slot	import	callers`. One row per `EXTERNAL` slot with references. `import` like `KERNEL::GETPRIVATEPROFILEINT`.
- `re/out/relocations.tsv`: header `address	type	values`. One row per Ghidra relocation.

## Steps

- [x] `step-001-ghidra-import-export.md`: decompiler built, `re/` ignored, `names.json` seeded, headless import + apply names + export working, export test passing.
- [x] `step-002-function-map-docs.md`: `names.json` validator and `docs/re/function-map.md` renderer with tests, `docs/re/README.md`, `docs/re/open-questions.md` seeded with known workarounds.
- [x] `step-003-unicorn-harness.md`: venv with Unicorn, NE loader with relocations checked against Ghidra, emulator that calls original functions, tests on two runtime library functions.
- [ ] `step-004-seed-function-map.md`: functions behind the anchor strings and key imports named in `names.json`, map regenerated.

Order: step 1 first. Steps 2 and 3 depend only on step 1 and can run in either order. Step 4 needs 1 and 2.

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
