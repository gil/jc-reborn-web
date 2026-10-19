import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage
from original_decompress import install_heap
from original_loaders import read_word

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

DIRTY_ADD = "1060:007e"
DIRTY_OVERLAPS = "1060:04b2"
DIRTY_CLEAR = "1060:046e"
DIRTY_REPLAY = "1060:05f9"
DIRTY_DROP = "1060:06ac"
RESTORE_PASS = "1060:03d3"
COPY_RECT = "1038:06ce"
RESTORE_RECT_BITS = "1030:0250"
SCREEN_WIDTH = 0x2562
SCREEN_HEIGHT = 0x2564
CLIP_ON = 0x1EA3
CLIP_X1 = 0x1EA4
CLIP_X2 = 0x1EA6
CLIP_Y1 = 0x1EA8
CLIP_Y2 = 0x1EAA
SOURCE_DC = 0x1EB6
TARGET_DC = 0x1EB8
DC_A, DC_B, DC_C = 0xA1, 0xB2, 0xC3
DC_GLOBALS = {0x1EB4: DC_A, 0x1EB2: DC_B, 0x1EB0: DC_C}
LIST_HEADS = 0x46F0
LIST_SLOTS = 20
NODE_WORDS = 13
NODE_NEXT = 12
NODE_SAVED = 10
RESTORE_TABLE = {0: 0x287E, 1: 0x2882}


def signed(word: int) -> int:
    return word - 0x10000 if word & 0x8000 else word


class DirtyEmulator:
    def __init__(self, image: NeImage):
        self.emu = new_graphics_emulator(image)
        set_word(self.emu, SCREEN_WIDTH, 640)
        set_word(self.emu, SCREEN_HEIGHT, 480)
        for address, value in DC_GLOBALS.items():
            set_word(self.emu, address, value)
        self.events: list[list[object]] = []
        self.emu.replace_function(COPY_RECT, self._copy)
        self.emu.replace_function(RESTORE_RECT_BITS, self._bits)

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _copy(self, emu: Emulator):
        x, y, w, h = (signed(emu.arg(i)) for i in range(4))
        self.events.append(["copy", signed(self._word(SOURCE_DC)), signed(self._word(TARGET_DC)), x, y, w, h])
        return {"ax": 0}

    def _bits(self, emu: Emulator):
        saved, _segment, x, y, w, h = (signed(emu.arg(i)) for i in range(6))
        self.events.append(["bits", signed(self._word(TARGET_DC)), saved, x, y, w, h])
        return {"ax": 0}

    def run(self, op: list) -> object:
        name, args = op[0], op[1:]
        call = self.emu.call_far
        if name == "add":
            x, y, w, h, kind, source, target, age, clip, saved = args
            if clip is None:
                set_byte(self.emu, CLIP_ON, 0)
            else:
                set_byte(self.emu, CLIP_ON, 1)
                for address, value in zip((CLIP_X1, CLIP_Y1, CLIP_X2, CLIP_Y2), clip):
                    set_word(self.emu, address, value)
            call(DIRTY_ADD, stack_words=[0, saved, age, target, source, kind, h, w, y, x])
            return None
        if name == "overlaps":
            x, y, w, h, target, age = args
            return signed(call(DIRTY_OVERLAPS, stack_words=[age, target, h, w, y, x])["ax"])
        if name == "drop":
            source, target, age = args
            call(DIRTY_DROP, stack_words=[age, target, source])
            return None
        if name == "clear":
            call(DIRTY_CLEAR)
            return None
        self.events = []
        if name == "replay":
            source, target, age = args
            call(DIRTY_REPLAY, stack_words=[age, target, source])
        elif name == "restore":
            call(RESTORE_PASS, stack_words=[args[0]])
        else:
            raise ValueError(f"unknown dirty op {name}")
        return self.events

    def lists(self) -> list:
        out = []
        for slot in range(LIST_SLOTS):
            node = self._word(LIST_HEADS + 2 * slot)
            nodes = []
            while node:
                words = struct.unpack(f"<{NODE_WORDS}H", self.emu.read(self.emu.data_segment, node, 2 * NODE_WORDS))
                nodes.append([signed(word) for word in words[:9]] + [signed(words[NODE_SAVED])])
                node = words[NODE_NEXT]
            if nodes:
                out.append([slot, nodes])
        return out

    def restore_table(self, which: int) -> list[list[int]]:
        pairs = []
        entry = RESTORE_TABLE[which]
        while True:
            source_pointer, target_pointer = self._word(entry), self._word(entry + 2)
            if target_pointer == 0:
                break
            pairs.append([signed(self._word(source_pointer)), signed(self._word(target_pointer))])
            if which != 0:
                break
            entry += 4
        return pairs

WIPES = {
    "ellipse": "1020:0512",
    "rect": "1020:05a0",
    "right-to-left": "1020:0637",
    "left-to-right": "1020:0688",
    "top-to-bottom": "1020:06d2",
    "bottom-to-top": "1020:071c",
}
PUMP_MESSAGES = "1008:13cd"
FAKE_DC = 0x55


def wipe_shapes_original(image: NeImage, name: str, x: int, y: int, w: int, h: int) -> list[list[object]]:
    emu = new_graphics_emulator(image)
    shapes: list[list[object]] = []

    def recorder(kind: str):
        def record(emu: Emulator):
            _dc, left, top, right, bottom = pascal_args(emu, 5)
            shapes.append([kind, signed(left), signed(top), signed(right), signed(bottom)])
            return {"ax": 1}

        return record

    emu.add_stub("GDI", 27, recorder("rect"), arg_bytes=10)
    emu.add_stub("GDI", 24, recorder("ellipse"), arg_bytes=10)
    emu.replace_function(PUMP_MESSAGES, lambda emu: {"ax": 0})
    emu.call_far(WIPES[name], stack_words=[h, w, y, x, FAKE_DC])
    return shapes
