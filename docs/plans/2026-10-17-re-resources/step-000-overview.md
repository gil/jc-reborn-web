# Reverse Engineering Resources (Chunk 2) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check our `RESOURCE.MAP` / `RESOURCE.001` parsing and our RLE and LZW decompression against the original `SCRANTIC.SCR`, byte for byte, and fix every difference.

**Architecture:** The Unicorn harness from chunk 1 runs the original decompressor (`1028:0615` open, `1028:0a0d` read, `1028:0875` close) on every compressed chunk of the real data, with the original's file layer and allocators replaced by small Python handlers. The output goes to gitignored fixtures under `re/fixtures/`. Vitest data tests compare our TypeScript output against those fixtures and against committed snapshot hashes. Findings are written in `docs/re/resources.md`, one claim per address, and pinned by unit tests that cite the address.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 2).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunk 1 built the toolchain. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. They explain addresses, `names.json`, `re/out/`, and the emulator.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files (fixtures, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Only our own notes, scripts, tests, snapshot hashes, and `names.json` are committed.
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1028:0615`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or `re/fixtures/`) are missing.
- The original wins over workarounds. A workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.

## Binary facts (verified 2026-10-17)

Address format `ssss:oooo`, Ghidra selectors: NE segment `n` is `0x1000 + (n - 1) * 8`. `1068` is the auto data segment (DS). Memory model is Borland medium: far code, near data pointers (a data pointer argument is one word, an offset into DS). Far cdecl functions: first argument at `[BP+6]`, caller pops.

### Compressed stream API (segment `1028`)

Loaders (`1030:124a` BMP, `1030:16d8` SCR, `1048:0079` ADS, `1050:0177` probably TTM) all use the same three calls:

- `1028:0615(method, fileHandle, modeString, lengthLo, lengthHi)`: opens a stream on an open file positioned at a chunk body. Returns a stream id (0..99) or `0xFFFF`. `modeString` is a near pointer; read mode is any string containing `r`. `1068:2620` holds the string `"r"`, which `ads_loadAds` passes. In read mode `method` is ignored: the method byte and a 4-byte uncompressed size are read from the file. `length` is the chunk's own size field, as returned by `1038:0517`.
- `1028:0a0d(stream, dstOffset, dstSegment, count)`: reads up to `count` decompressed bytes to a far buffer. Returns the number of bytes produced.
- `1028:0875(stream)`: closes the stream.
- `1028:076c`: same as `1028:0615` but reads from a far memory pointer. No callers (dead code).

Method table at `1068:1dc2`, 14 bytes per method, methods 0..2 (method 3 and up fail to open). Word fields, values read from the data segment:

| Method | `+0` read buffer size | `+2` read state size | `+4` write state size | `+6` read fn | `+8` write flush fn | `+a` write init fn | `+c` read init fn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | `0x80` | 0 | 0 | 0 | `1028:0072` | 0 | 0 |
| 1 (RLE) | `0x80` | 0 | 0 | `1028:0024` | `1028:1698` | 0 | 0 |
| 2 (LZW) | `0x80` | `0x3ab3` | `0x7566` | `1028:0e04` | `1028:1233` | `1028:11be` | `1028:0d44` |

Field meanings are our first reading of `1028:0547`, `1028:09ca`, `1028:0875`, `1028:0615`. Step 2 confirms them. `1028:1698` and `1028:11be` are not function starts in Ghidra's analysis.

The stream code calls these helpers (all far cdecl):

| Address | Role | Arguments |
| --- | --- | --- |
| `1018:1287` | fread-like read from a (virtual) file | `buf` (near), `size`, `count`, `handle`; returns items read |
| `1018:14e9` | getc-like read | `handle`; returns byte or `0xFFFF` at end |
| `1018:1398` | fseek-like | `handle`, `offsetLo`, `offsetHi`, `whence` (0 start, 1 current, 2 end) |
| `1018:1475` | ftell-like | `handle`; returns `DX:AX` |
| `1038:06a8` | near calloc | `count`, `size`; returns near pointer in `AX` |
| `1030:199a` | far alloc | `sizeLo`, `sizeHi`, `?`, `flags`; returns `DX:AX` |
| `1030:1b63` | far free | `offset`, `segment` |

### RESOURCE.MAP and RESOURCE.001 (checked against the real files)

- `RESOURCE.MAP` (1461 bytes): 4 bytes hash positions `[0, 1, 5, 7]`, u16 archive count (1), then per archive: 13-byte name (`RESOURCE.001`), u16 entry count (180), then 180 entries of `u32 nameHash, u32 offset`. Ends exactly after the last entry.
- The first u32 of an entry is **a hash of the resource name, not a length**. Our `src/resource/types.ts` calls it `length`. All 180 hashes match the hash computed by `1018:195a`. All 180 are distinct. Entries are sorted by offset, not by hash.
- Hash (`1018:195a`): uppercase `a`..`z` in place; walk the string keeping a 16-bit sum and 16-bit xor of the signed bytes; at `\` or `:` reset both to 0 and restart the name after it. Copy up to 13 bytes of the name into a zeroed buffer. `h = 0; for each of the 4 header positions p: h = (h << 8) + signedByte(name[p])` (32-bit). Then `h += signExtend16(low16(sum * xor))`. Examples: `JOHNWALK.BMP` = `0x4a4f93ac`, `JOHNCAST.PAL` = `0x4a4ece7d`, `ACTIVITY.ADS` = `0x4142dce8`, `OCEAN00.SCR` = `0x4f43a846`.
- `RESOURCE.001` (1,175,645 bytes): each resource is a 13-byte name, a u32 payload size, then the payload. Resources tile the file with no gaps; the first is at offset 0. 180 resources: 117 `.BMP`, 41 `.TTM`, 10 `.SCR`, 10 `.ADS`, 1 `.PAL`, 1 `.VIN` (`FILES.VIN`, not chunked).
- Payloads of `.ADS/.BMP/.PAL/.SCR/.TTM` are a tree of chunks: 4-byte tag, u32 size; bit 31 of the size marks a container whose body is more chunks. The tree consumes every payload exactly.
- Compressed chunks (body = u8 method, u32 uncompressed size, data): `BMP:BIN:` (117), `BMP:VGA:` (2), `SCR:BIN:` (10), `ADS:SCR:` (10), `TT3:` (41). 180 in total. `TT3:` uses method 1; all others use method 2. Largest uncompressed size is 153,600 bytes. `PAL:VGA:` is not compressed.

### Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- Stream and codecs: every function in `1028:0000`..`1028:1797` (Ghidra found `0024 0072 00b8 0125 0185 022e 02b4 0331 0384 03d0 0458 0478 048e 04f8 0547 0615 076c 0875 0951 09ca 0a0d 0a4b 0b0a 0b36 0c92 0d44 0e04 0fc1 10cb 1233 13cf 155d 157c 1654`). The compress (write) side may be logged as one open question instead of verified, because the engine never compresses.
- Map, archive, and file layer: `1018:1008`..`1018:1d70` except `1018:1da8` (already named, `platform`): `1008 1019 1204 1287 1398 1475 14cc 14e9 15d2 1637 16b7 1720 1771 18d2 1947 195a 1a42 1bc3 1caf 1cfc`.
- Out of scope (chunk 3): the chunk tag reader in `1038:0000`..`1038:0584` (`1038:0215` finds a tag path, `1038:0517` returns the current chunk size) and the `1028:17c8`..`1028:1b0d` thunks.

## Findings format

`docs/re/resources.md` is created in step 1 and extended by every step. Sections, in this order: `Compressed stream`, `Emulated edge cases`, `Method table`, `RLE`, `LZW`, `Map and archive`, `Name hash`, `File layer`, `Side-by-side checklist`. One claim per bullet, each starting with its address:

```markdown
- `1028:0024`: a control byte with bit 7 clear copies the next `control & 0x7f` bytes.
```

Side-by-side checklist rows:

```markdown
| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1028:0024` | `resources_rleRead` | `src/resource/uncompress.ts:12` | match |
```

Status is `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). Functions with no TypeScript counterpart write `none (reason)` in the Ours column and count as `match` when the finding explains why nothing is needed.

## Steps

- [x] `step-001-unicorn-original-decompressor.md`: emulator can replace internal functions; the original decompressor runs on handmade edge cases and on all 180 corpus chunks; fixtures in `re/fixtures/decompressed/`.
- [x] `step-002-decompression-findings-and-fix.md`: RLE, LZW, and stream findings written and pinned by tests; `src/resource/uncompress.ts` matches the original on every corpus chunk; decoders share one chunk unpacker.
- [x] `step-003-resource-map-and-archive.md`: map, name hash, archive, and file layer findings written and pinned; `src/resource/` map types and parser fixed; corpus tests for map and archive.
- [x] `step-004-chunk-wrap-up.md`: every in-scope function `verified` or logged, comment audit of `src/io/` and `src/resource/`, full test run, smoke test, spec checkbox ticked.

Order: strictly 1, 2, 3, 4. Step 2 needs step 1's fixtures and edge-case table. Step 3 uses the corpus test helper made in step 2. Step 4 needs all of them.

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
