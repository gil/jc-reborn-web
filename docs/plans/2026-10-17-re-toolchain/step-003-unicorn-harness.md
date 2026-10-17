# Step 3: Unicorn Harness for Single Original Functions

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ghidra-import-export.md` (`.gitignore` has `re/`; one test compares against `re/out/relocations.tsv` and skips without it)

**Files:**

- Modify: `.gitignore` (add `__pycache__/`)
- Create: `scripts/re/unicorn/requirements.txt`
- Create: `scripts/re/unicorn/ne_image.py`
- Create: `scripts/re/unicorn/emulator.py`
- Create: `scripts/re/unicorn/README.md`
- Test: `scripts/re/unicorn/test_ne_image.py`
- Test: `scripts/re/unicorn/test_emulator.py`

**Interfaces:**

- Consumes: `public/data/SCRANTIC.SCR`. Optional `re/out/relocations.tsv` (header `address	type	values`, one row per relocation record, `address` = Ghidra address of the record's first site).
- Produces (used by chunks 2, 3, 5):
  - `ne_image.NeImage.load(path) -> NeImage` with `segments: list[Segment]`, `modules: list[str]`, `auto_data_segment: int`, `entry_points: dict[int, InternalTarget]`.
  - `ne_image.Segment(index, data, flags, min_alloc, relocations)`, `ne_image.Relocation(source_type, additive, offset, target)`, `ne_image.InternalTarget(segment, offset)`, `ne_image.ImportTarget(module, ordinal)`.
  - `emulator.Emulator(image)` with:
    - `call_far(address: str | tuple[int, int], regs: dict[str, int] | None = None, stack_words: Sequence[int] = (), instruction_limit: int = ...) -> dict[str, int]`. `address` is a Ghidra address like `"1000:0302"` or an emulator `(paragraph, offset)` pair. `stack_words` are listed in push order. Returns all registers after the far return.
    - `far(address: str) -> tuple[int, int]`, `import_address(module: str, ordinal: int) -> tuple[int, int]`
    - `add_stub(module, ordinal, handler, arg_bytes)`. `handler(emu) -> dict[str, int] | None` returns registers to set. `arg_bytes` = bytes the callee pops (Win16 APIs are Pascal: callee pops).
    - `alloc(size) -> tuple[int, int]`, `read(segment, offset, size) -> bytes`, `write(segment, offset, data)`, `reg(name) -> int`, `set_regs(**values)`
    - `paragraphs: dict[int, int]` (NE segment index → real-mode paragraph), `fixup_sites: list[tuple[int, int, Relocation]]`
  - Exceptions: `emulator.UnstubbedImport` (has `.target`), `emulator.EmulationLimit`.
  - Constants: `emulator.INITIAL_SP`.

## How the harness works

The code is 16-bit protected mode, but nothing in chunks 2 and 3 needs real selectors. So the harness runs in x86 **real mode**: each NE segment gets its own paragraph (16-byte unit), and a segment register value is that paragraph. Code segments are packed one after another from paragraph `0x0100`. The auto data segment gets a full 64 KB. A stub segment follows. Everything after that, up to 1 MB, is a bump-allocated heap.

Relocations are applied the way the Windows loader does: internal references get the target segment's paragraph and offset, imports get a far pointer into the stub segment, and `__AHSHIFT` / `__AHINCR` get the real-mode values `12` / `0x1000`, so huge-pointer math works. Non-additive records patch a chain of sites. Each site holds the offset of the next one, ending at `0xFFFF`.

Every stub slot holds `RETF` (`0xCB`). A code hook on the stub segment runs the Python handler, then shifts the return address up by `arg_bytes` so the `RETF` also drops the arguments. Calling an import with no stub raises `UnstubbedImport`.

`call_far` pushes a return address that points at a sentinel (stub offset 0) and runs until the linear PC equals the sentinel. If the limit runs out first, it raises `EmulationLimit`.

- [x] **Action 1: Create the venv and install Unicorn**

Create `scripts/re/unicorn/requirements.txt`:

```
unicorn==2.1.4
```

Run: `python3 -m venv re/.venv`
Run: `re/.venv/bin/pip install -r scripts/re/unicorn/requirements.txt`
Expected: `Successfully installed unicorn-2.1.4`.

Run: `re/.venv/bin/python -I -c "import unicorn; print(unicorn.__version__)"`
Expected: `2.1.4`

- [x] **Action 2: Write the failing NE parser tests**

Create `scripts/re/unicorn/test_ne_image.py`. The expected numbers come from "Binary facts" in the overview.

```python
import csv
import unittest
from pathlib import Path

