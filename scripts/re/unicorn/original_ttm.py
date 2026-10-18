import struct

from corpus import walk_chunks
from emulator import Emulator
from ne_image import NeImage
from original_graphics import (
    CLIP_ON,
    CLIP_X1,
    CLIP_X2,
    CLIP_Y1,
    CLIP_Y2,
    COLOR_MODE,
    DC_A,
    DC_B,
    DC_C,
    DC_GLOBALS,
    RECORD_HEIGHT,
    RECORD_SIZE,
    RECORD_WIDTH,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    SIXTEEN_COLOR_MODE,
    SOURCE_DC,
    TARGET_DC,
    set_byte,
    set_word,
    signed,
)
from original_loaders import CURRENT_TTM, INDEX_TTM_PAGES, LOAD_TTM, TTM_GLOBALS, TTM_GLOBALS_SIZE, c_string, new_loader_emulator, put_string, read_word

RUN_PAGE = "1050:074a"
RESET_THREAD = "1048:0b3e"
TTM_ID = 1
RECORD_PAGE_COUNT = 2
RECORD_PAGE_TABLE = 0xD0
THREAD_SIZE = 0x3D
CURRENT_THREAD = 0x263E
NODE_RAN = 0x0E
NODE_PALETTE_SLOT = 0x12
NODE_BMP_SLOT = 0x14
NODE_ZONE_SLOT = 0x16
NODE_FOREGROUND = 0x1E
NODE_BACKGROUND = 0x1F
NODE_CLIP_ON = 0x20
NODE_CLIP_X1 = 0x21
NODE_CLIP_X2 = 0x23
NODE_CLIP_Y1 = 0x25
NODE_CLIP_Y2 = 0x27
TEXT_COLOR = 0x1EA0
FILL = 0x1EAC
BACKGROUND = 0x1EAD
FOREGROUND = 0x1EAE
PALETTE_EFFECTS = 0x1EBF
MATRIX_LOADED = 0x2640
BUFFER_COUNT = 0x2641
KEEP_DRAWINGS = 0x27C0
CALL_DEPTH = 0x27C2
BACKGROUND_AGE = 0x287A
WALK_BITMAPS = 0x30D2
MIRROR_FLAG = 0x4106
PURGE = 0x4642
GOTO = 0x4644
PENDING_PALETTE = 0x4646
MIRROR_NEXT_LOAD = 0x46D6
ISLAND_Y = 0x46E2
ISLAND_X = 0x46E4
DELAY = 0x46E6
TRACE_ISLAND_X = 7
TRACE_ISLAND_Y = 5
RANDOM_MULTIPLIER = 25173
RANDOM_INCREMENT = 13849
PALETTE_BYTES = 48
SURFACES = {DC_A: 0, DC_B: 1, DC_C: 2}


