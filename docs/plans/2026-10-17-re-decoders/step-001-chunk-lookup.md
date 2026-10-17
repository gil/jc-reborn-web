# Step 1: Chunk Lookup and the Loader Harness

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** none (chunks 1 and 2 are done)

**Files:**

- Create: `scripts/re/unicorn/original_loaders.py`, `scripts/re/unicorn/dump_loaders.py`, `scripts/re/unicorn/test_original_loaders.py`
- Modify: `scripts/re/unicorn/original_decompress.py` (rename `_install_heap` to `install_heap`), `scripts/re/unicorn/README.md`
- Create: `src/decode/chunks.ts`, `src/decode/chunks.test.ts`, `src/decode/chunks.data.test.ts`, `src/testing/build-chunks.ts`
- Modify: `src/testing/corpus.ts`
- Create: `docs/re/decoders.md`
- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated), `docs/re/open-questions.md` (only if needed)

**Interfaces:**

- Consumes:
  - `scripts/re/unicorn/emulator.py`: `Emulator(image)`, `emu.call_far(address, stack_words=[...]) -> dict[str, int]` (registers after return; `stack_words` in push order, so cdecl arguments reversed), `emu.replace_function(address, handler)` (handler gets the emulator, returns registers to set), `emu.arg(i)` (argument `i` of a far cdecl function), `emu.near_alloc(size) -> int` (DS offset), `emu.alloc(size) -> (paragraph, 0)`, `emu.read(segment, offset, size)`, `emu.write(segment, offset, data)`, `emu.data_segment` (DS paragraph). Segments are real-mode paragraphs; linear address = `segment * 16 + offset`.
  - `scripts/re/unicorn/original_decompress.py`: `_install_heap(emu)` replaces `1038:06a8` (near calloc), `1038:063b` (near free), `1030:199a` (far alloc), `1030:1b63` (far free) with Python handlers. `chunk_body(method, size, data) -> bytes`.
  - `scripts/re/unicorn/corpus.py`: `CHUNKED_TYPES`, `load_resources(data_dir) -> list[Resource]` (`Resource.name`, `.payload`), `walk_chunks(payload) -> list[Chunk]` (`Chunk.path`, `.body_offset`, `.size`, `.container`).
  - `src/testing/corpus.ts` today: `DATA_DIR`, `FIXTURES_DIR`, `hasCorpus`, `CHUNKED_TYPES`, `COMPRESSED_CHUNKS`, `Chunk`, `readDataFile`, `loadArchive`, `walkChunks` (defined there).
- Produces: everything listed under "Shared pieces" in the overview: `src/decode/chunks.ts` (`Chunk`, `walkChunks`, `findChunk`, `chunkBody`), `src/testing/build-chunks.ts` (`ascii`, `words`, `concat`, `chunk`, `storedBody`), `src/testing/corpus.ts` additions (`hasFixture`, `readFixtureRows`, `readFixtureBytes`, `walkChunks` re-export), `original_loaders.py` (`new_loader_emulator`, `put_string`, `c_string`, `read_word`, `find_chunks_original`), `dump_loaders.py` (`COMMANDS`, `write_tsv`, `chunked`, `OUT`, `DATA`), `test_original_loaders.py` (`chunk`, `words`, `stored`, `BINARY`). Fixture `re/fixtures/loaders/chunks.tsv`. `docs/re/decoders.md` with all section headings.

## Part A: Read the original

- [x] **Action 1: Create the findings file**

Create `docs/re/decoders.md`:

```markdown
# Decoders: Chunks, Palette, Screens, Bitmaps, TTM, ADS

Findings for chunk 3. One claim per address. Our own words; no decompiled code.

## Chunk reader

## Emulated edge cases

## Palette

## Screen

## Pixels

## Bitmap

## Bitmap matrix

## TTM loader

## TTM opcode coverage

## ADS loader

## ADS opcode coverage

## Thunks

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
```

