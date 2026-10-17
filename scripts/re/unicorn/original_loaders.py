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


LOAD_PALETTE = "1040:09eb"
COLOR_MODE = 0x1EBD
SIXTEEN_COLOR_MODE = 2
LOAD_SCREEN = "1030:16d8"
BLIT_PIXEL_ROWS = "1040:0286"


def load_palette_original(image: NeImage, name: str, payload: bytes, color_mode: int = SIXTEEN_COLOR_MODE) -> bytes:
    emu = new_loader_emulator(image, {name: payload})
    emu.write(emu.data_segment, COLOR_MODE, bytes([color_mode]))
    colors = emu.call_far(LOAD_PALETTE, stack_words=[put_string(emu, name)])["ax"]
    if colors == 0:
        raise RuntimeError(f"{name}: palette load failed")
    count = 16 if color_mode == SIXTEEN_COLOR_MODE else 256
    return emu.read(emu.data_segment, colors, count * 3)


@dataclass
class ScreenStrips:
    status: int
    widths: set[int]
    strips: list[tuple[int, int]]
    pixels: bytes


def load_screen_original(image: NeImage, name: str, payload: bytes) -> ScreenStrips:
    emu = new_loader_emulator(image, {name: payload})
    widths: set[int] = set()
    strips: list[tuple[int, int]] = []
    pixels = bytearray()

    def blit(emu: Emulator):
        offset, segment, y, width, rows = emu.arg(0), emu.arg(1), emu.arg(3), emu.arg(4), emu.arg(5)
        widths.add(width)
        strips.append((y, rows))
        pixels.extend(emu.read(segment, offset, rows * (width // 2)))
        return {"ax": 0}

    emu.replace_function(BLIT_PIXEL_ROWS, blit)
    status = emu.call_far(LOAD_SCREEN, stack_words=[put_string(emu, name)])["ax"]
    return ScreenStrips(status, widths, strips, bytes(pixels))


LOAD_BMP = "1030:124a"
BUILD_BITMAPS = "1040:0000"


@dataclass
class BitmapImages:
    widths: list[int]
    heights: list[int]
    packed: bytes


def load_bmp_original(image: NeImage, name: str, payload: bytes) -> BitmapImages:
    emu = new_loader_emulator(image, {name: payload})
    captured: list[BitmapImages] = []

    def build(emu: Emulator):
        records, offset, segment = emu.arg(0), emu.arg(1), emu.arg(2)
        sizes: list[tuple[int, int]] = []
        while (record := read_word(emu, emu.data_segment, records + 2 * len(sizes))) != 0:
            sizes.append((read_word(emu, emu.data_segment, record + 6), read_word(emu, emu.data_segment, record + 8)))
        total = sum((width + 1) // 2 * height for width, height in sizes)
        captured.append(BitmapImages([w for w, _ in sizes], [h for _, h in sizes], emu.read(segment, offset, total)))
        return {"ax": 0}

    emu.replace_function(BUILD_BITMAPS, build)
    handle = emu.call_far(LOAD_BMP, stack_words=[put_string(emu, name)])["ax"]
    if handle == 0 or len(captured) != 1:
        raise RuntimeError(f"{name}: bitmap load returned {handle:#x} after {len(captured)} bitmap builds")
    return captured[0]


LOAD_TTM = "1050:0177"
INDEX_TTM_PAGES = "1050:04d6"
TTM_GLOBALS = 0x2634
TTM_GLOBALS_SIZE = 12
CURRENT_TTM = 0x2638
TTM_TAG_LIST = 0x263C
TAG_NEXT = 0x3B


@dataclass
class TtmIndex:
    status: int
    page_count: int
    page_offsets: list[int]
    tags: list[tuple[int, int]]


def load_ttm_original(image: NeImage, name: str, payload: bytes, ttm_id: int = 1) -> TtmIndex:
    emu = new_loader_emulator(image, {name: payload})
    data = emu.data_segment
    emu.write(data, TTM_GLOBALS, bytes(TTM_GLOBALS_SIZE))
    loaded = emu.call_far(LOAD_TTM, stack_words=[put_string(emu, name)])["ax"]
    if loaded != 1:
        raise RuntimeError(f"{name}: TTM load returned {loaded:#x}")
    record_offset, record_segment = read_word(emu, data, CURRENT_TTM), read_word(emu, data, CURRENT_TTM + 2)
    emu.write(record_segment, record_offset, struct.pack("<H", ttm_id))
    status = emu.call_far(INDEX_TTM_PAGES, stack_words=[ttm_id])["ax"]

    def field(index: int) -> int:
        return read_word(emu, record_segment, record_offset + 2 * index)

    page_count = field(1)
    bytecode = field(3) * 16 + field(2)
    table_offset, table_segment = field(0x68), field(0x69)
    page_offsets = []
    for page in range(page_count):
        offset = read_word(emu, table_segment, table_offset + 4 * page)
        segment = read_word(emu, table_segment, table_offset + 4 * page + 2)
        if offset == 0 and segment == 0:
            break
        page_offsets.append(segment * 16 + offset - bytecode)
    tags = []
    node = read_word(emu, data, TTM_TAG_LIST)
    while node:
        tags.append((read_word(emu, data, node + 2), read_word(emu, data, node + 4)))
        node = read_word(emu, data, node + TAG_NEXT)
    return TtmIndex(status, page_count, page_offsets, tags)
