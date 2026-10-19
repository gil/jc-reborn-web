from unicorn import UC_HOOK_CODE

from emulator import Emulator
from ne_image import NeImage
from original_graphics import CLIP_ON, CLIP_X1, CLIP_X2, CLIP_Y1, CLIP_Y2, set_byte, set_word, signed
from original_island import (
    CLOCK_TICK,
    DISCARD_RANDOM,
    DRAW_ISLAND,
    HOLIDAY,
    HOLIDAY_SHOWN,
    LOW_TIDE,
    MODE,
    NO_RAFT,
    NUM_DAYS,
    PLACE,
    RANDOM_WRITE_INDEX,
    SETTING_BACKGROUND,
    SETTING_CLOUDS,
    SETTING_WAVES,
    SLOT,
    SPEED,
    STILL,
    IslandTracer,
)
from original_ttm import WALK_BITMAPS

LOAD_WALK = "1018:0000"
RESET_WALK = "1018:0074"
WALK_STEP = "1018:0094"
ROUTE_OF = "1018:03ac"
SEGMENT_FRAMES = "1018:03ea"
IS_AT_SPOT = "1018:0b46"
SEGMENT_PICKED = "1018:011d"
ROUTE_END = -7

WALK_DATA = (0x02E1, 0x1660)
SEGMENT_COUNT = 34
SPOTS = 6
HEADINGS = 8
RECORD_BYTES = 6

SPOT = 0x30E2
HEADING = 0x30DE
TARGET_SPOT = 0x30E0
TARGET_HEADING = 0x30DC
WANTED_HEADING = 0x30C8
SEGMENT_HEADING = 0x30CC
SEGMENT_SPOT = 0x30CA
ROUTE = 0x30D0
SEGMENT = 0x30CE
FRAME = 0x30C6
DELAY = 0x30D4

CASES = 36
LEGS = 6
IDLE_BEATS = 8
LEG_BEATS = 1500
STEP_MS = 50
TICK_MS = 16
DISCARD_STEP = 1009


def walk_data_bytes(image: NeImage) -> bytes:
    data = next(segment for segment in image.segments if segment.index == image.auto_data_segment).data
    return data[WALK_DATA[0]:WALK_DATA[1]]


def beat_ticks(beat: int) -> int:
    return (STEP_MS * (beat + 1)) // TICK_MS - (STEP_MS * beat) // TICK_MS


def leg_target(k: int, leg: int) -> tuple[int, int]:
    spot = 1 + k % SPOTS if leg == 0 else (k + 3 * leg) % (SPOTS + 1)
    return spot, (3 * k + 5 * leg + 1) % HEADINGS


def scene_end(k: int, leg: int) -> tuple[int, int]:
    return 1 + (k + leg) % SPOTS, (2 * k + leg) % HEADINGS


class BadPick(Exception):
    pass


