# Reverse Engineering Decoders (Chunk 3) Implementation Plan

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> **For agentic workers:** You are executing one step of this plan in a clean
> session with no prior context. Read this overview fully, then read your
> assigned step file. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check our PAL, SCR, BMP, TTM, and ADS decoders and the chunk lookup they share against the original `SCRANTIC.SCR`, and fix every difference.

**Architecture:** The Unicorn harness from chunks 1 and 2 runs the original loaders (chunk lookup, palette, screen, bitmap, TTM page index, ADS opcode sizes) on handmade inputs and on every resource of the real data. The original's file layer, allocators, and drawing calls are replaced by small Python handlers that serve resource payloads and capture what the loader produces. Output goes to gitignored fixtures under `re/fixtures/loaders/`. Vitest data tests compare our decoders against those fixtures and against committed snapshots. Findings are written in `docs/re/decoders.md`, one claim per address, and pinned by unit tests that cite the address. Every decoder moves from fixed-order parsing to path lookup, as the original does.

**Tech Stack:** TypeScript + Vitest (Node 24, pnpm), Python 3.11 + `unicorn==2.1.4` in `re/.venv`, Ghidra 12.1.4 exports in `re/out/`.

**Spec:** `docs/specs/2026-10-17-reverse-engineering-validation-design.md` (chunk 3).

## Why this exists

This project ported an earlier community reverse engineering effort. **Code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, and the other ports are guidance only. They may be wrong.** Trust order, highest first:

1. Decompiled `SCRANTIC.SCR` logic (pseudo-C, plus assembly where the pseudo-C is unclear), and byte-level facts from the data files.
2. Our findings in `docs/re/`, each tied to an address.
3. Everything else.

When code or comments contradict level 1, the code and comments get fixed. Comments that only restate old guesses are removed or rewritten from the findings.

Chunks 1 and 2 built the toolchain and checked the archive and decompression. Read `docs/re/README.md` and `scripts/re/unicorn/README.md` once before starting. They explain addresses, `names.json`, `re/out/`, and the emulator. `docs/re/resources.md` is the model for the findings file this chunk writes.

## Global Constraints