from ne_image import ImportTarget, NeImage

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
GHIDRA_RELOCATIONS = REPO / "re/out/relocations.tsv"

RELOCATIONS_PER_SEGMENT = [27, 250, 89, 134, 54, 59, 205, 206, 107, 33, 49, 104, 19, 10]


def ghidra_address(segment: int, offset: int) -> str:
    return f"{0x1000 + (segment - 1) * 8:04x}:{offset:04x}"


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class NeImageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_header(self):
        self.assertEqual(len(self.image.segments), 14)
        self.assertEqual(self.image.auto_data_segment, 14)
        self.assertEqual(self.image.modules, ["MMSYSTEM", "GDI", "KERNEL", "USER"])
        self.assertEqual(len(self.image.entry_points), 5)

    def test_segment_sizes(self):
        self.assertEqual(len(self.image.segments[0].data), 0x28A9)
        self.assertEqual(len(self.image.segments[13].data), 0x47C0)
        self.assertTrue(self.image.segments[13].is_data)
        self.assertFalse(self.image.segments[0].is_data)

    def test_relocation_counts(self):
        self.assertEqual([len(s.relocations) for s in self.image.segments], RELOCATIONS_PER_SEGMENT)

    def test_imports_resolve_to_named_modules(self):
        imports = {r.target for s in self.image.segments for r in s.relocations if isinstance(r.target, ImportTarget)}
        self.assertIn(ImportTarget("KERNEL", 113), imports)
        self.assertIn(ImportTarget("KERNEL", 91), imports)

    @unittest.skipUnless(GHIDRA_RELOCATIONS.exists(), "needs scripts/re/ghidra-import.sh output")
    def test_relocation_sites_match_ghidra(self):
        with GHIDRA_RELOCATIONS.open() as f:
            ghidra = {row["address"] for row in csv.DictReader(f, delimiter="\t")}
        ours = {ghidra_address(s.index, r.offset) for s in self.image.segments for r in s.relocations}
        self.assertEqual(ours, ghidra)


if __name__ == "__main__":
    unittest.main()
```

- [x] **Action 3: Run the tests, confirm they fail**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_ne_image.py' -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'ne_image'`.

- [x] **Action 4: Write `scripts/re/unicorn/ne_image.py`**

NE format reference: segment table entries are 8 bytes (sector, length, flags, min alloc). A length or min alloc of 0 means 64 KB. Relocation records follow the segment data: a `u16` count, then 8-byte records (source type, flags, offset, two target words). The entry table is a list of bundles: count, type (`0` unused, `0xFF` movable with 6-byte entries, else a fixed segment number with 3-byte entries).

