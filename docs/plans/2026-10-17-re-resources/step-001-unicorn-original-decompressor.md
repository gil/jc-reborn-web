# Step 1: Run the Original Decompressor in Unicorn

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** none (chunk 1 toolchain must be in place: `re/.venv`, `re/out/`, `scripts/re/unicorn/`)

**Files:**

- Modify: `scripts/re/unicorn/emulator.py`
- Modify: `scripts/re/unicorn/test_emulator.py`
- Create: `scripts/re/unicorn/corpus.py`
- Create: `scripts/re/unicorn/test_corpus.py`
- Create: `scripts/re/unicorn/original_decompress.py`
- Create: `scripts/re/unicorn/test_original_decompress.py`
- Create: `scripts/re/unicorn/dump_decompressed.py`
- Modify: `scripts/re/unicorn/README.md`
- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Create: `docs/re/resources.md`
- Output (gitignored, never commit): `re/fixtures/decompressed/index.tsv`, `re/fixtures/decompressed/*.bin`

**Interfaces:**

- Consumes (chunk 1, `scripts/re/unicorn/emulator.py`):
  - `Emulator(image: NeImage)`; `emu.call_far(address: str | tuple[int, int], regs: dict | None = None, stack_words: Sequence[int] = (), instruction_limit=50_000_000) -> dict[str, int]`. `stack_words` are in push order; for cdecl pass the arguments reversed (last argument first). `call_far` resets `DS = ES = SS` to the auto data segment and `SP = 0xFFFE` on every call. Globals in DS persist between calls on the same `Emulator`.
  - `emu.alloc(size) -> (paragraph, 0)` bump allocator above the stub segment; memory starts zeroed.
  - `emu.read(segment, offset, size) -> bytes`, `emu.write(segment, offset, data)`, `emu.reg(name)`, `emu.add_stub(module, ordinal, handler, arg_bytes)`, `emu.import_address(module, ordinal)`, `emu.paragraphs: dict[int, int]` (NE segment index → paragraph).
  - Handlers are `Callable[[Emulator], dict[str, int] | None]`; the returned dict sets registers.
  - `UnstubbedImport(target)` is raised when code calls an import with no stub. `EmulationLimit` when the instruction limit is hit.
  - `NeImage.load(path)`; `image.segments` (each has `.index`, `.data`, `.min_alloc`), `image.auto_data_segment` (14).
- Produces:
  - `emu.replace_function(address: str, handler, arg_bytes: int = 0)`, `emu.arg(index: int) -> int`, `emu.near_alloc(size: int) -> int`, `emu.data_segment -> int`.
  - `corpus.py`: `load_resources(data_dir: Path) -> list[Resource]`, `walk_chunks(payload: bytes) -> list[Chunk]`, `compressed_chunks(resources) -> list[tuple[Resource, Chunk]]`, constants `CHUNKED_TYPES`, `COMPRESSED_CHUNKS`. `Resource(name: str, offset: int, payload: bytes)`, `Chunk(path: str, body_offset: int, size: int, container: bool)`.
  - `original_decompress.py`: `decompress_original(image: NeImage, data: bytes, body_offset: int, body_size: int) -> bytes`, `chunk_body(method: int, size: int, data: bytes) -> bytes`, `pack_codes(codes: list[tuple[int, int]]) -> bytes`, `OpenFailed`.
  - Fixtures for step 2: `re/fixtures/decompressed/index.tsv` with header `resource	chunk	bodyOffset	method	size	produced	file`, one row per compressed chunk; `bodyOffset` is the offset of the chunk body (its method byte) inside the resource payload (the bytes after the 13-byte name and u32 size in `RESOURCE.001`); `file` is a `.bin` file name in the same folder holding the original's output.
  - `docs/re/resources.md` with the `Compressed stream` and `Emulated edge cases` sections filled.

## How the original is driven