- Raw decompiled output (pseudo-C, assembly, Ghidra project) and anything derived from the data files (fixtures, `.bin` dumps) live only under `re/`, which is gitignored. Never commit them. Only our own notes, scripts, tests, snapshots, and `names.json` are committed.
- Never paste decompiled code into committed files. Findings and `names.json` notes are in our own words.
- Python that reads target files runs isolated: `re/.venv/bin/python -I ...`. With `-I`, the script's own folder is not on `sys.path`; scripts meant to run directly insert `Path(__file__).resolve().parent` themselves. The unittest runner (`-m unittest discover -s scripts/re/unicorn`) puts that folder on the path for test modules.
- Run `fnm use` once at session start. Run `export GIT_PAGER=cat` once before any git command.
- Use `pnpm`, never npm or yarn.
- Avoid compound shell commands (`&&`, `;`, pipes) where a separate call works.
- No code comments unless a competent engineer would be surprised without one. Test citations of original addresses (`// SCRANTIC 1038:0215`) are allowed and expected on every behavior-pinning test.
- Work on branch `new-decomp`. Commit after each green action group. Do not push.
- After changes: `pnpm exec tsc --noEmit` and `pnpm test` must pass. There is no other linter. Python: `re/.venv/bin/python -I -m py_compile <file>` for each changed `.py`, and the Unicorn tests must pass: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`.
- Data tests are named `*.data.test.ts` and skip themselves when `public/data/` files (or the fixture they compare against) are missing.
- The original wins over workarounds. A difference or workaround with no root cause found stays and is logged in `docs/re/open-questions.md`.
- **Stay inside `src/decode/`** (plus the few callers named in a step). The TTM interpreter (`src/ttm/`, chunk 5) and the ADS scheduler (`src/ads/`, chunk 6) keep their own bytecode framing in this chunk. Every difference found between them and the original goes to `docs/re/open-questions.md` with **Resolve in:** chunk 5 or chunk 6, so those chunks pick it up. The user asked for this explicitly for the ADS framing.

## Binary facts (first reading, 2026-10-17)

These come from a first read of the decompile during planning. Each step confirms or corrects the ones it covers and writes the confirmed version as a finding. Address format `ssss:oooo`; NE segment `n` is selector `0x1000 + (n - 1) * 8`; `1068` is the auto data segment (DS). Medium model: far code, near data pointers. Far cdecl: first argument at `[BP+6]`, caller pops; in the emulator pass `stack_words` in reverse argument order.

### Chunk reader (`1038:0000`..`1038:0584`)

- Every loader opens its resource with `1038:016b(name)` (calls `resources_openFile` with mode `1068:256e`, measures the payload by seeking to the end) and closes it with `1038:054b(handle)`. `1038:0584(x)` tells whether `x` is already an open chunk handle, so loaders accept a name or a handle.
- 4 reader records of `0x43` bytes at `1068:414e`, found by handle with `1038:0000`. Seen fields: `+0x00` handle, `+0x02` current tag path (up to 24 chars), `+0x1b` stack of u32 end positions (bit 15 of the high word marks a container), `+0x37` depth × 4, `+0x39` occurrence, `+0x3b` u32 position, `+0x3f` u32 size of the current chunk. A backup copy lives at `1068:425a`.
- `1038:0215(handle, path, occurrence)` finds a chunk by its full tag path (`"BMP:INF:"`, `"TTI:TAG:"`); the path length must be a non-zero multiple of 4. It descends into every container. Returns the body position in `DX:AX`, or `0xFFFF:0xFFFF`. All loaders pass occurrence 0. With occurrence 0 and a new path it seems to search **forward from the current position**, not from the start; at the end it restores the backup and fails.
- `1038:0517(handle)` returns only the low 16 bits of the current chunk size. Loaders pass it as the stream length. The largest leaf chunk in the data is 22,248 bytes (`BACKGRND.BMP` `BMP:BIN:`).

### Loader path strings

| Address | String | Used by |
| --- | --- | --- |
| `1068:1e4a` | `BMP:INF:` | `1030:1112` |
| `1068:1e53` | `BMP:BIN:` | `1030:124a` |
| `1068:1e5e`, `1068:1e67` | `BMP:VGA:`, `BMP:AMG:` | `1030:124a` |
| `1068:1e72`, `1068:1e7b` | `SCR:DIM:`, `SCR:BIN:` | `1030:16d8` |
| `1068:1e86`, `1068:1e8f` | `SCR:VGA:`, `SCR:AMG:` | `1030:16d8` |
| `1068:25f2` | `PAL:VGA:` | `1040:09eb` |
| `1068:25fc` | `BMP:MTX:` | `1040:0db0` |
| `1068:260e` | `ADS:RES:` | `1048:0079` |
| `1068:2617` | `ADS:SCR:` | `1048:0079` |
| `1068:27b4`, `1068:27b9` | `PAG:`, `TT3:` | `1050:0177` |

No string `TAG:`, `TTI:`, or `VER:` exists in the binary. The original never reads `VER:`, `TTI:TAG:`, or `ADS:TAG:`.

### Display mode globals

- `1068:1ebd`: color mode. Static value 0; `1038:1744` (display setup, called from `platform_initSaver`) sets it to 2. `1040:09eb` reads 16 palette colors when it is 2, else 256.
- `1068:1ebf`: nothing writes it (`rg -n "\[0x1ebf\]" re/out/functions/*.asm` shows only reads). Static 0. So the `BMP:VGA:`/`BMP:AMG:` and `SCR:VGA:`/`SCR:AMG:` branches never run.

### Palette, screen, bitmap

- `1040:09eb(name)`: takes palette slot 1..9 at `1068:45e4`, finds `PAL:VGA:`, reads 16 (mode 2) RGB triplets byte by byte, each byte mapped through the 64-byte table at `1068:25b0`: level `v` → `v * 4` for 0..62, and 63 → `0xff`. Our `src/gfx/palette.ts` uses `(v << 2) | (v >> 4)` (32 → 130, the original gives 128).
- `1030:16d8(name)`: width and height from `SCR:DIM:`, default 320 × 400 (`0x140`, `0x190` in the assembly). Decodes `SCR:BIN:` in strips of `(width / 2) << 6` bytes (64 rows) into a near buffer and hands each strip to `gfx_blitPixelRows` (`1040:0286`: buffer, segment, x, y, width, rows). The first strip is not cut to the height.
- `1030:1112`: reads the `BMP:INF:` image count, then all widths, then all heights, into 14-byte records (`+6` width, `+8` height), plus a zero-terminated list of record pointers.
- `1030:124a(name)`: total size from the function pointer `1068:1e24` → `1030:000e`: sum of `((w + 1) / 2) * h`. Decodes `BMP:BIN:` into one far buffer, then calls the pointer `1068:2574` → `1040:0000` (record list, buffer). `1040:0000` builds one 4-bit DIB per image from the palette at `1068:25ae` and advances the buffer by `(w / 2) * h`. `1040:035c` and `1040:0462` are its helpers (mask and row work, not read yet).
- `1040:0db0`: `BMP:MTX:` tile matrix loader. The data has no `BMP:MTX:` chunk.

### TTM (`1050`)

- `1050:0177(name)`: `PAG:` body is a u16 page count, default 330 (`0x14a`) when missing. `TT3:` is decompressed whole into a far buffer. A `0xd4`-byte record is appended to the TTM list (`1068:2634` head, `1068:2638` current): word `[1]` page count, `[2..3]` bytecode far pointer, `[4..5]` pointer to the last byte, `[0x66..0x67]` next record, `[0x68..0x69]` far page table of `count + 1` entries. Returns 1 or `0xFFFF`.
- `1048:0044(name, id)`: loads a TTM, stores `id` in word `[0]`, runs `1050:04d6(id)`.
- `1050:04d6(id)`: page index. Page 0 starts at offset 0; every `0x0FF0` ends a page and the next starts after it. Instruction size from the opcode's low nibble: 0..7 word args; `0xF` is a NUL-terminated string padded to even length (`1050:04a8`), except `0xAF1F`/`0xAF2F`, which take a count word and `2 * count` words; 8..14 make it return `0xFFFF`. Every `0x1111` adds a tag record via `1050:042a(page, id, tag)`: near `0x3d`-byte node in a list at `1068:263c`, words `[0]` TTM id, `[1]` tag, `[2]` page, next pointer at byte `+0x3b`. Returns 1 when all pages are found, 0 when the bytecode ends first.

### ADS (`1048`)

- `1048:0079(name)`: 10 ADS slots at `1068:460c` (far pointers to `0x472`-byte records). Reads `ADS:RES:`: u16 count, then per entry a u16 id and a NUL-terminated name read byte by byte into a 20-byte stack buffer; each entry immediately loads that TTM (`1048:0044`). Any failed TTM fails the whole ADS. Then decompresses `ADS:SCR:` whole (read count must equal the stream size). Then `1048:04fc(0)`. Returns slot + 1, or 0.
- `1048:0303(ptr)`: size of one ADS instruction. Looks the word up in a 35-entry table **in the code segment** at `1048:0383`, with handler offsets at `1048:0383 + 0x46`. Handlers add 10, 8, 6, 4, or 2 bytes (4, 3, 2, 1, 0 args). Any word not in the table is 2 bytes (0 args).
- Table (opcode → args): `f000`:0 `f010`:1 `f200`:1 `f210`:1 `1010`..`1070`:2 `1080`:1 `1310`..`1370`:2 `1380` `1390` `13a0` `13a1` `13b0` `13b1` `13c0` `13c1`:1 `2000`:4 `2005`:4 `2010` `2015` `2020`:3 `3020`:1 `4000` `4010`:3. Our `src/ads/opcodes.ts` `ADS_ARG_COUNTS` disagrees: `0xF010` 0 (original 1), `0x1520` 5 (original 0, not in the table), and it lacks most of the table.
- `1048:04fc(slot)`: sections. Skips the first word, then walks instructions with `1048:0303`; each `0xFFFF` ends a section and the next starts at the following word. Section start pointers go to record words `[0xa9 + 2 * i]` (80 slots, no bounds check), the count to word `[1]`. `1048:040f` collects, per section, scene ids from opcodes in the 2-entry table `1068:260a` (`0x2000`, `0x2005`) through `1048:0bf4` (chunk 6).

### Corpus facts (checked during planning)

| Type | Chunk paths (count) |
| --- | --- |
| `.ADS` | `VER:` (10), `ADS:` container (10), `ADS:RES:`, `ADS:SCR:`, `ADS:TAG:` (10 each) |
| `.BMP` | `BMP:` container (117), `BMP:INF:` (117), `BMP:BIN:` (117), `BMP:VGA:` (2: `MJTELE.BMP`, `JOHNWALK.BMP`) |
| `.PAL` | `PAL:` container, `PAL:VGA:` (768 bytes) |
| `.SCR` | `SCR:` container, `SCR:DIM:` (4 bytes), `SCR:BIN:` (10 each) |
| `.TTM` | `VER:`, `PAG:` (2 bytes), `TT3:`, `TTI:` container, `TTI:TAG:` (41 each) |

- Every `PAG:` count equals the number of `0x0FF0` opcodes in its bytecode.
- All 41 TTM scripts frame from start to end with the rules above. No `0xAF1F`/`0xAF2F`. Every opcode used is already a value in `OP` (`src/ttm/opcodes.ts`).
- With the original ADS table, every ADS splits into exactly as many sections as its `ADS:TAG:` list has entries, and the first word of each section equals the tag ids in list order. `0xF010` is followed by `0xFFFF` in the data, which the original frames as its argument.
- `PAL:VGA:` levels are 0..63. All BMP widths are even. Each `BMP:BIN:` size equals the sum of `((w + 1) / 2) * h`. SCR sizes: 640 × 350 or 640 × 480.

### Our decoders today

`src/decode/{pal,scr,bmp,ttm-loader,ads-loader,ttm-disasm}.ts` parse chunks in a fixed order with `BinaryReader.expect(tag)` and read container size fields as "unknown bytes". `decodeTtm` stores the `PAG:` chunk size (always 2) as `numPages`. `src/testing/corpus.ts` has a chunk tree walker (`walkChunks`) used only by tests.

## Function scope of this chunk

Every function below must end `verified` in `docs/re/function-map.md` or be listed in `docs/re/open-questions.md`:

- Chunk reader: `1038:0000 003a 0091 00d2 0119 016b 01da 0215 0517 054b 0584 0619` (step 1).
- Palette and screen: `1040:09eb`, `1030:16d8` (step 2).
- Bitmaps: `1030:000e 1112 124a 15cc 1624`, `1040:0db0` (step 3).
- TTM loader: `1050:013e 0177 03e2 042a 04a8 04d6` (step 4).
- ADS loader: `1048:0044 0079 0303 040f 04fc` (step 5).
- Thunks left over from chunk 2: `1028:17c8`..`1028:1b0d` (step 6).

Read but not in scope (leave `named`, they belong to chunk 4): `1040:0000`, `1040:035c`, `1040:0462`, `1040:0286`. ADS and TTM unloading (`1048:001b`, `1048:067f`, `1050:07c6`) belong to chunk 6.

## Findings format

`docs/re/decoders.md` is created in step 1 and extended by every step. Sections, in this order: `Chunk reader`, `Emulated edge cases`, `Palette`, `Screen`, `Pixels`, `Bitmap`, `Bitmap matrix`, `TTM loader`, `TTM opcode coverage`, `ADS loader`, `ADS opcode coverage`, `Thunks`, `Side-by-side checklist`. One claim per bullet, each starting with its address:

```markdown
- `1038:0215`: the path must be a non-zero multiple of 4 characters; anything else fails at once.
```

Side-by-side checklist rows:

```markdown
| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1038:0215` | `decoders_findChunk` | `src/decode/chunks.ts:30` | fixed |
```

Status is `match`, `fixed`, or `open` (every `open` row has an entry in `docs/re/open-questions.md`). Functions with no TypeScript counterpart write `none (reason)` in the Ours column and count as `match` when the finding explains why nothing is needed.

## Shared pieces (made in step 1, used by every later step)

TypeScript:

- `src/decode/chunks.ts`: `interface Chunk { path: string; bodyOffset: number; size: number; container: boolean }`, `walkChunks(payload: Uint8Array, start?: number, end?: number, prefix?: string): Chunk[]` (throws on a broken tree), `findChunk(payload: Uint8Array, path: string): Chunk | undefined`, `chunkBody(payload: Uint8Array, path: string): Uint8Array | undefined` (a `subarray` of the payload).
- `src/testing/corpus.ts` (existing, extended): `hasCorpus`, `FIXTURES_DIR`, `CHUNKED_TYPES`, `COMPRESSED_CHUNKS`, `readDataFile(name)`, `loadArchive(): ParsedArchive` (`byName: Map<string, RawResource>`, `list: RawResource[]`, `RawResource { name; type; payload }`), `walkChunks` and `Chunk` re-exported from `src/decode/chunks.ts`, plus new `hasFixture(path: string): boolean`, `readFixtureRows(path: string): string[][]` (TSV under `re/fixtures/`, header dropped), `readFixtureBytes(path: string): Uint8Array`.
- `src/testing/build-chunks.ts`: `ascii(text: string): Uint8Array`, `words(...values: number[]): Uint8Array` (u16 little endian), `concat(...parts: Uint8Array[]): Uint8Array`, `chunk(tag: string, body: Uint8Array, container = false): Uint8Array` (4-byte tag, u32 size with bit 31 for containers, body), `storedBody(data: Uint8Array): Uint8Array` (compressed-chunk body with method 0: method byte, u32 size, data).
- Existing: `unpackChunk(body: Uint8Array): Uint8Array` in `src/resource/uncompress.ts` (decompresses a compressed chunk body: u8 method, u32 size, data; matches the original byte for byte). `TRANSPARENT = 0xff` and `Sprite { width; height; indexed }` in `src/types.ts`.

Python (`scripts/re/unicorn/`):

- `original_loaders.py`: `new_loader_emulator(image: NeImage, payloads: dict[str, bytes]) -> Emulator` (heap handlers from chunk 2, near malloc `1038:0619`, and a file layer that serves the given resource payloads by name, case-insensitive), `put_string(emu, text) -> int` (near offset of a new NUL-terminated string), `c_string(emu, offset) -> str`, `read_word(emu, segment, offset) -> int`, `find_chunks_original(image, name, payload, paths: list[str]) -> list[tuple[int, int] | None]` (one emulator, queries in the given order; each result is `(body position, low 16 bits of size)` or `None`).
- `dump_loaders.py`: CLI, `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py [what ...]`. Writes TSV fixtures (and `.bin` files) to `re/fixtures/loaders/`. Each step adds its own command to the `COMMANDS` dict; step 1 has `chunks`.
- `test_original_loaders.py`: unit tests on handmade payloads, skipped without `public/data/SCRANTIC.SCR`. Module helpers `chunk(tag, body, container=False)`, `words(*values)`, `stored(data)`; later steps append test classes.

## Steps

- [x] `step-001-chunk-lookup.md`: Unicorn loader harness, original chunk lookup on edge cases and every resource, `src/decode/chunks.ts` with `findChunk`, findings file created.
- [x] `step-002-palette-and-screen.md`: palette and screen loaders checked; `decodePal` returns 16 colors through the original level table; `decodeScr` uses path lookup and the 320 × 400 default; pixel unpacking settled.
- [x] `step-003-bitmaps.md`: bitmap loader checked on every BMP; `decodeBmp` uses path lookup; `BMP:VGA:` and `BMP:MTX:` explained.
- [x] `step-004-ttm-loader.md`: TTM loader and page index checked on every TTM; `decodeTtm` returns the page count, page offsets, and tags the way the original builds them; shared TTM instruction reader; TTM opcode coverage table.
- [x] `step-005-ads-loader.md`: ADS loader and opcode size table checked; original size table and section index in `src/decode/ads-bytecode.ts`; `decodeAds` uses path lookup; ADS opcode coverage table; scheduler differences logged for chunk 6.
- [ ] `step-006-chunk-wrap-up.md`: thunks named, every in-scope function `verified` or logged, comment audit of `src/decode/`, full rebuild and test run, smoke test, spec checkbox ticked.

Order: step 1 first (everything uses `findChunk` and the harness). Then 2, 3, 4, 5 in that order: step 3 uses `unpackNibbles` and `packNibbles` from step 2, and all four extend the same findings file, `names.json`, `original_loaders.py`, and `dump_loaders.py`, so run them one at a time. Steps 4 and 5 do not depend on each other's code. Step 6 needs all of them.

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