```python
import struct
from dataclasses import dataclass, field
from pathlib import Path

SEG_FLAG_DATA = 0x0001
SEG_FLAG_HAS_RELOCATIONS = 0x0100

SRC_LOBYTE = 0
SRC_SELECTOR = 2
SRC_FAR_ADDR = 3
SRC_OFFSET = 5

TARGET_INTERNAL = 0
TARGET_IMPORT_ORDINAL = 1
TARGET_KIND_MASK = 0x03
FLAG_ADDITIVE = 0x04

MOVABLE_SEGMENT = 0xFF
FULL_SEGMENT = 0x10000


@dataclass(frozen=True)
class InternalTarget:
    segment: int
    offset: int


@dataclass(frozen=True)
class ImportTarget:
    module: str
    ordinal: int


@dataclass(frozen=True)
class Relocation:
    source_type: int
    additive: bool
    offset: int
    target: InternalTarget | ImportTarget


@dataclass
class Segment:
    index: int
    data: bytes
    flags: int
    min_alloc: int
    relocations: list[Relocation] = field(default_factory=list)

    @property
    def is_data(self) -> bool:
        return bool(self.flags & SEG_FLAG_DATA)


@dataclass
class NeImage:
    segments: list[Segment]
    modules: list[str]
    auto_data_segment: int
    entry_points: dict[int, InternalTarget]

    @classmethod
    def load(cls, path: str | Path) -> "NeImage":
        return parse(Path(path).read_bytes())


def parse(raw: bytes) -> NeImage:
    ne = struct.unpack_from("<I", raw, 0x3C)[0]
    if raw[ne : ne + 2] != b"NE":
        raise ValueError("not an NE executable")

    def header_u16(relative: int) -> int:
        return struct.unpack_from("<H", raw, ne + relative)[0]

    modules = []
    for i in range(header_u16(0x1E)):
        name_offset = struct.unpack_from("<H", raw, ne + header_u16(0x28) + 2 * i)[0]
        modules.append(_pascal_string(raw, ne + header_u16(0x2A) + name_offset))

    alignment_shift = header_u16(0x32)
    segments = []
    for i in range(header_u16(0x1C)):
        sector, length, flags, min_alloc = struct.unpack_from("<HHHH", raw, ne + header_u16(0x22) + 8 * i)
        start = sector << alignment_shift
        length = (length or FULL_SEGMENT) if sector else 0
        relocations = _parse_relocations(raw, start + length, modules) if flags & SEG_FLAG_HAS_RELOCATIONS else []
        segments.append(Segment(i + 1, raw[start : start + length], flags, min_alloc or FULL_SEGMENT, relocations))

    entry_points = _parse_entry_table(raw, ne + header_u16(0x04), header_u16(0x06))
    return NeImage(segments, modules, header_u16(0x0E), entry_points)


def _pascal_string(raw: bytes, pos: int) -> str:
    return raw[pos + 1 : pos + 1 + raw[pos]].decode("ascii")


def _parse_relocations(raw: bytes, pos: int, modules: list[str]) -> list[Relocation]:
    count = struct.unpack_from("<H", raw, pos)[0]
    relocations = []
    for i in range(count):
        source_type, flags, offset, word1, word2 = struct.unpack_from("<BBHHH", raw, pos + 2 + 8 * i)
        kind = flags & TARGET_KIND_MASK
        if kind == TARGET_INTERNAL:
            target = InternalTarget(word1 & 0xFF, word2)
        elif kind == TARGET_IMPORT_ORDINAL:
            target = ImportTarget(modules[word1 - 1], word2)
        else:
            raise NotImplementedError(f"relocation target kind {kind}")
        relocations.append(Relocation(source_type, bool(flags & FLAG_ADDITIVE), offset, target))
    return relocations


def _parse_entry_table(raw: bytes, pos: int, length: int) -> dict[int, InternalTarget]:
    end = pos + length
    entries = {}
    ordinal = 1
    while pos < end:
        count, kind = raw[pos], raw[pos + 1]
        pos += 2
        if count == 0:
            break
        if kind == 0:
            ordinal += count
            continue
        for _ in range(count):
            if kind == MOVABLE_SEGMENT:
                segment, offset = raw[pos + 3], struct.unpack_from("<H", raw, pos + 4)[0]
                pos += 6
            else:
                segment, offset = kind, struct.unpack_from("<H", raw, pos + 1)[0]
                pos += 3
            entries[ordinal] = InternalTarget(segment, offset)
            ordinal += 1
    return entries
```

- [x] **Action 5: Run the NE tests, confirm they pass**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_ne_image.py' -v`
Expected: 5 tests OK. `test_relocation_sites_match_ghidra` is skipped if `re/out/relocations.tsv` is missing. If it is missing, run `scripts/re/ghidra-import.sh` first and re-run, so the check really runs.

- [x] **Action 6: Commit**

