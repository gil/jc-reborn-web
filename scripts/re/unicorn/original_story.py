import struct
from datetime import datetime, timedelta

from emulator import Emulator
from ne_image import NeImage
from original_graphics import set_byte, set_word, signed
from original_loaders import read_word

NEW_SEQUENCE = "1018:0540"
NEXT_RANDOM = "1018:1e60"
DISCARD_RANDOM = "1018:1eb6"
RANDOM_PERCENT = "1018:1ef5"
GET_DATE = "1000:01f4"
GET_TIME = "1000:020f"
QUIET = ("1010:0136", "1020:0364", "1018:0d11", "1020:081c")

SCENE_TABLE = 0x1756
SCENE_SIZE = 17
SCENE_COUNT = 80
QUEUE = 0x30F2
RANDOM_TABLE = 0x1CE4
RANDOM_TABLE_BYTES = 4 + 56 * 2
RANDOM_WRITE_INDEX = 0x1CE6
START_TIME = 0x00BE
NUM_DAYS = 0x2D9B
INTRODUCTION = 0x2D9A
YEAR = 0x2D98
MONTH = 0x2D96
DAY = 0x2D94
NEW_SEQUENCE_FLAG = 0x30EE
ENTRY_POINTERS = (0x30E6, 0x30E8, 0x30EA)

CASES = 16
BUILDS = 30
DISCARDS = [0, 1, 55, 56, 1000, 4096, 31337, 65535]
START_TIMES = [900, 0, 1230, 2330]
FIRST_DATES = [(1992, 10, 29), (1992, 12, 24), (1992, 12, 31), (1993, 1, 1), (1993, 3, 16), (1992, 6, 1)]
RANDOM_SEEDS = (0, 1, 55, 1000, 65535)
RANDOM_CALLS = 300
PERCENT_LISTS = ([50], [5, 10, 15], [20, 30, 50], [10, 20, 30, 20, 10, 10], [35, 5, 5, 5], [30, 50], [35], [30])
PERCENT_CALLS = 200


def build_clock(k: int, b: int) -> datetime:
    year, month, day = FIRST_DATES[k % len(FIRST_DATES)]
    return datetime(year, month, day, (3 * k) % 24, (7 * k) % 60) + timedelta(days=b // 3, minutes=97 * b)


def table_bytes(image: NeImage) -> tuple[bytes, bytes]:
    data = next(segment for segment in image.segments if segment.index == image.auto_data_segment).data
    return (
        data[SCENE_TABLE:SCENE_TABLE + SCENE_SIZE * SCENE_COUNT + 2],
        data[RANDOM_TABLE:RANDOM_TABLE + RANDOM_TABLE_BYTES],
    )


def random_rows(image: NeImage) -> list[list[object]]:
    rows: list[list[object]] = []
    for seed in RANDOM_SEEDS:
        emu = Emulator(image)
        emu.call_far(DISCARD_RANDOM, stack_words=[seed])
        rows.extend(["next", seed, i, emu.call_far(NEXT_RANDOM)["ax"]] for i in range(RANDOM_CALLS))
    emu = Emulator(image)
    for weights in PERCENT_LISTS:
        kind = "percent:" + ",".join(str(weight) for weight in weights)
        for i in range(PERCENT_CALLS):
            rows.append([kind, 0, i, emu.call_far(RANDOM_PERCENT, stack_words=[0, *reversed(weights)])["ax"]])
    return rows


class StoryTracer:
    def __init__(self, image: NeImage):
        self.emu = Emulator(image)
        self.clock = datetime(1992, 1, 1)
        for address in QUIET:
            self.emu.replace_function(address, lambda emu: {"ax": 0})
        self.emu.replace_function(GET_TIME, self._time)
        self.emu.replace_function(GET_DATE, self._date)

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _byte(self, offset: int) -> int:
        value = self.emu.read(self.emu.data_segment, offset, 1)[0]
        return value - 0x100 if value >= 0x80 else value

    def _time(self, emu: Emulator):
        emu.write(emu.data_segment, emu.arg(0), bytes([self.clock.hour, self.clock.minute, 0, 0]))
        return {"ax": 0}

    def _date(self, emu: Emulator):
        clock = self.clock
        emu.write(emu.data_segment, emu.arg(0), struct.pack("<BBHB", clock.day, clock.month, clock.year, clock.isoweekday() % 7))
        return {"ax": 0}

    def _entry_index(self, pointer: int) -> int:
        return (pointer - SCENE_TABLE) // SCENE_SIZE if pointer else -1

    def _queue(self) -> list[int]:
        indices, at = [], QUEUE
        while (pointer := self._word(at)) != 0:
            indices.append(self._entry_index(pointer))
            at += 2
        return indices

    def _state(self) -> list[int]:
        word = self._word
        return [
            signed(word(0x30B8)),
            signed(word(0x30BA)),
            self._byte(NUM_DAYS),
            self._byte(INTRODUCTION),
            signed(word(YEAR)),
            signed(word(MONTH)),
            signed(word(DAY)),
            word(0x30BE),
            word(0x30C0),
            signed(word(0x30B2)),
            signed(word(0x30B0)),
            signed(word(0x30AE)),
            signed(word(0x30B4)),
            signed(word(0x30E2)),
            signed(word(0x30DE)),
            *(self._entry_index(word(pointer)) for pointer in ENTRY_POINTERS),
            signed(word(0x30EC)),
            signed(word(NEW_SEQUENCE_FLAG)),
            word(RANDOM_WRITE_INDEX),
        ]

    def trace_case(self, k: int) -> list[list[object]]:
        emu = self.emu
        set_byte(emu, NUM_DAYS, k % 13)
        set_byte(emu, INTRODUCTION, (5 * k) % 13)
        year, month, day = (1992, 6, 1) if k % 2 else (0, 0, 0)
        set_word(emu, YEAR, year)
        set_word(emu, MONTH, month)
        set_word(emu, DAY, day)
        set_word(emu, START_TIME, START_TIMES[k % len(START_TIMES)])
        emu.call_far(DISCARD_RANDOM, stack_words=[DISCARDS[k % len(DISCARDS)]])
        rows: list[list[object]] = []
        for b in range(BUILDS):
            self.clock = build_clock(k, b)
            set_word(emu, NEW_SEQUENCE_FLAG, 1)
            emu.call_far(NEW_SEQUENCE)
            rows.append([k, b, "queue", " ".join(str(index) for index in self._queue())])
            rows.append([k, b, "state", " ".join(str(value) for value in self._state())])
        return rows