The game opens a resource, seeks to a compressed chunk body, then calls `1028:0615` (open), `1028:0a0d` (read), and `1028:0875` (close). We run exactly those three. Everything below them that touches files or Windows memory is replaced by Python handlers: the file layer (`1018:1287` read, `1018:14e9` getc, `1018:1398` seek, `1018:1475` tell) serves bytes from the resource payload, and the allocators (`1038:06a8`, `1030:199a`, `1030:1b63`) hand out emulator memory. Argument layouts are in the overview's table.

`replace_function` patches the function's first 5 bytes with `JMP FAR` to a fresh slot in the stub segment. The slot holds `RETF`, and the existing stub hook runs the handler there. Because we jump instead of call, the stack still holds the original caller's far return address, so `emu.arg(0)` is the word at `SS:SP+4`.

- [x] **Action 1: Write failing emulator tests**

Append to the `EmulatorTest` class in `scripts/re/unicorn/test_emulator.py`:

```python
    def test_replaced_function_runs_the_handler_with_its_arguments(self):
        seen = []

        def handler(emu):
            seen.append([emu.arg(i) for i in range(3)])
            return {"ax": 0x4242}

        self.emu.replace_function("1000:0302", handler)
        regs = self.emu.call_far("1000:0302", stack_words=[3, 2, 1])
        self.assertEqual(seen, [[1, 2, 3]])
        self.assertEqual(regs["ax"], 0x4242)
        self.assertEqual(regs["sp"], INITIAL_SP - 6)

    def test_near_alloc_hands_out_disjoint_words_after_the_data(self):
        first = self.emu.near_alloc(3)
        second = self.emu.near_alloc(4)
        self.assertEqual(first, 0x47C0)
        self.assertEqual(second, first + 4)
        with self.assertRaises(MemoryError):
            self.emu.near_alloc(0x10000)

    def test_data_segment_is_the_auto_data_paragraph(self):
        self.assertEqual(self.emu.data_segment, self.emu.paragraphs[self.image.auto_data_segment])
```

- [x] **Action 2: Run them to see them fail**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_emulator.py' -v`
Expected: the three new tests fail with `AttributeError: 'Emulator' object has no attribute ...`. The old tests pass.

- [x] **Action 3: Implement `replace_function`, `arg`, `near_alloc`, `data_segment`**

In `scripts/re/unicorn/emulator.py`:

Add constants next to `RETF = 0xCB`:

```python
JMP_FAR = 0xEA
NEAR_HEAP_END = 0xE000
```

Add below the `Stub` dataclass:

```python
StubKey = ImportTarget | str
```

In `__init__`, replace

```python
        self.stubs: dict[ImportTarget, Stub] = {}
        self._import_offsets: dict[ImportTarget, int] = {}
        self._imports_by_offset: dict[int, ImportTarget] = {}
```

with

```python
        self.stubs: dict[StubKey, Stub] = {}
        self._stub_offsets: dict[StubKey, int] = {}
        self._stub_keys_by_offset: dict[int, StubKey] = {}
```

and after the `for segment in image.segments:` loop that fills `self.paragraphs` (before `self.stub_paragraph = paragraph`), add:

```python
        auto_data = next(s for s in image.segments if s.index == image.auto_data_segment)
        self._near_heap = (max(len(auto_data.data), auto_data.min_alloc) + 15) & ~15
```

Replace `import_address` and add the new methods after `add_stub`:

```python
    def import_address(self, module: str, ordinal: int) -> tuple[int, int]:
        return self.stub_paragraph, self._stub_offset(ImportTarget(module, ordinal))

    def replace_function(self, address: str, handler: Callable[["Emulator"], dict[str, int] | None], arg_bytes: int = 0):
        offset = self._stub_offset(address)
        self.stubs[address] = Stub(handler, arg_bytes)
        segment, ip = self.far(address)
        self.write(segment, ip, struct.pack("<BHH", JMP_FAR, offset, self.stub_paragraph))

    def arg(self, index: int) -> int:
        return struct.unpack("<H", self.read(self.reg("ss"), self.reg("sp") + 4 + 2 * index, 2))[0]

    @property
    def data_segment(self) -> int:
        return self.paragraphs[self.image.auto_data_segment]

    def near_alloc(self, size: int) -> int:
        offset = self._near_heap
        if offset + size > NEAR_HEAP_END:
            raise MemoryError(f"near heap exhausted allocating {size} bytes")
        self._near_heap = (offset + size + 1) & ~1
        return offset
```

