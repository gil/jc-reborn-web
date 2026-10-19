from emulator import Emulator
from ne_image import NeImage
from original_graphics import CLIP_ON, CLIP_X1, CLIP_X2, CLIP_Y1, CLIP_Y2, set_byte, set_word, signed
from original_loaders import c_string
from original_ttm import BACKGROUND, FILL, FOREGROUND, TtmTracer

DRAW_ISLAND = "1010:0136"
ANIMATE_ISLAND = "1010:040e"
DRAW_HOLIDAY = "1010:1e50"
CLOCK_TICK = "1008:16c2"
DISCARD_RANDOM = "1018:1eb6"
LOAD_BMP = "1030:124a"
LOAD_SCREEN = "1030:16d8"
DRAW_RECT = "1038:1bd8"
DRAW_SPRITE = "1038:0ae4"
DRAW_SPRITE_PLAIN = "1038:0ac2"
DRAW_LINE = "1030:02ef"
COPY_RECT = "1038:06ce"
ADD_DIRTY = "1060:007e"
DIRTY_OVERLAPS = "1060:04b2"
DEBUG_LOG = "1020:081c"

MODE = 0x30B2
PLACE = 0x30BE
LOW_TIDE = 0x30C0
STILL = 0x30B0
NO_RAFT = 0x30AE
HOLIDAY_SHOWN = 0x30B4
HOLIDAY = 0x30BA
SLOT = 0x30B8
SPEED = 0x30BC
SETTING_BACKGROUND = 0x00B6
SETTING_CLOUDS = 0x00B8
SETTING_WAVES = 0x00BA
NUM_DAYS = 0x2D9B
RANDOM_WRITE_INDEX = 0x1CE6
CLOUD_RECORDS = (0x2E80, 15)
WAVE_RECORDS = (0x2F40, 30)
RECORD_WORDS = 6
STATE_WORDS = (0x30C4, 0x30C2, 0x30C0, 0x30BE, 0x30B6, 0x0282, 0x0284, 0x0286, 0x0280, 0x0288, 0x028A,
               0x2E7A, 0x2E7C, 0x2E7E, 0x2F36, 0x2F38, 0x2F3A, 0x2F3C)
UNSIGNED_STATE = {0x30C0, 0x30BE}

CASES = 24
STEPS = 60
PLACES = [0xFFFF, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0C, 0x30]


def island_case(k: int) -> tuple[dict[int, int], int, int]:
    words = {
        MODE: [0, 0, 0, 1, 2][k % 5],
        PLACE: PLACES[k % len(PLACES)],
        LOW_TIDE: [0xFFFF, 0, 1][k % 3],
        STILL: 1 if k % 7 == 3 else 0,
        NO_RAFT: 1 if k % 6 == 5 else 0,
        HOLIDAY_SHOWN: 0 if k % 4 == 2 else 1,
        HOLIDAY: k % 5,
        SLOT: 13 if k % 2 else 0,
        SETTING_BACKGROUND: 0 if k % 8 == 7 else 1,
        SETTING_CLOUDS: 0 if k % 9 == 8 else 1,
        SETTING_WAVES: 0 if k % 10 == 9 else 1,
        SPEED: 200 if k % 2 == 0 else 0,
    }
    return words, [1, 3, 9][k % 3], 997 * k