- [x] **Action 2: Read the chunk reader**

Read the pseudo-C (`re/out/functions/1038_<oooo>_*.c`) and, where unclear, the assembly (`.asm`) of `1038:0000 003a 0091 00d2 0119 016b 01da 0215 0517 054b 0584 0619`. Write the answers under `Chunk reader` in `docs/re/decoders.md`, one claim per bullet, each starting with its address, in our own words. Start from the overview's "Chunk reader" facts and confirm or correct each one. Answer at least:

- `1038:0000`: how a reader record is found; what `0` as the argument finds (a free record); how many records exist and where.
- `1038:016b`: what it opens (and with which mode string), how it measures the payload, what it stores in the record, what it returns. `1038:0584`: what it checks. `1038:054b`: what it frees and closes.
- `1038:003a`: which fields survive a reset; that it rewinds the file (`resources_rewindFile`, `1018:14cc`).
- `1038:0091`: the compare rule (stops at the first NUL in both strings, or after `n` characters).
- `1038:0215`, step by step: the path length rule; the backup copy at `1068:425a` and when `1038:01da` restores it; what occurrence 0, a positive occurrence, and `-1` do; whether a new path with occurrence 0 searches from the start or forward from the current position; how a container (bit 31 of the size, bit 15 of the high word) is entered and left; the depth limit (`+0x37` above `0x17` fails, so at most 6 levels); the check that a chunk does not run past its parent; what is returned on success (body position) and failure.
- `1038:0517`: which bits of the size come back.
- `1038:00d2`, `1038:0119`: who calls them (`1040:0db0` only) and what they read.
- `1038:0619`: a far wrapper around `1000:229c` (near malloc). Check `1000:229c` for a few minutes; name it `rtl_malloc` if it is plainly `LocalAlloc` without zeroing, else leave it.

- [x] **Action 3: Name the functions**

Add a `scripts/re/names.json` entry (subsystem `decoders`, status `named`, one-line note in our words, keep the file sorted by address) for each. Suggested names, adjust to what you found:

| Address | Name |
| --- | --- |
| `1038:0000` | `decoders_chunkReaderFor` |
| `1038:003a` | `decoders_resetChunkReader` |
| `1038:0091` | `decoders_tagPathEquals` |
| `1038:00d2` | `decoders_readChunkWord` (rename after reading) |
| `1038:0119` | `decoders_readChunkWords` (rename after reading) |
| `1038:016b` | `decoders_openChunkFile` |
| `1038:01da` | `decoders_restoreChunkReader` |
| `1038:0215` | `decoders_findChunk` |
| `1038:0517` | `decoders_chunkSize` |
| `1038:054b` | `decoders_closeChunkFile` |
| `1038:0584` | `decoders_isChunkFile` |
| `1038:0619` | `platform_nearMalloc` (subsystem `platform`) |

An entry looks like this (copy the shape of the existing ones):

```json
    "1038:0215": {
      "name": "decoders_findChunk",
      "subsystem": "decoders",
      "status": "named",
      "note": "Finds a chunk by its full tag path, forward from the current chunk; returns the body position or -1",
      "signature": null,
      "callingConvention": null
    },
```

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 4: Commit the findings**

```bash
git add docs/re/decoders.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk reader findings"
```

## Part B: Run the original chunk lookup

- [x] **Action 5: Make the heap installer public**

In `scripts/re/unicorn/original_decompress.py`, rename `_install_heap` to `install_heap` (the definition and its one call in `decompress_original`). Check nothing else uses the old name:

Run: `rg -n "_install_heap" scripts`
Expected: no matches.

- [x] **Action 6: Write the failing Python tests**

Create `scripts/re/unicorn/test_original_loaders.py`. The expected values come from the overview's first reading of `1038:0215`. Payload layout: `VER:` header at 0, body 8..12; `TTI:` header at 13, body 21..32; `TTI:TAG:` header at 21, body 29..32; `PAG:` header at 33, body 41..42.