```bash
git add scripts/re/unicorn/requirements.txt scripts/re/unicorn/ne_image.py scripts/re/unicorn/test_ne_image.py
git commit -m "feat(re): NE image parser for SCRANTIC.SCR, checked against Ghidra relocations"
```

- [x] **Action 7: Write the failing emulator tests**

Create `scripts/re/unicorn/test_emulator.py`. The two runtime library functions are described under "Binary facts" in the overview.

```python
import random
import struct
import unittest
from pathlib import Path

from emulator import INITIAL_SP, Emulator, UnstubbedImport
from ne_image import SRC_FAR_ADDR, ImportTarget, NeImage

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class EmulatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def setUp(self):
        self.emu = Emulator(self.image)

    def test_import_far_pointers_point_at_their_stub(self):
        checked = 0
        for segment, site, relocation in self.emu.fixup_sites:
            if relocation.source_type != SRC_FAR_ADDR or not isinstance(relocation.target, ImportTarget):
                continue
            offset, paragraph = struct.unpack("<HH", self.emu.read(self.emu.paragraphs[segment], site, 4))
            self.assertEqual((paragraph, offset), self.emu.import_address(relocation.target.module, relocation.target.ordinal))
            checked += 1
        self.assertGreater(checked, 100)

    def test_ahshift_sites_hold_the_real_mode_shift(self):
        sites = [(s, o) for s, o, r in self.emu.fixup_sites if r.target == ImportTarget("KERNEL", 113)]
        self.assertTrue(sites)
        for segment, site in sites:
            self.assertEqual(struct.unpack("<H", self.emu.read(self.emu.paragraphs[segment], site, 2))[0], 12)

    def test_rtl_lxmul_matches_python(self):
        # SCRANTIC 1000:0302
        rng = random.Random(1992)
        for _ in range(200):
            a, b = rng.getrandbits(32), rng.getrandbits(32)
            regs = self.emu.call_far(
                "1000:0302",
                regs={"ax": a & 0xFFFF, "dx": a >> 16, "bx": b & 0xFFFF, "cx": b >> 16},
            )
            self.assertEqual((regs["dx"] << 16) | regs["ax"], (a * b) & 0xFFFFFFFF, f"{a:#x} * {b:#x}")

    def test_rtl_scopy_copies_and_pops_its_arguments(self):
        # SCRANTIC 1000:033a
        payload = b"Johnny 1992!!"
        src_segment, src_offset = self.emu.alloc(len(payload))
        dst_segment, dst_offset = self.emu.alloc(len(payload))
        self.emu.write(src_segment, src_offset, payload)
        regs = self.emu.call_far(
            "1000:033a",
            regs={"cx": len(payload)},
            stack_words=[dst_segment, dst_offset, src_segment, src_offset],
        )
        self.assertEqual(self.emu.read(dst_segment, dst_offset, len(payload)), payload)
        self.assertEqual(regs["sp"], INITIAL_SP)

    def test_stub_sets_registers_and_pops_arguments(self):
        self.emu.add_stub("KERNEL", 18, lambda emu: {"ax": 0x1234, "dx": 0x5678}, arg_bytes=2)
        regs = self.emu.call_far(self.emu.import_address("KERNEL", 18), stack_words=[0xBEEF])
        self.assertEqual((regs["ax"], regs["dx"]), (0x1234, 0x5678))
        self.assertEqual(regs["sp"], INITIAL_SP)

    def test_unstubbed_import_raises(self):
        with self.assertRaises(UnstubbedImport) as raised:
            self.emu.call_far(self.emu.import_address("KERNEL", 15))
        self.assertEqual(raised.exception.target, ImportTarget("KERNEL", 15))


if __name__ == "__main__":
    unittest.main()
```

- [x] **Action 8: Run the emulator tests, confirm they fail**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_emulator.py' -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'emulator'`.

- [x] **Action 9: Write `scripts/re/unicorn/emulator.py`**