class WalkTracer(IslandTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes]):
        super().__init__(image, resources)
        self.beat = 0
        emu = self.emu
        segment, offset = emu.far(SEGMENT_PICKED)
        picked = segment * 16 + offset
        emu.uc.hook_add(UC_HOOK_CODE, self._check_pick, begin=picked, end=picked)
        self.routes: dict[int, tuple[int, int]] = {}
        for start in range(1, SPOTS + 1):
            for target in range(1, SPOTS + 1):
                pointer = emu.call_far(ROUTE_OF, stack_words=[target, start])["ax"]
                if pointer:
                    self.routes[pointer] = (start, target)
        self.segments: list[tuple[int, int, int]] = []
        for segment in range(1, SEGMENT_COUNT + 1):
            base = emu.call_far(SEGMENT_FRAMES, stack_words=[segment])["ax"]
            count = 0
            while any(self._word(base + RECORD_BYTES * count + 2 * i) for i in range(3)):
                count += 1
            self.segments.append((segment, base, count))

    def _check_pick(self, uc, address, size, user_data):
        """Raises when 1018:0094 picked a pair outside Johnny's group, or the (0, 0) pair of the target's group."""
        chosen = self.emu.reg("si")
        at = self._word(ROUTE)
        marker = -signed(self._word(SPOT))
        while signed(self._word(at)) not in (marker, ROUTE_END):
            at += 2
        at += 2
        while at < chosen and signed(self._word(at)) >= 0:
            at += 4
        if at != chosen or signed(self._word(chosen)) <= 0:
            raise BadPick()

    def _pointer(self, address: int) -> str:
        if address == 0:
            return "0"
        for segment, base, count in self.segments:
            if base <= address < base + RECORD_BYTES * count and (address - base) % RECORD_BYTES == 0:
                return f"{segment}:{(address - base) // RECORD_BYTES}"
        raise RuntimeError(f"walk pointer {address:#x} is not a frame record")

    def _route(self) -> str:
        pointer = self._word(ROUTE)
        if pointer == 0:
            return "0"
        start, target = self.routes[pointer]
        return f"{start},{target}"

    def _walk_state(self) -> list[object]:
        def word(address: int) -> int:
            return signed(self._word(address))

        return [
            word(SPOT), word(HEADING), word(TARGET_SPOT), word(TARGET_HEADING), word(WANTED_HEADING),
            word(SEGMENT_HEADING), word(SEGMENT_SPOT), self._route(), self._pointer(self._word(SEGMENT)),
            self._pointer(self._word(FRAME)), word(DELAY), self._word(RANDOM_WRITE_INDEX),
        ]

    def _rows(self, k: int, beat: int) -> list[list[object]]:
        rows = [[k, beat, event[0], " ".join(str(value) for value in event[1:])] for event in self.events]
        rows.append([k, beat, "state", " ".join(str(value) for value in self._walk_state())])
        self.events.clear()
        return rows

    def _start_beat(self) -> int:
        for _ in range(beat_ticks(self.beat)):
            self.emu.call_far(CLOCK_TICK)
        self.beat += 1
        return self.beat - 1

    def _set_up(self, k: int):
        emu = self.emu
        words = {
            MODE: 0, PLACE: 0xFFFF, LOW_TIDE: k % 2, STILL: 0, NO_RAFT: 0, HOLIDAY_SHOWN: 1, HOLIDAY: 0, SLOT: 0,
            SETTING_BACKGROUND: 1, SETTING_CLOUDS: 1, SETTING_WAVES: 1, SPEED: 0,
        }
        for address, value in words.items():
            set_word(emu, address, value)
        set_byte(emu, NUM_DAYS, 1)
        set_byte(emu, CLIP_ON, 0)
        for address, value in ((CLIP_X1, 0), (CLIP_Y1, 0), (CLIP_X2, 639), (CLIP_Y2, 479)):
            set_word(emu, address, value)
        emu.call_far(DISCARD_RANDOM, stack_words=[DISCARD_STEP * k])
        self.overlap_calls = 0
        emu.call_far(DRAW_ISLAND)
        set_word(emu, WALK_BITMAPS, 0)
        emu.call_far(LOAD_WALK)
        set_word(emu, SPOT, 1 + k // SPOTS)
        set_word(emu, HEADING, k % HEADINGS)
        self.events.clear()

    def trace_case(self, k: int) -> list[list[object]]:
        self._set_up(k)
        rows = self._rows(k, -1)
        self.beat = 0
        self.leg = 0
        try:
            self._trace_legs(k, rows)
        except BadPick:
            beat = self.beat - 1
            rows.extend([k, beat, event[0], " ".join(str(value) for value in event[1:])] for event in self.events)
            rows.append([k, beat, "bad", self.leg])
        return rows

    def _trace_legs(self, k: int, rows: list[list[object]]):
        emu: Emulator = self.emu
        for leg in range(LEGS):
            self.leg = leg
            if leg % 2 == 1:
                spot, heading = scene_end(k, leg)
                set_word(emu, SPOT, spot)
                set_word(emu, HEADING, heading)
            elif leg > 0:
                for i in range(IDLE_BEATS):
                    beat = self._start_beat()
                    if i == 0:
                        self._event("reset", leg)
                        emu.call_far(RESET_WALK)
                    emu.call_far(WALK_STEP)
                    rows.extend(self._rows(k, beat))
            spot, heading = leg_target(k, leg)
            arrived = False
            for _ in range(LEG_BEATS):
                beat = self._start_beat()
                arrived = emu.call_far(IS_AT_SPOT, stack_words=[heading & 0xFFFF, spot])["ax"] == 1
                self._event("at", leg, spot, heading, 1 if arrived else 0)
                if not arrived:
                    emu.call_far(WALK_STEP)
                rows.extend(self._rows(k, beat))
                if arrived:
                    break
            if not arrived:
                rows.append([k, self.beat - 1, "stuck", leg])
