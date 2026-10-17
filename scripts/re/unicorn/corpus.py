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