```python
import struct
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from unicorn import UC_ARCH_X86, UC_HOOK_CODE, UC_MODE_16, Uc
from unicorn.x86_const import (
    UC_X86_REG_AX,
    UC_X86_REG_BP,
    UC_X86_REG_BX,
    UC_X86_REG_CS,
    UC_X86_REG_CX,
    UC_X86_REG_DI,
    UC_X86_REG_DS,
    UC_X86_REG_DX,
    UC_X86_REG_ES,
    UC_X86_REG_FLAGS,
    UC_X86_REG_IP,
    UC_X86_REG_SI,
    UC_X86_REG_SP,
    UC_X86_REG_SS,
)

from ne_image import (
    MOVABLE_SEGMENT,
    SRC_FAR_ADDR,
    SRC_LOBYTE,
    SRC_OFFSET,
    SRC_SELECTOR,
    ImportTarget,
    InternalTarget,
    NeImage,
    Relocation,
    Segment,
)

MEMORY_SIZE = 0x100000
FIRST_PARAGRAPH = 0x0100
AUTO_DATA_SIZE = 0x10000
STUB_SEGMENT_SIZE = 0x1000
SENTINEL_OFFSET = 0
INITIAL_SP = 0xFFFE
DEFAULT_INSTRUCTION_LIMIT = 50_000_000
RETF = 0xCB

REAL_MODE_CONSTANTS = {
    ImportTarget("KERNEL", 113): 12,
    ImportTarget("KERNEL", 114): 0x1000,
}

REGISTERS = {
    "ax": UC_X86_REG_AX,
    "bx": UC_X86_REG_BX,
    "cx": UC_X86_REG_CX,
    "dx": UC_X86_REG_DX,
    "si": UC_X86_REG_SI,
    "di": UC_X86_REG_DI,
    "bp": UC_X86_REG_BP,
    "sp": UC_X86_REG_SP,
    "cs": UC_X86_REG_CS,
    "ds": UC_X86_REG_DS,
    "es": UC_X86_REG_ES,
    "ss": UC_X86_REG_SS,
    "ip": UC_X86_REG_IP,
    "flags": UC_X86_REG_FLAGS,
}


class UnstubbedImport(Exception):
    def __init__(self, target: ImportTarget):
        super().__init__(f"no stub for {target.module} ordinal {target.ordinal}")
        self.target = target


class EmulationLimit(Exception):
    pass


@dataclass
class Stub:
    handler: Callable[["Emulator"], dict[str, int] | None]
    arg_bytes: int


def ghidra_selector_to_segment(selector: int) -> int:
    return (selector - 0x1000) // 8 + 1


class Emulator:
    def __init__(self, image: NeImage):
        self.image = image
        self.uc = Uc(UC_ARCH_X86, UC_MODE_16)
        self.uc.mem_map(0, MEMORY_SIZE)
        self.paragraphs: dict[int, int] = {}
        self.fixup_sites: list[tuple[int, int, Relocation]] = []
        self.stubs: dict[ImportTarget, Stub] = {}
        self._import_offsets: dict[ImportTarget, int] = {}
        self._imports_by_offset: dict[int, ImportTarget] = {}

        paragraph = FIRST_PARAGRAPH
        for segment in image.segments:
            self.paragraphs[segment.index] = paragraph
            self.uc.mem_write(paragraph * 16, segment.data)
            size = AUTO_DATA_SIZE if segment.index == image.auto_data_segment else max(len(segment.data), segment.min_alloc)
            paragraph += (size + 15) // 16
        self.stub_paragraph = paragraph
        self._heap_paragraph = paragraph + STUB_SEGMENT_SIZE // 16

        self.uc.mem_write(self.stub_paragraph * 16, bytes([RETF]) * STUB_SEGMENT_SIZE)
        for segment in image.segments:
            self._apply_relocations(segment)
        stub_base = self.stub_paragraph * 16
        self.uc.hook_add(UC_HOOK_CODE, self._on_stub, begin=stub_base, end=stub_base + STUB_SEGMENT_SIZE - 1)

    def far(self, address: str) -> tuple[int, int]:
        selector, offset = (int(part, 16) for part in address.split(":"))
        return self.paragraphs[ghidra_selector_to_segment(selector)], offset

    def import_address(self, module: str, ordinal: int) -> tuple[int, int]:
        return self.stub_paragraph, self._import_offset(ImportTarget(module, ordinal))

    def add_stub(self, module: str, ordinal: int, handler: Callable[["Emulator"], dict[str, int] | None], arg_bytes: int):
        self.stubs[ImportTarget(module, ordinal)] = Stub(handler, arg_bytes)

    def alloc(self, size: int) -> tuple[int, int]:
        paragraph = self._heap_paragraph
        self._heap_paragraph += (size + 15) // 16
        if self._heap_paragraph * 16 > MEMORY_SIZE:
            raise MemoryError(f"emulator heap exhausted allocating {size} bytes")
        return paragraph, 0

    def read(self, segment: int, offset: int, size: int) -> bytes:
        return bytes(self.uc.mem_read(segment * 16 + offset, size))

    def write(self, segment: int, offset: int, data: bytes):
        self.uc.mem_write(segment * 16 + offset, data)

    def reg(self, name: str) -> int:
        return self.uc.reg_read(REGISTERS[name])

    def set_regs(self, **values: int):
        for name, value in values.items():
            self.uc.reg_write(REGISTERS[name], value & 0xFFFF)

    def call_far(
        self,
        address: str | tuple[int, int],
        regs: dict[str, int] | None = None,
        stack_words: Sequence[int] = (),
        instruction_limit: int = DEFAULT_INSTRUCTION_LIMIT,
    ) -> dict[str, int]:
        code_segment, ip = self.far(address) if isinstance(address, str) else address
        data_segment = self.paragraphs[self.image.auto_data_segment]
        self.set_regs(ds=data_segment, es=data_segment, ss=data_segment, sp=INITIAL_SP, bp=0)
        self.set_regs(**(regs or {}))
        for word in [*stack_words, self.stub_paragraph, SENTINEL_OFFSET]:
            self._push(word)
        self.set_regs(cs=code_segment)
        sentinel = self.stub_paragraph * 16 + SENTINEL_OFFSET
        self.uc.emu_start(code_segment * 16 + ip, sentinel, count=instruction_limit)
        if self._linear_pc() != sentinel:
            raise EmulationLimit(f"stopped at {self.reg('cs'):04x}:{self.reg('ip'):04x} without returning")
        return {name: self.reg(name) for name in REGISTERS}

    def _push(self, word: int):
        sp = (self.reg("sp") - 2) & 0xFFFF
        self.set_regs(sp=sp)
        self.write(self.reg("ss"), sp, struct.pack("<H", word & 0xFFFF))

    def _linear_pc(self) -> int:
        return self.reg("cs") * 16 + self.reg("ip")

    def _import_offset(self, target: ImportTarget) -> int:
        if target not in self._import_offsets:
            offset = 2 + 2 * len(self._import_offsets)
            if offset >= STUB_SEGMENT_SIZE:
                raise MemoryError("stub segment full")
            self._import_offsets[target] = offset
            self._imports_by_offset[offset] = target
        return self._import_offsets[target]

    def _on_stub(self, uc, address, size, user_data):
        offset = address - self.stub_paragraph * 16
        if offset == SENTINEL_OFFSET:
            return
        target = self._imports_by_offset[offset]
        stub = self.stubs.get(target)
        if stub is None:
            raise UnstubbedImport(target)
        self.set_regs(**(stub.handler(self) or {}))
        ss, sp = self.reg("ss"), self.reg("sp")
        return_address = self.read(ss, sp, 4)
        sp = (sp + stub.arg_bytes) & 0xFFFF
        self.write(ss, sp, return_address)
        self.set_regs(sp=sp)

    def _apply_relocations(self, segment: Segment):
        base = self.paragraphs[segment.index] * 16
        for relocation in segment.relocations:
            value = self._resolve(relocation.target)
            sites = [relocation.offset] if relocation.additive else self._chain(base, len(segment.data), relocation.offset)
            for site in sites:
                self._patch(base + site, relocation, value)
                self.fixup_sites.append((segment.index, site, relocation))

    def _chain(self, base: int, length: int, head: int) -> list[int]:
        sites = []
        site = head
        while site != 0xFFFF:
            if site + 2 > length or site in sites:
                raise ValueError(f"broken relocation chain at offset {site:#06x}")
            sites.append(site)
            site = struct.unpack("<H", self.uc.mem_read(base + site, 2))[0]
        return sites

    def _resolve(self, target: InternalTarget | ImportTarget) -> int | tuple[int, int]:
        if isinstance(target, ImportTarget):
            if target in REAL_MODE_CONSTANTS:
                return REAL_MODE_CONSTANTS[target]
            return self.stub_paragraph, self._import_offset(target)
        if target.segment == MOVABLE_SEGMENT:
            target = self.image.entry_points[target.offset]
        return self.paragraphs[target.segment], target.offset

    def _patch(self, address: int, relocation: Relocation, value: int | tuple[int, int]):
        if isinstance(value, int):
            if relocation.source_type not in (SRC_OFFSET, SRC_SELECTOR):
                raise NotImplementedError(f"constant import with source type {relocation.source_type}")
            self._write_word(address, value, relocation.additive)
            return
        paragraph, offset = value
        if relocation.source_type == SRC_FAR_ADDR:
            self._write_word(address, offset, relocation.additive)
            self._write_word(address + 2, paragraph, False)
        elif relocation.source_type == SRC_SELECTOR:
            self._write_word(address, paragraph, False)
        elif relocation.source_type == SRC_OFFSET:
            self._write_word(address, offset, relocation.additive)
        elif relocation.source_type == SRC_LOBYTE:
            current = self.uc.mem_read(address, 1)[0] if relocation.additive else 0
            self.uc.mem_write(address, bytes([(current + offset) & 0xFF]))
        else:
            raise NotImplementedError(f"relocation source type {relocation.source_type}")

    def _write_word(self, address: int, value: int, additive: bool):
        if additive:
            value += struct.unpack("<H", self.uc.mem_read(address, 2))[0]
        self.uc.mem_write(address, struct.pack("<H", value & 0xFFFF))
```