```python
import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_loaders import find_chunks_original

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


TTM_LIKE = chunk("VER:", b"4.09\0") + chunk("TTI:", chunk("TAG:", words(1) + b"A\0"), container=True) + chunk("PAG:", words(3))


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class FindChunkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def find(self, *paths: str):
        return find_chunks_original(self.image, "TEST.TTM", TTM_LIKE, list(paths))

    def test_top_level_and_nested_paths(self):
        for path, expected in {"VER:": (8, 5), "TTI:": (21, 12), "TTI:TAG:": (29, 4), "PAG:": (41, 2)}.items():
            with self.subTest(path=path):
                self.assertEqual(self.find(path), [expected])

    def test_last_tag_alone_does_not_match_a_nested_chunk(self):
        self.assertEqual(self.find("TAG:"), [None])

    def test_paths_not_made_of_4_byte_tags_fail(self):
        for path in ("", "PAG", "XYZ:"):
            with self.subTest(path=path):
                self.assertEqual(self.find(path), [None])

    def test_search_only_moves_forward(self):
        self.assertEqual(self.find("VER:", "PAG:"), [(8, 5), (41, 2)])
        self.assertEqual(self.find("PAG:", "VER:"), [(41, 2), None])

    def test_same_path_twice_returns_the_same_chunk(self):
        self.assertEqual(self.find("PAG:", "PAG:"), [(41, 2), (41, 2)])

    def test_a_failed_search_leaves_the_reader_where_it_was(self):
        self.assertEqual(self.find("VER:", "XYZ:", "PAG:"), [(8, 5), None, (41, 2)])


if __name__ == "__main__":
    unittest.main()
```

`stored` is not used yet; later steps use it.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'original_loaders'`.

- [x] **Action 7: Write the loader harness**

Create `scripts/re/unicorn/original_loaders.py`. The file layer follows the chunk 2 findings for `1018:1287` (whole items only, never past the payload), `1018:1398` (positions relative to the payload, clamped to its size; whence 2 counts back from the end), `1018:1475`, and `1018:14e9` (`0xFFFF` at the end). Handles start at `0x0100` so they never equal a name pointer (near heap offsets are above the data segment's static data, around `0x47c0`).

```python
import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage
from original_decompress import install_heap

OPEN_FILE = "1018:1019"
CLOSE_FILE = "1018:1204"
FILE_READ = "1018:1287"
FILE_SEEK = "1018:1398"
FILE_TELL = "1018:1475"
FILE_GETC = "1018:14e9"
NEAR_MALLOC = "1038:0619"
OPEN_CHUNKED = "1038:016b"
FIND_CHUNK = "1038:0215"
CHUNK_SIZE = "1038:0517"
FIRST_HANDLE = 0x0100
FAILED = 0xFFFF


@dataclass
class OpenResource:
    data: bytes
    pos: int = 0