class IslandTracer(TtmTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes]):
        self.cached_lists: dict[str, int] = {}
        self.overlap_calls = 0
        super().__init__(image, resources, "ISLAND")
        self.emu.call_far(DRAW_ISLAND)
        self.load_events = list(self.events)
        self.events.clear()

    def _load(self) -> list[int]:
        return []

    def _new_thread(self) -> int:
        return 0

    def _bitmap_list(self, name: str) -> int:
        key = name.upper()
        if key not in self.cached_lists:
            self.cached_lists[key] = super()._bitmap_list(name)
        return self.cached_lists[key]

    def _install_hooks(self):
        hooks = {
            LOAD_BMP: self._sheet,
            LOAD_SCREEN: self._load_screen,
            DRAW_RECT: self._fill,
            DRAW_SPRITE: self._sprite,
            DRAW_SPRITE_PLAIN: self._sprite_plain,
            DRAW_LINE: self._island_line,
            COPY_RECT: self._copy,
            ADD_DIRTY: self._island_dirty,
            DIRTY_OVERLAPS: self._overlaps,
            DEBUG_LOG: self._quiet,
        }
        for address, handler in hooks.items():
            self.emu.replace_function(address, handler)

    def _sheet(self, emu: Emulator):
        name = c_string(emu, emu.arg(0)).upper()
        self._event("sheet", name)
        return {"ax": self._bitmap_list(name)}

    def _load_screen(self, emu: Emulator):
        self._event("screen", self._target(), c_string(emu, emu.arg(0)).upper())
        return {"ax": 1}

    def _fill(self, emu: Emulator):
        if self._byte(FILL) != 1 or self._byte(FOREGROUND) != self._byte(BACKGROUND):
            raise RuntimeError("island rect that is not a solid fill")
        self._event("fill", self._target(), *self._args(0, 4), self._byte(FOREGROUND))
        return {"ax": 0}

    def _sprite_plain(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("sprite", self._target(), name, index, *self._args(1, 2), 0, *self._clip())
        return {"ax": 0}

    def _island_line(self, emu: Emulator):
        self._event("line", self._target(), *self._args(0, 4), self._byte(FOREGROUND))
        return {"ax": 0}

    def _island_dirty(self, emu: Emulator):
        x, y, w, h, kind = self._args(0, 5)
        if kind != 1:
            raise RuntimeError(f"island dirty rect of kind {kind}")
        self._event("dirty", self._surface(emu.arg(5)), self._surface(emu.arg(6)), signed(emu.arg(7)), x, y, w, h)
        return {"ax": 0}

    def _overlaps(self, emu: Emulator):
        answer = 1 if self.overlap_calls % 3 == 1 else 0
        self.overlap_calls += 1
        self._event("overlaps", self._surface(emu.arg(4)), signed(emu.arg(5)), *self._args(0, 4), answer)
        return {"ax": answer}

    def _records(self, start: int, count: int) -> list[str]:
        return [
            ",".join(str(signed(self._word(start + 2 * (RECORD_WORDS * i + j)))) for j in range(RECORD_WORDS))
            for i in range(count)
        ]

    def _state(self) -> list[object]:
        values: list[object] = [self._word(at) if at in UNSIGNED_STATE else signed(self._word(at)) for at in STATE_WORDS]
        values.append(self._word(RANDOM_WRITE_INDEX))
        values.extend(self._records(*CLOUD_RECORDS))
        values.extend(self._records(*WAVE_RECORDS))
        return values

    def _flush(self, k: int, step: int) -> list[list[object]]:
        rows = [[k, step, event[0], " ".join(str(value) for value in event[1:])] for event in self.events]
        rows.append([k, step, "state", " ".join(str(value) for value in self._state())])
        self.events.clear()
        return rows

    def trace_case(self, k: int) -> list[list[object]]:
        emu = self.emu
        words, num_days, discard = island_case(k)
        for address, value in words.items():
            set_word(emu, address, value)
        set_byte(emu, NUM_DAYS, num_days)
        set_byte(emu, CLIP_ON, 0)
        for address, value in ((CLIP_X1, 0), (CLIP_Y1, 0), (CLIP_X2, 639), (CLIP_Y2, 479)):
            set_word(emu, address, value)
        emu.call_far(DISCARD_RANDOM, stack_words=[discard])
        self.overlap_calls = 0
        self.events.clear()
        emu.call_far(DRAW_ISLAND)
        rows = self._flush(k, -1)
        for step in range(STEPS):
            for _ in range(1 + step % 4):
                emu.call_far(CLOCK_TICK)
            emu.call_far(ANIMATE_ISLAND, stack_words=[0])
            emu.call_far(DRAW_HOLIDAY, stack_words=[0])
            rows.extend(self._flush(k, step))
        return rows