Rename `_import_offset` to `_stub_offset` and generalize it:

```python
    def _stub_offset(self, key: StubKey) -> int:
        if key not in self._stub_offsets:
            offset = 2 + 2 * len(self._stub_offsets)
            if offset >= STUB_SEGMENT_SIZE:
                raise MemoryError("stub segment full")
            self._stub_offsets[key] = offset
            self._stub_keys_by_offset[offset] = key
        return self._stub_offsets[key]
```

In `_on_stub`, replace

```python
        target = self._imports_by_offset[offset]
        stub = self.stubs.get(target)
        if stub is None:
            raise UnstubbedImport(target)
```

with

```python
        key = self._stub_keys_by_offset[offset]
        stub = self.stubs.get(key)
        if stub is None:
            raise UnstubbedImport(key)
```

In `_resolve`, change `return self.stub_paragraph, self._import_offset(target)` to `return self.stub_paragraph, self._stub_offset(target)`. In `call_far`, change `data_segment = self.paragraphs[self.image.auto_data_segment]` to `data_segment = self.data_segment`.

- [x] **Action 4: Run the emulator tests**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_emulator.py' -v`
Expected: all pass. If `test_near_alloc_hands_out_disjoint_words_after_the_data` fails on the first value, print `len(auto_data.data)` and `auto_data.min_alloc`; the expected `0x47C0` comes from both being `0x47c0`. Fix the code, not the expectation, unless the image says otherwise.

- [x] **Action 5: Commit**

```bash
git add scripts/re/unicorn/emulator.py scripts/re/unicorn/test_emulator.py
git commit -m "feat(re): replace internal SCRANTIC functions with Python handlers in Unicorn"
```

- [x] **Action 6: Write the corpus tests**

Create `scripts/re/unicorn/test_corpus.py`:

```python
import unittest
from collections import Counter
from pathlib import Path

from corpus import CHUNKED_TYPES, compressed_chunks, load_resources, walk_chunks

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"


@unittest.skipUnless((DATA / "RESOURCE.MAP").exists(), "needs public/data/RESOURCE.MAP")
class CorpusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources = load_resources(DATA)

    def test_lists_every_resource(self):
        self.assertEqual(
            Counter(resource.name[-4:] for resource in self.resources),
            {".BMP": 117, ".TTM": 41, ".SCR": 10, ".ADS": 10, ".PAL": 1, ".VIN": 1},
        )

    def test_chunk_trees_cover_every_payload(self):
        for resource in self.resources:
            if resource.name[-4:] in CHUNKED_TYPES:
                with self.subTest(resource.name):
                    self.assertTrue(walk_chunks(resource.payload))

    def test_finds_every_compressed_chunk(self):
        self.assertEqual(
            Counter(chunk.path for _, chunk in compressed_chunks(self.resources)),
            {"BMP:BIN:": 117, "TT3:": 41, "SCR:BIN:": 10, "ADS:SCR:": 10, "BMP:VGA:": 2},
        )

    def test_walk_rejects_a_chunk_that_overruns_its_parent(self):
        with self.assertRaises(ValueError):
            walk_chunks(b"BIN:\x10\x00\x00\x00abc")


if __name__ == "__main__":
    unittest.main()
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_corpus.py' -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'corpus'`.

- [x] **Action 7: Implement `corpus.py`**

Create `scripts/re/unicorn/corpus.py`:

```python
import struct
from dataclasses import dataclass
from pathlib import Path

CHUNKED_TYPES = {".ADS", ".BMP", ".PAL", ".SCR", ".TTM"}
COMPRESSED_CHUNKS = {"BMP:BIN:", "BMP:VGA:", "SCR:BIN:", "ADS:SCR:", "TT3:"}
CONTAINER_FLAG = 0x80000000
SIZE_MASK = 0x7FFFFFFF
ENTRY_COUNT_OFFSET = 19
FIRST_ENTRY_OFFSET = 21
NAME_SIZE = 13
RESOURCE_HEADER_SIZE = NAME_SIZE + 4


@dataclass(frozen=True)
class Resource:
    name: str
    offset: int
    payload: bytes


@dataclass(frozen=True)
class Chunk:
    path: str
    body_offset: int
    size: int
    container: bool


def load_resources(data_dir: Path) -> list[Resource]:
    index = (data_dir / "RESOURCE.MAP").read_bytes()
    archive = (data_dir / "RESOURCE.001").read_bytes()
    (count,) = struct.unpack_from("<H", index, ENTRY_COUNT_OFFSET)
    resources = []
    for i in range(count):
        _, offset = struct.unpack_from("<II", index, FIRST_ENTRY_OFFSET + 8 * i)
        name = archive[offset:offset + NAME_SIZE].split(b"\0")[0].decode("latin1")
        (size,) = struct.unpack_from("<I", archive, offset + NAME_SIZE)
        start = offset + RESOURCE_HEADER_SIZE
        resources.append(Resource(name, offset, archive[start:start + size]))
    return resources


def walk_chunks(payload: bytes, start: int = 0, end: int | None = None, prefix: str = "") -> list[Chunk]:
    end = len(payload) if end is None else end
    chunks = []
    pos = start
    while pos < end:
        if pos + 8 > end:
            raise ValueError(f"{end - pos} stray bytes in {prefix or 'top level'} at {pos}")
        (raw_size,) = struct.unpack_from("<I", payload, pos + 4)
        chunk = Chunk(prefix + payload[pos:pos + 4].decode("latin1"), pos + 8, raw_size & SIZE_MASK, bool(raw_size & CONTAINER_FLAG))
        if chunk.body_offset + chunk.size > end:
            raise ValueError(f"{chunk.path} at {pos} overruns its parent")
        chunks.append(chunk)
        if chunk.container:
            chunks.extend(walk_chunks(payload, chunk.body_offset, chunk.body_offset + chunk.size, chunk.path))
        pos = chunk.body_offset + chunk.size
    return chunks


def compressed_chunks(resources: list[Resource]) -> list[tuple[Resource, Chunk]]:
    return [
        (resource, chunk)
        for resource in resources
        if resource.name[-4:] in CHUNKED_TYPES
        for chunk in walk_chunks(resource.payload)
        if chunk.path in COMPRESSED_CHUNKS
    ]
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_corpus.py' -v`
Expected: 4 tests pass.

- [x] **Action 8: Commit**

```bash
git add scripts/re/unicorn/corpus.py scripts/re/unicorn/test_corpus.py
git commit -m "feat(re): Python walker for RESOURCE.001 resources and chunk trees"
```

- [x] **Action 9: Write the failing original-decompressor tests**

The expected outputs below are predictions from a first reading. **The original is ground truth.** If a case fails, first rule out a harness bug (wrong argument order, a missing replacement, a handler returning the wrong register). If the harness is right, change the expected value to what the original produced and keep going. Action 13 records the final values for step 2.

Create `scripts/re/unicorn/test_original_decompress.py`:

```python
import struct
import unittest
from pathlib import Path

from corpus import compressed_chunks, load_resources
from ne_image import NeImage
from original_decompress import OpenFailed, chunk_body, decompress_original, pack_codes

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
BINARY = DATA / "SCRANTIC.SCR"

RLE = 1
LZW = 2


def width_growth_codes() -> list[tuple[int, int]]:
    return [(65, 9), *((code, 9) for code in range(257, 512)), (512, 10)]


# name -> (chunk body, expected original output)
EDGE_CASES = {
    "rle literal": (chunk_body(RLE, 3, bytes([0x03, 1, 2, 3])), bytes([1, 2, 3])),
    "rle run": (chunk_body(RLE, 3, bytes([0x83, 0xAA])), bytes([0xAA] * 3)),
    "rle zero run": (chunk_body(RLE, 2, bytes([0x80, 0xFF, 0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle zero literal": (chunk_body(RLE, 2, bytes([0x00, 0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle truncated": (chunk_body(RLE, 5, bytes([0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle run past size": (chunk_body(RLE, 2, bytes([0x85, 0xAA])), bytes([0xAA] * 2)),
    "lzw new entry": (chunk_body(LZW, 4, pack_codes([(65, 9), (66, 9), (257, 9)])), b"ABAB"),
    "lzw kwkwk": (chunk_body(LZW, 3, pack_codes([(65, 9), (257, 9)])), b"AAA"),
    "lzw truncated": (chunk_body(LZW, 10, pack_codes([(65, 9), (66, 9)])), b"AB"),
    "lzw clear": (chunk_body(LZW, 2, pack_codes([(65, 9), (256, 9), (0, 54), (66, 9)])), b"AB"),
    "lzw width growth": (chunk_body(LZW, 33153, pack_codes(width_growth_codes())), b"A" * 33153),
}


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class OriginalDecompressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_edge_cases(self):
        # SCRANTIC 1028:0615 1028:0a0d 1028:0875
        for name, (body, expected) in EDGE_CASES.items():
            with self.subTest(name):
                self.assertEqual(decompress_original(self.image, body, 0, len(body)), expected)

    def test_unknown_method_fails_to_open(self):
        # SCRANTIC 1028:0547
        body = chunk_body(3, 1, b"\x00")
        with self.assertRaises(OpenFailed):
            decompress_original(self.image, body, 0, len(body))

    def test_first_corpus_chunk_of_each_method_decompresses_fully(self):
        firsts = {}
        for resource, chunk in compressed_chunks(load_resources(DATA)):
            firsts.setdefault(resource.payload[chunk.body_offset], (resource, chunk))
        self.assertEqual(sorted(firsts), [RLE, LZW])
        for resource, chunk in firsts.values():
            with self.subTest(f"{resource.name} {chunk.path}"):
                (size,) = struct.unpack_from("<I", resource.payload, chunk.body_offset + 1)
                output = decompress_original(self.image, resource.payload, chunk.body_offset, chunk.size)
                self.assertEqual(len(output), size)


if __name__ == "__main__":
    unittest.main()
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_decompress.py' -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'original_decompress'`.

- [x] **Action 10: Implement `original_decompress.py`**

Create `scripts/re/unicorn/original_decompress.py`:

```python
import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage

OPEN_STREAM = "1028:0615"
READ_STREAM = "1028:0a0d"
CLOSE_STREAM = "1028:0875"
FILE_READ = "1018:1287"
FILE_GETC = "1018:14e9"
FILE_SEEK = "1018:1398"
FILE_TELL = "1018:1475"
NEAR_CALLOC = "1038:06a8"
FAR_ALLOC = "1030:199a"
FAR_FREE = "1030:1b63"
READ_MODE = 0x2620
FILE_HANDLE = 7
READ_STEP = 0x8000
FAILED = 0xFFFF


class OpenFailed(Exception):
    pass


@dataclass
class VirtualFile:
    data: bytes
    pos: int


def chunk_body(method: int, size: int, data: bytes) -> bytes:
    return bytes([method]) + struct.pack("<I", size) + data


def pack_codes(codes: list[tuple[int, int]]) -> bytes:
    out = bytearray()
    acc = held = 0
    for code, bits in codes:
        acc |= code << held
        held += bits
        while held >= 8:
            out.append(acc & 0xFF)
            acc >>= 8
            held -= 8
    if held:
        out.append(acc & 0xFF)
    return bytes(out)


def decompress_original(image: NeImage, data: bytes, body_offset: int, body_size: int) -> bytes:
    emu = Emulator(image)
    _install_heap(emu)
    _install_file(emu, VirtualFile(data, body_offset))
    (size,) = struct.unpack_from("<I", data, body_offset + 1)
    stream = emu.call_far(OPEN_STREAM, stack_words=[body_size >> 16, body_size & 0xFFFF, READ_MODE, FILE_HANDLE, 0])["ax"]
    if stream == FAILED:
        raise OpenFailed(f"method {data[body_offset]} did not open")
    out_segment, _ = emu.alloc(size)
    produced = 0
    while produced < size:
        step = min(READ_STEP, size - produced)
        got = emu.call_far(READ_STREAM, stack_words=[step, out_segment + produced // 16, 0, stream])["ax"]
        if got == FAILED:
            raise RuntimeError(f"stream {stream} read failed after {produced} bytes")
        produced += got
        if got < step:
            break
    emu.call_far(CLOSE_STREAM, stack_words=[stream])
    return emu.read(out_segment, 0, produced)


def _install_heap(emu: Emulator):
    def near_calloc(emu: Emulator):
        size = emu.arg(0) * emu.arg(1)
        offset = emu.near_alloc(size)
        emu.write(emu.data_segment, offset, bytes(size))
        return {"ax": offset}

    def far_alloc(emu: Emulator):
        segment, offset = emu.alloc(emu.arg(0) | emu.arg(1) << 16)
        return {"ax": offset, "dx": segment}

    emu.replace_function(NEAR_CALLOC, near_calloc)
    emu.replace_function(FAR_ALLOC, far_alloc)
    emu.replace_function(FAR_FREE, lambda emu: {"ax": 1})


def _install_file(emu: Emulator, file: VirtualFile):
    def expect_handle(handle: int):
        if handle != FILE_HANDLE:
            raise RuntimeError(f"file call with handle {handle:#x}, argument layout is wrong")

    def read(emu: Emulator):
        expect_handle(emu.arg(3))
        buf, size, count = emu.arg(0), emu.arg(1), emu.arg(2)
        data = file.data[file.pos:file.pos + size * count]
        file.pos += len(data)
        emu.write(emu.data_segment, buf, data)
        return {"ax": len(data) // size if size else 0}

    def getc(emu: Emulator):
        expect_handle(emu.arg(0))
        if file.pos >= len(file.data):
            return {"ax": FAILED}
        file.pos += 1
        return {"ax": file.data[file.pos - 1]}

    def seek(emu: Emulator):
        expect_handle(emu.arg(0))
        (offset,) = struct.unpack("<i", struct.pack("<HH", emu.arg(1), emu.arg(2)))
        file.pos = {0: 0, 1: file.pos, 2: len(file.data)}[emu.arg(3)] + offset
        return {"ax": 0, "dx": 0}

    def tell(emu: Emulator):
        expect_handle(emu.arg(0))
        return {"ax": file.pos & 0xFFFF, "dx": file.pos >> 16}

    for address, handler in ((FILE_READ, read), (FILE_GETC, getc), (FILE_SEEK, seek), (FILE_TELL, tell)):
        emu.replace_function(address, handler)
```

- [x] **Action 11: Run and debug until the harness is right**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_decompress.py' -v`

Work through failures in this order:

1. `UnstubbedImport` or `EmulationLimit`: the code reached a function we did not replace. Find the caller chain in `re/out/index.tsv` (callers and callees columns) and read the callee's `.asm` in `re/out/functions/`. If it is a Windows import or a free/alloc routine, replace the nearest internal function with a handler (a free becomes `lambda emu: {"ax": 1}`). Read `1028:048e` and `1028:0478` first; they free the stream on close.
2. `RuntimeError: file call with handle ...`: the argument layout of that file function differs from the overview's table. Read the first lines of its `.asm` (`[BP+6]` is argument 0, `[BP+8]` argument 1, ...) and fix the handler.
3. `OpenFailed` on a valid method: read `1028:0615` and `1028:0547` asm for the condition that returns `0xFFFF`.
4. Wrong output on an edge case: once 1 to 3 are clean, the original's output is the truth. Update `EDGE_CASES` to the original's output.