class ResourceFiles:
    def __init__(self, payloads: dict[str, bytes]):
        self.payloads = {name.upper(): data for name, data in payloads.items()}
        self.open: dict[int, OpenResource] = {}
        self.next_handle = FIRST_HANDLE

    def install(self, emu: Emulator):
        for address, handler in (
            (OPEN_FILE, self.open_file),
            (CLOSE_FILE, self.close_file),
            (FILE_READ, self.read),
            (FILE_SEEK, self.seek),
            (FILE_TELL, self.tell),
            (FILE_GETC, self.getc),
        ):
            emu.replace_function(address, handler)

    def file(self, emu: Emulator, index: int) -> OpenResource:
        handle = emu.arg(index)
        if handle not in self.open:
            raise RuntimeError(f"file call with unknown handle {handle:#x}, argument layout is wrong")
        return self.open[handle]

    def open_file(self, emu: Emulator):
        data = self.payloads.get(c_string(emu, emu.arg(0)).upper())
        if data is None:
            return {"ax": 0}
        handle = self.next_handle
        self.next_handle += 2
        self.open[handle] = OpenResource(data)
        return {"ax": handle}

    def close_file(self, emu: Emulator):
        self.open.pop(emu.arg(0), None)
        return {"ax": 0}

    def read(self, emu: Emulator):
        file = self.file(emu, 3)
        buf, size, count = emu.arg(0), emu.arg(1), emu.arg(2)
        items = min(count, (len(file.data) - file.pos) // size) if size else 0
        data = file.data[file.pos:file.pos + items * size]
        file.pos += len(data)
        emu.write(emu.data_segment, buf, data)
        return {"ax": items}

    def seek(self, emu: Emulator):
        file = self.file(emu, 0)
        offset = emu.arg(1) | emu.arg(2) << 16
        size = len(file.data)
        whence = emu.arg(3)
        if whence == 0:
            target = offset
        elif whence == 1:
            target = (file.pos + offset) & 0xFFFFFFFF
        else:
            target = size - offset if offset < size else 0
        file.pos = min(target, size)
        return {"ax": 0, "dx": 0}

    def tell(self, emu: Emulator):
        pos = self.file(emu, 0).pos
        return {"ax": pos & 0xFFFF, "dx": pos >> 16}

    def getc(self, emu: Emulator):
        file = self.file(emu, 0)
        if file.pos >= len(file.data):
            return {"ax": FAILED}
        file.pos += 1
        return {"ax": file.data[file.pos - 1]}


def new_loader_emulator(image: NeImage, payloads: dict[str, bytes]) -> Emulator:
    emu = Emulator(image)
    install_heap(emu)
    emu.replace_function(NEAR_MALLOC, _near_malloc)
    ResourceFiles(payloads).install(emu)
    return emu


def _near_malloc(emu: Emulator):
    size = emu.arg(0)
    offset = emu.near_alloc(size)
    emu.write(emu.data_segment, offset, bytes(size))
    return {"ax": offset}


def put_string(emu: Emulator, text: str) -> int:
    data = text.encode("latin1") + b"\0"
    offset = emu.near_alloc(len(data))
    emu.write(emu.data_segment, offset, data)
    return offset


def c_string(emu: Emulator, offset: int) -> str:
    out = bytearray()
    while (byte := emu.read(emu.data_segment, offset + len(out), 1)[0]) != 0:
        out.append(byte)
    return out.decode("latin1")


def read_word(emu: Emulator, segment: int, offset: int) -> int:
    return struct.unpack("<H", emu.read(segment, offset, 2))[0]


def find_chunks_original(image: NeImage, name: str, payload: bytes, paths: list[str]) -> list[tuple[int, int] | None]:
    emu = new_loader_emulator(image, {name: payload})
    handle = emu.call_far(OPEN_CHUNKED, stack_words=[put_string(emu, name)])["ax"]
    if handle == 0:
        raise RuntimeError(f"{name} did not open")
    results: list[tuple[int, int] | None] = []
    for path in paths:
        regs = emu.call_far(FIND_CHUNK, stack_words=[0, put_string(emu, path), handle])
        if regs["ax"] == FAILED and regs["dx"] == FAILED:
            results.append(None)
            continue
        size = emu.call_far(CHUNK_SIZE, stack_words=[handle])["ax"]
        results.append((regs["dx"] << 16 | regs["ax"], size))
    return results
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: all pass.

If a test fails with `UnstubbedImport` or `RuntimeError: file call with unknown handle`, a function the reader calls needs a handler or an argument index is off; read the call site in the `.asm` and fix the harness, not the test. If a test fails because the original returns something else (for example `test_search_only_moves_forward` finds `VER:` after `PAG:`), the original wins: change the expected value to what it returns and write the behavior as a finding in Action 9.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_loaders.py scripts/re/unicorn/test_original_loaders.py scripts/re/unicorn/original_decompress.py`
Expected: no output.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass (chunk 2's tests still pass after the rename).

- [x] **Action 8: Dump the original lookup for every resource**

Create `scripts/re/unicorn/dump_loaders.py`. Each query runs in a fresh emulator, so the forward-only search never hides a chunk.

```python
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import CHUNKED_TYPES, Resource, load_resources, walk_chunks  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_loaders import find_chunks_original  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/loaders"
LOADER_PATHS = {
    ".BMP": ["BMP:INF:", "BMP:BIN:", "BMP:VGA:", "BMP:AMG:", "BMP:MTX:"],
    ".SCR": ["SCR:DIM:", "SCR:BIN:", "SCR:VGA:", "SCR:AMG:"],
    ".PAL": ["PAL:VGA:"],
    ".TTM": ["PAG:", "TT3:"],
    ".ADS": ["ADS:RES:", "ADS:SCR:"],
}


def write_tsv(name: str, header: list[str], rows: list[list[object]]):
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header), *("\t".join(str(value) for value in row) for row in rows)]
    (OUT / name).write_text("\n".join(lines) + "\n")
    print(f"{name}: {len(rows)} rows", file=sys.stderr)