class TtmTracer:
    def __init__(self, image: NeImage, resources: dict[str, bytes], name: str):
        self.name = name.upper()
        self.resources = {key.upper(): value for key, value in resources.items()}
        self.emu: Emulator = new_loader_emulator(image, {self.name: self.resources[self.name]})
        self.events: list[list[object]] = []
        self.random_calls = 0
        self.images: dict[int, tuple[str, int]] = {}
        self.palettes: dict[int, str] = {}
        self.pages = self._load()
        self._set_globals()
        self.node = self._new_thread()
        self._install_hooks()

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _byte(self, offset: int) -> int:
        return self.emu.read(self.emu.data_segment, offset, 1)[0]

    def _load(self) -> list[int]:
        emu, data = self.emu, self.emu.data_segment
        emu.write(data, TTM_GLOBALS, bytes(TTM_GLOBALS_SIZE))
        loaded = emu.call_far(LOAD_TTM, stack_words=[put_string(emu, self.name)])["ax"]
        if loaded != 1:
            raise RuntimeError(f"{self.name}: TTM load returned {loaded:#x}")
        record, segment = self._word(CURRENT_TTM), self._word(CURRENT_TTM + 2)
        emu.write(segment, record, struct.pack("<H", TTM_ID))
        emu.call_far(INDEX_TTM_PAGES, stack_words=[TTM_ID])
        count = read_word(emu, segment, record + RECORD_PAGE_COUNT)
        table, table_segment = read_word(emu, segment, record + RECORD_PAGE_TABLE), read_word(emu, segment, record + RECORD_PAGE_TABLE + 2)
        return [page for page in range(count) if read_word(emu, table_segment, table + 4 * page) or read_word(emu, table_segment, table + 4 * page + 2)]

    def _set_globals(self):
        emu = self.emu
        set_byte(emu, COLOR_MODE, SIXTEEN_COLOR_MODE)
        set_byte(emu, MATRIX_LOADED, 0)
        set_byte(emu, PALETTE_EFFECTS, 0)
        set_byte(emu, FILL, 1)
        words = {
            SCREEN_WIDTH: 640,
            SCREEN_HEIGHT: 480,
            BUFFER_COUNT: 4,
            BACKGROUND_AGE: 0,
            KEEP_DRAWINGS: 0,
            CALL_DEPTH: 0,
            ISLAND_X: TRACE_ISLAND_X,
            ISLAND_Y: TRACE_ISLAND_Y,
            MIRROR_NEXT_LOAD: 0,
            MIRROR_FLAG: 0,
            PENDING_PALETTE: 0,
            PENDING_PALETTE + 2: 0,
            **DC_GLOBALS,
        }
        for address, value in words.items():
            set_word(emu, address, value)
        set_word(emu, WALK_BITMAPS, self._bitmap_list("JOHNWALK.BMP"))

    def _new_thread(self) -> int:
        emu = self.emu
        node = emu.near_alloc(THREAD_SIZE)
        emu.write(emu.data_segment, node, bytes(THREAD_SIZE))
        set_word(emu, CURRENT_THREAD, node)
        emu.call_far(RESET_THREAD, stack_words=[node])
        set_word(emu, node, TTM_ID)
        return node

    def _bitmap_list(self, name: str) -> int:
        payload = self.resources.get(name.upper())
        if payload is None:
            return 0
        info = next(found for found in walk_chunks(payload) if found.path == "BMP:INF:")
        (count,) = struct.unpack_from("<H", payload, info.body_offset)
        widths = struct.unpack_from(f"<{count}H", payload, info.body_offset + 2)
        heights = struct.unpack_from(f"<{count}H", payload, info.body_offset + 2 + 2 * count)
        emu, data = self.emu, self.emu.data_segment
        records = emu.near_alloc(RECORD_SIZE * count)
        emu.write(data, records, bytes(RECORD_SIZE * count))
        table = emu.near_alloc(2 * (count + 1))
        for index in range(count):
            record = records + RECORD_SIZE * index
            emu.write(data, record + RECORD_WIDTH, struct.pack("<H", widths[index]))
            emu.write(data, record + RECORD_HEIGHT, struct.pack("<H", heights[index]))
            emu.write(data, table + 2 * index, struct.pack("<H", record))
            self.images[record] = (name.upper(), index)
        emu.write(data, table + 2 * count, struct.pack("<H", 0))
        return table

    def _surface(self, value: int) -> int:
        return SURFACES.get(value, signed(value))

    def _target(self) -> int:
        return self._surface(self._word(TARGET_DC))

    def _source(self) -> int:
        return self._surface(self._word(SOURCE_DC))

    def _clip(self) -> list[int]:
        return [self._byte(CLIP_ON), *(signed(self._word(address)) for address in (CLIP_X1, CLIP_Y1, CLIP_X2, CLIP_Y2))]

    def _args(self, first: int, count: int) -> list[int]:
        return [signed(self.emu.arg(first + i)) for i in range(count)]

    def _event(self, *values: object):
        self.events.append(list(values))

    def _install_hooks(self):
        hooks = {
            "1040:0d54": self._pixel,
            "1030:02ef": self._line,
            "1038:1bd8": self._rect,
            "1040:0688": self._circle,
            "1028:17d8": self._sprite,
            "1030:03d7": self._stretch,
            "1038:06ce": self._copy,
            "1060:007e": self._dirty,
            "1060:06ac": self._drop,
            "1030:01c4": self._save,
            "1030:0250": self._restore,
            "1028:1813": self._screen,
            "1028:17fa": self._bitmaps,
            "1040:09eb": self._palette,
            "1020:00ba": self._sound,
            "1018:1e60": self._random,
            "1040:0b08": self._select_palette,
            "1028:1845": self._quiet,
            "1040:0bc7": self._quiet,
            "1020:081c": self._quiet,
        }
        for address, handler in hooks.items():
            self.emu.replace_function(address, handler)

    def _pixel(self, emu: Emulator):
        self._event("pixel", self._target(), *self._args(0, 3), *self._clip())
        return {"ax": 0}

    def _line(self, emu: Emulator):
        self._event("line", self._target(), *self._args(0, 4), self._byte(FOREGROUND), *self._clip())
        return {"ax": 0}

    def _rect(self, emu: Emulator):
        self._event("rect", self._target(), *self._args(0, 4), self._byte(FILL), self._byte(FOREGROUND), self._byte(BACKGROUND), *self._clip())
        return {"ax": 0}

    def _circle(self, emu: Emulator):
        self._event("circle", self._target(), *self._args(0, 3), self._byte(FILL), self._byte(FOREGROUND), self._byte(BACKGROUND), *self._clip())
        return {"ax": 0}

    def _sprite(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("sprite", self._target(), name, index, *self._args(1, 3), *self._clip())
        return {"ax": 0}

    def _stretch(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("stretch", self._target(), name, index, *self._args(1, 5), *self._clip())
        return {"ax": 0}

    def _copy(self, emu: Emulator):
        self._event("copy", self._source(), self._target(), *self._args(0, 4))
        return {"ax": 0}

    def _dirty(self, emu: Emulator):
        x, y, w, h, kind = self._args(0, 5)
        if kind != 1:
            raise RuntimeError(f"{self.name}: dirty rect of kind {kind}")
        self._event("dirty", self._surface(emu.arg(5)), self._surface(emu.arg(6)), signed(emu.arg(7)), x, y, w, h, *self._clip())
        return {"ax": 0}

    def _drop(self, emu: Emulator):
        self._event("drop", self._surface(emu.arg(0)), self._surface(emu.arg(1)), signed(emu.arg(2)))
        return {"ax": 0}

    def _save(self, emu: Emulator):
        self._event("save", self._source(), *self._args(2, 4))
        return {"ax": 0}

    def _restore(self, emu: Emulator):
        self._event("restore", self._target(), *self._args(2, 4))
        return {"ax": 0}

    def _screen(self, emu: Emulator):
        self._event("screen", self._target(), c_string(emu, emu.arg(0)))
        return {"ax": 1}

    def _bitmaps(self, emu: Emulator):
        name = c_string(emu, emu.arg(0))
        self._event("bitmaps", name, self._word(MIRROR_FLAG))
        return {"ax": self._bitmap_list(name)}

    def _palette(self, emu: Emulator):
        name = c_string(emu, emu.arg(0))
        self._event("palette", name)
        if name.upper() not in self.resources:
            return {"ax": 0}
        pointer = emu.near_alloc(PALETTE_BYTES)
        self.palettes[pointer] = name.upper()
        return {"ax": pointer}

    def _sound(self, emu: Emulator):
        self._event("sound", signed(emu.arg(0)))
        return {"ax": 0}

    def _random(self, emu: Emulator):
        value = (self.random_calls * RANDOM_MULTIPLIER + RANDOM_INCREMENT) & 0xFFFF
        self.random_calls += 1
        self._event("random")
        return {"ax": value}

    def _select_palette(self, emu: Emulator):
        self._event("selectPalette", self.palettes.get(emu.arg(0), "-"))
        return {"ax": emu.arg(0)}

    def _quiet(self, emu: Emulator):
        return {"ax": 0}

    def _enter(self, replay: int):
        emu, node = self.emu, self.node
        set_word(emu, node + NODE_RAN, replay)
        foreground = self._byte(node + NODE_FOREGROUND)
        set_byte(emu, TEXT_COLOR, foreground)
        set_byte(emu, FOREGROUND, foreground)
        set_byte(emu, BACKGROUND, self._byte(node + NODE_BACKGROUND))
        for address, field in ((CLIP_X1, NODE_CLIP_X1), (CLIP_Y1, NODE_CLIP_Y1), (CLIP_X2, NODE_CLIP_X2), (CLIP_Y2, NODE_CLIP_Y2)):
            set_word(emu, address, self._word(node + field))
        set_byte(emu, CLIP_ON, self._byte(node + NODE_CLIP_ON))
        set_word(emu, PURGE, 0)
        set_word(emu, DELAY, 0xFFFF)

    def _pending_palette(self) -> str:
        if self._word(PENDING_PALETTE) == 0 and self._word(PENDING_PALETTE + 2) == 0:
            return "-"
        return self.palettes.get(self._word(PENDING_PALETTE), "?")

    def _thread(self) -> list[int]:
        node = self.node
        clip = [signed(self._word(node + field)) for field in (NODE_CLIP_X1, NODE_CLIP_Y1, NODE_CLIP_X2, NODE_CLIP_Y2)]
        slots = [self._word(node + field) for field in (NODE_BMP_SLOT, NODE_PALETTE_SLOT, NODE_ZONE_SLOT)]
        return [self._byte(node + NODE_FOREGROUND), self._byte(node + NODE_BACKGROUND), self._byte(node + NODE_CLIP_ON), *clip, *slots]

    def trace(self) -> list[list[object]]:
        rows: list[list[object]] = []
        for page in self.pages:
            for replay, run in ((0, "first"), (1, "replay")):
                self.events = []
                self._enter(replay)
                ran = self.emu.call_far(RUN_PAGE, stack_words=[page])["ax"]
                self._event("result", ran, signed(self._word(DELAY)), signed(self._word(GOTO)), self._word(PURGE), self._pending_palette(), self._word(MIRROR_NEXT_LOAD), self._word(KEEP_DRAWINGS))
                self._event("thread", *self._thread())
                rows.extend([self.name, page, run, event[0], " ".join(str(value) for value in event[1:])] for event in self.events)
        return rows
