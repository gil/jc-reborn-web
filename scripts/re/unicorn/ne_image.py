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