def chunked(resources: list[Resource], kind: str | None = None) -> list[Resource]:
    return [r for r in resources if r.name[-4:] in CHUNKED_TYPES and (kind is None or r.name[-4:] == kind)]


def dump_chunks(image: NeImage, resources: list[Resource]):
    rows = []
    for resource in chunked(resources):
        walked = [chunk.path for chunk in walk_chunks(resource.payload)]
        for path in dict.fromkeys([*walked, *LOADER_PATHS[resource.name[-4:]]]):
            [found] = find_chunks_original(image, resource.name, resource.payload, [path])
            position, size = found or (-1, -1)
            rows.append([resource.name, path, position, size])
    write_tsv("chunks.tsv", ["resource", "path", "position", "size"], rows)


COMMANDS = {
    "chunks": dump_chunks,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the original SCRANTIC.SCR loaders on every resource; fixtures go to re/fixtures/loaders/")
    parser.add_argument("what", nargs="*", help=f"fixtures to write, any of {', '.join(sorted(COMMANDS))} (default: all)")
    args = parser.parse_args()
    unknown = sorted(set(args.what) - set(COMMANDS))
    if unknown:
        parser.error(f"unknown fixture {', '.join(unknown)}")
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = load_resources(DATA)
    for name in args.what or sorted(COMMANDS):
        COMMANDS[name](image, resources)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_loaders.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py chunks`
Expected: last line `chunks.tsv: <n> rows` with `n` around 1000 (179 chunked resources, about 5 or 6 paths each). It may take a minute or two. `re/fixtures/loaders/chunks.tsv` exists.

- [x] **Action 9: Record the edge cases**

Under `Emulated edge cases` in `docs/re/decoders.md`, add a table of what the original returned for each case in `test_original_loaders.py` (case, query sequence, result), in the same style as the `Emulated edge cases` table in `docs/re/resources.md`. Under `Chunk reader`, add one bullet per behavior the cases proved, citing `1038:0215` (forward-only search, same path twice, failed search leaves the reader in place, nested tag alone does not match).

Add to `scripts/re/unicorn/README.md`, after the "Original decompressor" section:

```markdown
## Original loaders

    re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py chunks

Runs the original chunk lookup and loaders on every resource and writes fixtures to `re/fixtures/loaders/` (gitignored). `original_loaders.py` replaces the resource file layer (`1018:1019`, `1018:1204`, `1018:1287`, `1018:1398`, `1018:1475`, `1018:14e9`) with handlers that serve resource payloads by name, plus the allocators. Each loader's drawing or bitmap call is replaced by a handler that captures what the loader hands it.
```

- [x] **Action 10: Commit**

```bash
git add scripts/re/unicorn/original_loaders.py scripts/re/unicorn/dump_loaders.py scripts/re/unicorn/test_original_loaders.py scripts/re/unicorn/original_decompress.py scripts/re/unicorn/README.md docs/re/decoders.md
git commit -m "feat(re): run the original chunk lookup on edge cases and every resource"
```

## Part C: Our chunk lookup

- [x] **Action 11: Write the test helpers**

Create `src/testing/build-chunks.ts`:

```ts
const CONTAINER_FLAG = 0x80000000;

export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

export function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value, true));
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function chunk(tag: string, body: Uint8Array, container = false): Uint8Array {
  const header = new Uint8Array(8);
  header.set(ascii(tag));
  new DataView(header.buffer).setUint32(4, (body.length | (container ? CONTAINER_FLAG : 0)) >>> 0, true);
  return concat(header, body);
}