Expected at the end: all three tests pass.

- [x] **Action 12: Write the fixture dumper**

Create `scripts/re/unicorn/dump_decompressed.py`:

```python
import argparse
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import compressed_chunks, load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_decompress import decompress_original  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/decompressed"
HEADER = ["resource", "chunk", "bodyOffset", "method", "size", "produced", "file"]


def describe(data: bytes) -> str:
    if len(data) > 8 and len(set(data)) == 1:
        return f"`{data[0]:02x}` × {len(data)}"
    return f"`{data.hex(' ')}`"


def print_edge_cases(image: NeImage):
    from test_original_decompress import EDGE_CASES

    print("| Case | Body | Original output |")
    print("| --- | --- | --- |")
    for name, (body, _) in EDGE_CASES.items():
        shown = describe(body) if len(body) <= 40 else f"{len(body)} bytes, see `scripts/re/unicorn/test_original_decompress.py`"
        print(f"| {name} | {shown} | {describe(decompress_original(image, body, 0, len(body)))} |")


def dump_corpus(image: NeImage) -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    short = 0
    for resource, chunk in compressed_chunks(load_resources(DATA)):
        (size,) = struct.unpack_from("<I", resource.payload, chunk.body_offset + 1)
        output = decompress_original(image, resource.payload, chunk.body_offset, chunk.size)
        file = f"{resource.name}.{chunk.path.replace(':', '')}.bin"
        (OUT / file).write_bytes(output)
        rows.append([resource.name, chunk.path, chunk.body_offset, resource.payload[chunk.body_offset], size, len(output), file])
        short += len(output) != size
        print(f"{resource.name} {chunk.path}: {len(output)}/{size}", file=sys.stderr)
    lines = ["\t".join(HEADER), *("\t".join(str(value) for value in row) for row in rows)]
    (OUT / "index.tsv").write_text("\n".join(lines) + "\n")
    print(f"{len(rows)} chunks, {short} short", file=sys.stderr)
    return 1 if short else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the original SCRANTIC.SCR decompressor on test inputs or the whole corpus")
    parser.add_argument("--edge-cases", action="store_true", help="print the edge-case table for docs/re/resources.md")
    args = parser.parse_args()
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    if args.edge_cases:
        print_edge_cases(image)
        return 0
    return dump_corpus(image)


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_decompressed.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py`
Expected: last line `180 chunks, 0 short`, exit code 0. It may take a few minutes. If some chunks are short, that is a real finding or a harness bug: debug one short chunk with the Action 11 checklist. If the original truly stops short on real data, keep the fixture as is and write the finding in Action 13.

Run: `ls re/fixtures/decompressed`
Expected: `index.tsv` plus 180 `.bin` files.

- [x] **Action 13: Write `docs/re/resources.md`**

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py --edge-cases`
Expected: a markdown table, one row per edge case.

Create `docs/re/resources.md` with this skeleton. Fill `Compressed stream` with what you confirmed while making the harness work (one claim per bullet, each starting with its address, in your own words): argument order and meaning of `1028:0615`, `1028:0a0d`, `1028:0875`; read mode detection; where the method byte and uncompressed size come from; what `length` is; what open returns on failure; which functions free memory on close; any argument layout that differed from the overview's table. Paste the edge-case table under `Emulated edge cases`.

```markdown
# Resources: Archive, Map, and Decompression

Findings for chunk 2. One claim per address. Our own words; no decompiled code.

## Compressed stream

- `1028:0615`: ...

## Emulated edge cases

Outputs of the original decompressor run in Unicorn by `scripts/re/unicorn/dump_decompressed.py --edge-cases`. Bodies are chunk bodies: method byte, u32 uncompressed size, data. LZW bodies are built by `pack_codes` (LSB-first codes) in `scripts/re/unicorn/original_decompress.py`.

