import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage
from original_decompress import install_heap

NEAR_MALLOC = "1038:0619"
COLOR_MODE = 0x1EBD
SIXTEEN_COLOR_MODE = 2
ACTIVE_PALETTE = 0x25AE
CREATE_COLOR_BRUSH = "1038:1d31"
BUILD_MASK = "1040:035c"
MIRROR_ROWS = "1040:054e"
RECORD_SIZE = 14
RECORD_WIDTH = 6
RECORD_HEIGHT = 8
FIRST_GLOBAL_HANDLE = 0x2000
DIB_SIZE = 0x28 + 16 * 4 + 8 * 4


def new_graphics_emulator(image: NeImage) -> Emulator:
    emu = Emulator(image)
    install_heap(emu)
    emu.replace_function(NEAR_MALLOC, _near_malloc)
    set_byte(emu, COLOR_MODE, SIXTEEN_COLOR_MODE)
    return emu


def _near_malloc(emu: Emulator):
    size = emu.arg(0)
    offset = emu.near_alloc(size)
    emu.write(emu.data_segment, offset, bytes(size))
    return {"ax": offset}


def pascal_args(emu: Emulator, count: int) -> list[int]:
    return [emu.arg(count - 1 - i) for i in range(count)]


def set_byte(emu: Emulator, offset: int, value: int):
    emu.write(emu.data_segment, offset, bytes([value & 0xFF]))


def set_word(emu: Emulator, offset: int, value: int):
    emu.write(emu.data_segment, offset, struct.pack("<H", value & 0xFFFF))


def put_palette(emu: Emulator, rgb: bytes):
    offset = emu.near_alloc(len(rgb))
    emu.write(emu.data_segment, offset, rgb)
    set_word(emu, ACTIVE_PALETTE, offset)


@dataclass
class Brush:
    kind: str
    colorref: tuple[int, int] | None
    dib: bytes | None


def create_brush_original(image: NeImage, color: int, palette: bytes) -> Brush:
    emu = new_graphics_emulator(image)
    put_palette(emu, palette)
    blocks: dict[int, int] = {}
    brushes: list[Brush] = []

    def global_alloc(emu: Emulator):
        _flags, high, low = pascal_args(emu, 3)
        segment, _ = emu.alloc(low | high << 16)
        handle = FIRST_GLOBAL_HANDLE + len(blocks)
        blocks[handle] = segment
        return {"ax": handle}

    def solid_brush(emu: Emulator):
        high, low = pascal_args(emu, 2)
        brushes.append(Brush("solid", (low, high), None))
        return {"ax": 0x3001}

    def pattern_brush(emu: Emulator):
        handle, _usage = pascal_args(emu, 2)
        brushes.append(Brush("pattern", None, emu.read(blocks[handle], 0, DIB_SIZE)))
        return {"ax": 0x3002}

    emu.add_stub("KERNEL", 15, global_alloc, arg_bytes=6)
    emu.add_stub("KERNEL", 18, lambda emu: {"ax": 0, "dx": blocks[emu.arg(0)]}, arg_bytes=2)
    emu.add_stub("KERNEL", 19, lambda emu: {"ax": 0}, arg_bytes=2)
    emu.add_stub("KERNEL", 17, lambda emu: {"ax": 0}, arg_bytes=2)
    emu.add_stub("GDI", 66, solid_brush, arg_bytes=4)
    emu.add_stub("GDI", 445, pattern_brush, arg_bytes=4)
    emu.call_far(CREATE_COLOR_BRUSH, stack_words=[0, color])
    if len(brushes) != 1:
        raise RuntimeError(f"color {color:#x}: {len(brushes)} brushes created")
    return brushes[0]


@dataclass
class MaskCall:
    width: int
    height: int
    planes: int
    bits_per_pixel: int
    bits: bytes


def _new_record(emu: Emulator, width: int, height: int) -> int:
    record = emu.near_alloc(RECORD_SIZE)
    emu.write(emu.data_segment, record, bytes(RECORD_SIZE))
    set_word(emu, record + RECORD_WIDTH, width)
    set_word(emu, record + RECORD_HEIGHT, height)
    return record


def _install_create_bitmap(emu: Emulator, calls: list[MaskCall]):
    def create_bitmap(emu: Emulator):
        width, height, planes, bits_per_pixel, segment, offset = pascal_args(emu, 6)
        written_stride = (width + 8) // 16 * 2
        calls.append(MaskCall(width, height, planes, bits_per_pixel, emu.read(segment, offset, height * written_stride)))
        return {"ax": 0x3003}

    emu.add_stub("GDI", 48, create_bitmap, arg_bytes=12)


def build_mask_original(image: NeImage, width: int, height: int, packed: bytes) -> MaskCall:
    emu = new_graphics_emulator(image)
    calls: list[MaskCall] = []
    _install_create_bitmap(emu, calls)
    record = _new_record(emu, width, height)
    segment, offset = emu.alloc(len(packed))
    emu.write(segment, offset, packed)
    emu.call_far(BUILD_MASK, stack_words=[segment, offset, record])
    if len(calls) != 1:
        raise RuntimeError(f"{width}x{height}: {len(calls)} bitmaps created")
    return calls[0]


def mirror_rows_original(image: NeImage, width: int, height: int, packed: bytes) -> bytes:
    emu = new_graphics_emulator(image)
    record = _new_record(emu, width, height)
    segment, offset = emu.alloc(len(packed))
    emu.write(segment, offset, packed)
    emu.call_far(MIRROR_ROWS, stack_words=[segment, offset, record])
    return emu.read(segment, offset, len(packed))


def masks_and_mirrors_original(image: NeImage, widths: list[int], heights: list[int], packed: bytes) -> tuple[bytes, bytes]:
    emu = new_graphics_emulator(image)
    calls: list[MaskCall] = []
    _install_create_bitmap(emu, calls)
    base, _ = emu.alloc(len(packed))
    emu.write(base, 0, packed)
    masks, mirrored = bytearray(), bytearray()
    position = 0
    for width, height in zip(widths, heights):
        size = width // 2 * height
        record = _new_record(emu, width, height)
        segment, offset = base + (position >> 4), position & 0xF
        emu.call_far(BUILD_MASK, stack_words=[segment, offset, record])
        call = calls[-1]
        if (call.width, call.height, call.planes, call.bits_per_pixel) != (width, height, 1, 1):
            raise RuntimeError(f"{width}x{height}: CreateBitmap got {call}")
        masks += call.bits
        emu.call_far(MIRROR_ROWS, stack_words=[segment, offset, record])
        mirrored += emu.read(segment, offset, size)
        position += size
    return bytes(masks), bytes(mirrored)