export function storedBody(data: Uint8Array): Uint8Array {
  const header = new Uint8Array(5);
  new DataView(header.buffer).setUint32(1, data.length, true);
  return concat(header, data);
}
```

`storedBody` uses method 0, which `unpackChunk` and the original both copy unchanged (chunk 2, `1028:0000`).

- [x] **Action 12: Write the failing unit tests**

Create `src/decode/chunks.test.ts`. It uses the same payload as the Python tests.

```ts
import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, words } from '../testing/build-chunks.js';
import { chunkBody, findChunk } from './chunks.js';

const TTM_LIKE = concat(
  chunk('VER:', ascii('4.09\0')),
  chunk('TTI:', chunk('TAG:', concat(words(1), ascii('A\0'))), true),
  chunk('PAG:', words(3)),
);

describe('findChunk', () => {
  // SCRANTIC 1038:0215 1038:0517
  it('finds top-level and nested chunks by their full tag path', () => {
    expect(findChunk(TTM_LIKE, 'VER:')).toMatchObject({ bodyOffset: 8, size: 5 });
    expect(findChunk(TTM_LIKE, 'TTI:')).toMatchObject({ bodyOffset: 21, size: 12, container: true });
    expect(findChunk(TTM_LIKE, 'TTI:TAG:')).toMatchObject({ bodyOffset: 29, size: 4 });
    expect(findChunk(TTM_LIKE, 'PAG:')).toMatchObject({ bodyOffset: 41, size: 2 });
  });

  // SCRANTIC 1038:0215
  it('does not match a nested chunk by its last tag alone', () => {
    expect(findChunk(TTM_LIKE, 'TAG:')).toBeUndefined();
  });

  // SCRANTIC 1038:0215
  it('refuses paths that are not made of 4-byte tags', () => {
    expect(findChunk(TTM_LIKE, '')).toBeUndefined();
    expect(findChunk(TTM_LIKE, 'PAG')).toBeUndefined();
    expect(findChunk(TTM_LIKE, 'XYZ:')).toBeUndefined();
  });
});

describe('chunkBody', () => {
  it('returns the body bytes of the chunk', () => {
    expect(Array.from(chunkBody(TTM_LIKE, 'PAG:')!)).toEqual([3, 0]);
    expect(chunkBody(TTM_LIKE, 'XYZ:')).toBeUndefined();
  });
});
```

If Action 7 changed an expected value, change it here the same way.

Run: `pnpm exec vitest run src/decode/chunks.test.ts`
Expected: FAIL (`./chunks.js` does not exist).

- [x] **Action 13: Implement `src/decode/chunks.ts`**

Move the walker out of `src/testing/corpus.ts` into `src/decode/chunks.ts` and add the lookup. Our lookup always searches from the start; the original searches forward from the last chunk it found. Both agree whenever the chunks are asked for in file order, which the data test in Action 15 checks for every loader.

```ts
const CONTAINER_FLAG = 0x80000000;
const SIZE_MASK = 0x7fffffff;
const TAG_LENGTH = 4;

export interface Chunk {
  path: string;
  bodyOffset: number;
  size: number;
  container: boolean;
}