| Case | Body | Original output |
| --- | --- | --- |

## Method table

## RLE

## LZW

## Map and archive

## Name hash

## File layer

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
```

Leave the empty sections for steps 2 and 3.

- [x] **Action 14: Name the functions this step relies on**

Add these entries to `scripts/re/names.json` (status `named`, `signature` and `callingConvention` `null`), keeping the file sorted by address. Rewrite the notes if what you saw differs:

| Address | Name | Note |
| --- | --- | --- |
| `1018:1287` | `resources_readFile` | fread-like read from an open resource file: buffer, item size, count, handle |
| `1018:1398` | `resources_seekFile` | fseek-like seek on an open resource file: handle, 32-bit offset, whence |
| `1018:1475` | `resources_tellFile` | ftell-like position of an open resource file, returned in DX:AX |
| `1018:14e9` | `resources_getFileByte` | getc-like read of one byte from an open resource file, 0xFFFF at end |
| `1028:0615` | `resources_openStream` | Opens a decompression stream on a file at a chunk body; read mode takes the method byte and u32 size from the file |
| `1028:076c` | `resources_openMemoryStream` | Same as resources_openStream over a far memory buffer; never called |
| `1028:0875` | `resources_closeStream` | Closes a decompression stream and frees its buffers |
| `1028:0a0d` | `resources_readStream` | Reads up to count decompressed bytes into a far buffer; returns the count produced |
| `1030:199a` | `platform_farAlloc` | Allocates a far block of a 32-bit size with flags; returns DX:AX |
| `1030:1b63` | `platform_farFree` | Frees a far block |
| `1038:06a8` | `platform_nearCalloc` | Zeroed near allocation of count times size bytes |

Run: `node scripts/re/function-map.mjs`
Expected: no errors; `docs/re/function-map.md` regenerated.

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`. The new names now appear in `re/out/index.tsv` and the `.c` file names.

Note: after the re-import, `re/out/functions/` file names change for renamed functions (e.g. `1028_0615_resources_openStream.c`). The harness uses addresses only, so nothing breaks.

- [x] **Action 15: Update the Unicorn README**

Append to `scripts/re/unicorn/README.md`:

```markdown
## Replacing internal functions

    emu.replace_function("1018:14e9", lambda emu: {"ax": next_byte()})

Patches the function entry with a far jump to a stub slot, so the handler runs instead. `emu.arg(i)` reads argument `i` of a far cdecl function (`[BP+6]` is argument 0). Caller-pops functions keep `arg_bytes=0`. `emu.near_alloc(size)` returns zeroed DS offsets above the data segment's static data.

## Original decompressor

    re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py --edge-cases

The first runs `1028:0615` / `1028:0a0d` / `1028:0875` on every compressed chunk in `RESOURCE.001` and writes the output to `re/fixtures/decompressed/` (gitignored), with `index.tsv` listing resource, chunk path, body offset, method, header size, bytes produced, and file. The second prints the edge-case table kept in `docs/re/resources.md`. The file layer (`1018:1287`, `1018:14e9`, `1018:1398`, `1018:1475`) and allocators (`1038:06a8`, `1030:199a`, `1030:1b63`) are replaced by Python handlers in `original_decompress.py`.
```

- [x] **Action 16: Run every check**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

Run: `fnm use`, then `pnpm test`
Expected: all pass (the export test confirms every `names.json` entry was applied).

- [x] **Action 17: Commit**

```bash
git add scripts/re/unicorn/original_decompress.py scripts/re/unicorn/test_original_decompress.py scripts/re/unicorn/dump_decompressed.py scripts/re/unicorn/README.md scripts/re/names.json docs/re/function-map.md docs/re/resources.md
git commit -m "feat(re): run the original SCRANTIC decompressor on edge cases and the whole corpus"
```

Check `git status` first: nothing under `re/` may be staged.

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