- [x] **Action 10: Run the emulator tests, confirm they pass**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_emulator.py' -v`
Expected: 6 tests OK.

If a test hangs, stops early, or `rtl_lxmul` gives wrong values, check these assumptions first. They come from how Unicorn 2.1 runs 16-bit code, and haven't been verified on this machine yet:
- `emu_start(begin, until)` takes **linear** addresses (`segment * 16 + offset`), and sets IP to `begin - CS base`. That's why `call_far` sets CS before `emu_start`.
- `UC_HOOK_CODE` `begin`/`end` and the hook's `address` argument are linear.
- An exception raised inside a hook stops emulation and is re-raised from `emu_start`.

To test an assumption on its own, write a 2-instruction snippet (`mov ax, 0x1234` then `retf`) into `emu.alloc(16)` and call it. Fix `emulator.py` to match what Unicorn really does. Don't weaken the tests.

- [x] **Action 11: Write `scripts/re/unicorn/README.md`**

```markdown
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
```

- [x] **Action 12: Compile-check and run all harness tests**

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/ne_image.py scripts/re/unicorn/emulator.py scripts/re/unicorn/test_ne_image.py scripts/re/unicorn/test_emulator.py`
Expected: no output.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: 11 tests OK, 0 skipped (run `scripts/re/ghidra-import.sh` first if the Ghidra cross-check skips).

Run: `pnpm test`
Expected: all tests pass (nothing on the TS side changed).

- [x] **Action 13: Commit**

Python writes `scripts/re/unicorn/__pycache__/` when the tests import the modules. Append to `.gitignore`:

```
__pycache__/
```

Run: `git status --short`
Expected: nothing under `re/`, no `__pycache__` paths.

```bash
git add .gitignore scripts/re/unicorn/emulator.py scripts/re/unicorn/test_emulator.py scripts/re/unicorn/README.md
git commit -m "feat(re): Unicorn real-mode harness for calling single SCRANTIC.SCR functions"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