export function walkChunks(payload: Uint8Array, start = 0, end = payload.length, prefix = ''): Chunk[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const chunks: Chunk[] = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error(`${end - pos} stray bytes in ${prefix || 'top level'} at ${pos}`);
    const rawSize = view.getUint32(pos + 4, true);
    const chunk: Chunk = {
      path: prefix + String.fromCharCode(...payload.subarray(pos, pos + TAG_LENGTH)),
      bodyOffset: pos + 8,
      size: rawSize & SIZE_MASK,
      container: (rawSize & CONTAINER_FLAG) !== 0,
    };
    if (chunk.bodyOffset + chunk.size > end) throw new Error(`${chunk.path} at ${pos} overruns its parent`);
    chunks.push(chunk);
    if (chunk.container) chunks.push(...walkChunks(payload, chunk.bodyOffset, chunk.bodyOffset + chunk.size, chunk.path));
    pos = chunk.bodyOffset + chunk.size;
  }
  return chunks;
}

export function findChunk(payload: Uint8Array, path: string): Chunk | undefined {
  if (path.length === 0 || path.length % TAG_LENGTH !== 0) return undefined;
  return walkChunks(payload).find((chunk) => chunk.path === path);
}

export function chunkBody(payload: Uint8Array, path: string): Uint8Array | undefined {
  const chunk = findChunk(payload, path);
  return chunk && payload.subarray(chunk.bodyOffset, chunk.bodyOffset + chunk.size);
}
```

Replace the start of `src/testing/corpus.ts` up to and including `walkChunks` so the file reads:

```ts
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexArchive } from '../resource/resource-archive.js';
import { parseMap } from '../resource/resource-map.js';
import type { ParsedArchive } from '../resource/types.js';

export { walkChunks, type Chunk } from '../decode/chunks.js';

export const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL('../../re/fixtures/', import.meta.url));
export const hasCorpus = existsSync(DATA_DIR + 'RESOURCE.MAP') && existsSync(DATA_DIR + 'RESOURCE.001');

export const CHUNKED_TYPES = new Set(['.ADS', '.BMP', '.PAL', '.SCR', '.TTM']);
export const COMPRESSED_CHUNKS = new Set(['BMP:BIN:', 'BMP:VGA:', 'SCR:BIN:', 'ADS:SCR:', 'TT3:']);

export function readDataFile(name: string): ArrayBuffer {
  return new Uint8Array(readFileSync(DATA_DIR + name)).buffer;
}

export function loadArchive(): ParsedArchive {
  return indexArchive(parseMap(readDataFile('RESOURCE.MAP')), readDataFile('RESOURCE.001'));
}

export function hasFixture(path: string): boolean {
  return hasCorpus && existsSync(FIXTURES_DIR + path);
}

export function readFixtureRows(path: string): string[][] {
  const [, ...rows] = readFileSync(FIXTURES_DIR + path, 'utf8').trimEnd().split('\n');
  return rows.map((row) => row.split('\t'));
}

export function readFixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(FIXTURES_DIR + path));
}
```

The old `CONTAINER_FLAG`, `SIZE_MASK`, `Chunk`, and `walkChunks` definitions are gone from `corpus.ts`; the re-export keeps every existing import (`uncompress.data.test.ts`, `resource-archive.data.test.ts`, `corpus.test.ts`) working.

Run: `pnpm exec vitest run src/decode/chunks.test.ts src/testing/corpus.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 14: Commit**

```bash
git add src/decode/chunks.ts src/decode/chunks.test.ts src/testing/build-chunks.ts src/testing/corpus.ts
git commit -m "feat(decode): chunk lookup by tag path, as the original loaders do"
```

- [x] **Action 15: Write the corpus tests**

Create `src/decode/chunks.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHUNKED_TYPES, hasCorpus, hasFixture, loadArchive, readFixtureRows, walkChunks } from '../testing/corpus.js';
import { findChunk } from './chunks.js';

const LOADER_PATHS: Record<string, string[]> = {
  '.BMP': ['BMP:INF:', 'BMP:BIN:'],
  '.SCR': ['SCR:DIM:', 'SCR:BIN:'],
  '.PAL': ['PAL:VGA:'],
  '.TTM': ['PAG:', 'TT3:'],
  '.ADS': ['ADS:RES:', 'ADS:SCR:'],
};

describe.skipIf(!hasFixture('loaders/chunks.tsv'))('chunk lookup matches the original SCRANTIC.SCR', () => {
  it('finds the same body position and size for every path asked of the original', () => {
    // SCRANTIC 1038:0215 1038:0517
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/chunks.tsv');
    const wrong = rows.flatMap(([resource, path, position, size]) => {
      const found = findChunk(archive.byName.get(resource!)!.payload, path!);
      const ours = found ? `${found.bodyOffset} ${found.size & 0xffff}` : '-1 -1';
      return ours === `${position} ${size}` ? [] : [`${resource} ${path}: ours ${ours}, original ${position} ${size}`];
    });
    expect(new Set(rows.map(([resource]) => resource)).size).toBe(179);
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('chunk order in the real data', () => {
  it('stores the chunks each loader asks for in the order it asks, so a forward-only search finds them all', () => {
    // SCRANTIC 1038:0215
    const outOfOrder = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        const offsets = LOADER_PATHS[resource.type]!.map((path) => findChunk(resource.payload, path)?.bodyOffset ?? -1);
        const ordered = offsets.every((offset, i) => offset > (offsets[i - 1] ?? 0));
        return ordered ? [] : [`${resource.name}: ${offsets.join(' ')}`];
      });
    expect(outOfOrder).toEqual([]);
  });

  it('keeps every leaf chunk under 64 KB, so the 16-bit size from 1038:0517 is the whole size', () => {
    // SCRANTIC 1038:0517
    const large = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        const chunks = walkChunks(resource.payload).filter((chunk) => !chunk.container && chunk.size > 0xffff);
        return chunks.map((chunk) => `${resource.name} ${chunk.path} ${chunk.size}`);
      });
    expect(large).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/decode/chunks.data.test.ts`
Expected: 3 tests pass. If the first fails, each line names a resource and path where our lookup and the original disagree: read `1038:0215` again for that case, fix `findChunk`, and write the finding. Never change the fixture by hand.

- [x] **Action 16: Commit**

```bash
git add src/decode/chunks.data.test.ts
git commit -m "test(decode): chunk lookup matches the original on every resource"
```

## Part D: Checklist

- [x] **Action 17: Fill the checklist rows**

In `docs/re/decoders.md` under `Side-by-side checklist`, add one row per in-scope `1038` function. Expected mapping, adjust to your findings:

| Original | Ours |
| --- | --- |
| `1038:0215` | `findChunk` in `src/decode/chunks.ts` (status `fixed`: the decoders used fixed-order parsing before; they switch to `findChunk` in steps 2 to 5, so write `fixed` now and let those steps prove it) |
| `1038:0517` | `findChunk` (`size`) |
| `1038:0091` | `findChunk` (`chunk.path === path`) |
| `1038:016b`, `1038:054b`, `1038:0584`, `1038:0000`, `1038:003a`, `1038:01da` | `none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed)` |
| `1038:00d2`, `1038:0119` | `none (only the BMP:MTX: loader uses them, and the data has no BMP:MTX:)` |
| `1038:0619` | `none (allocation)` |

Use real line numbers (`file:line`).

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 18: Open questions, only if needed**

For any behavior you could not settle, add an entry to `docs/re/open-questions.md` (next free `OQ-` number, under "Workarounds without a known root cause" or a fitting section). Use the existing entry format (`Where`, `What it does`, `Old guess behind it`, `Resolve in`, `Status`).

- [x] **Action 19: Run every check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): side-by-side checklist for the chunk reader"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
