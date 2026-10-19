from ne_image import NeImage
from original_graphics import set_word, signed
from original_loaders import ADS_SLOTS, put_string, read_word
from original_ttm import TtmTracer

LOAD_ADS = "1048:0079"
INDEX_SECTIONS = "1048:04fc"
START_SECTION = "1048:0874"
ADS_TICK = "1048:1acb"
SECTION_BUSY = "1048:0766"
CLOCK = 0x2E70
CLOCK_START = 1
TICK_LIMIT = 2000
RECORD_SECTION_COUNT = 0x02
RECORD_BYTECODE = 0x04
RECORD_NODES = 0x10
RECORD_STATES = 0x12
RECORD_COUNTERS = 0xB2
RECORD_STARTS = 0x152
RECORD_RESUME = 0x292
NODE_NEXT_PAGE = 0x06
NODE_PAGE = 0x08
NODE_RUN_PAGE = 0x0A
NODE_SELF_GOTO = 0x0C
NODE_RAN = 0x0E
NODE_DELAY = 0x29
NODE_SECTION_STATE = 0x2B
NODE_PLAY_COUNT = 0x2D
NODE_MODE = 0x2F
NODE_PLAYS_LEFT = 0x31
NODE_END_TIME = 0x33
NODE_DUE_TIME = 0x37
NODE_NEXT = 0x3B


class AdsTracer(TtmTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes], name: str):
        self.cached_lists: dict[str, int] = {}
        super().__init__(image, resources, name)
        self.slot = self.pages[0]
        self.emu.call_far(INDEX_SECTIONS, stack_words=[self.slot])

    def _load(self) -> list[int]:
        slot = self.emu.call_far(LOAD_ADS, stack_words=[put_string(self.emu, self.name)])["ax"]
        if slot == 0:
            raise RuntimeError(f"{self.name}: ADS load failed")
        return [slot]

    def _new_thread(self) -> int:
        return 0

    def _bitmap_list(self, name: str) -> int:
        key = name.upper()
        if key not in self.cached_lists:
            self.cached_lists[key] = super()._bitmap_list(name)
        return self.cached_lists[key]

    def _record(self) -> tuple[int, int]:
        pointer = ADS_SLOTS + 4 * (self.slot - 1)
        return self._word(pointer + 2), self._word(pointer)

    def _record_word(self, field: int) -> int:
        segment, offset = self._record()
        return read_word(self.emu, segment, offset + field)

    def _far(self, field: int) -> int:
        return self._record_word(field + 2) * 16 + self._record_word(field)

    def _dword(self, offset: int) -> int:
        return self._word(offset) | self._word(offset + 2) << 16

    def section_tags(self) -> list[int]:
        tags = []
        for index in range(self._record_word(RECORD_SECTION_COUNT)):
            start = self._far(RECORD_STARTS + 4 * index)
            tags.append(read_word(self.emu, 0, start - 2))
        return tags

    def _sections(self) -> list[list[int]]:
        bytecode = self._far(RECORD_BYTECODE)
        rows = []
        for index in range(self._record_word(RECORD_SECTION_COUNT)):
            resume = self._far(RECORD_RESUME + 4 * index)
            rows.append([
                self._record_word(RECORD_STATES + 2 * index),
                signed(self._record_word(RECORD_COUNTERS + 2 * index)),
                resume - bytecode if resume else -1,
            ])
        return rows

    def _node_list(self) -> list[int]:
        nodes = []
        node = self._record_word(RECORD_NODES)
        while node:
            nodes.append(node)
            node = self._word(node + NODE_NEXT)
        return nodes

    def _node(self, node: int) -> list[int]:
        word = self._word
        return [
            word(node),
            word(node + 2),
            word(node + NODE_MODE),
            signed(word(node + NODE_PAGE)),
            signed(word(node + NODE_NEXT_PAGE)),
            signed(word(node + NODE_RUN_PAGE)),
            1 if word(node + NODE_SELF_GOTO) else 0,
            1 if word(node + NODE_RAN) else 0,
            word(node + NODE_PLAY_COUNT),
            signed(word(node + NODE_PLAYS_LEFT)),
            word(node + NODE_SECTION_STATE),
            signed(word(node + NODE_DELAY)),
            self._dword(node + NODE_DUE_TIME),
            self._dword(node + NODE_END_TIME),
        ]

    def trace_section(self, tag: int) -> list[list[object]]:
        emu = self.emu
        emu.call_far(START_SECTION, stack_words=[tag])
        rows: list[list[object]] = []
        seen_order: list[str] | None = None
        seen_sections: dict[int, list[int]] = {}
        seen_nodes: dict[int, list[int]] = {}
        now = CLOCK_START
        for tick in range(TICK_LIMIT):
            self.events = []
            set_word(emu, CLOCK, now & 0xFFFF)
            set_word(emu, CLOCK + 2, now >> 16)
            emu.call_far(INDEX_SECTIONS, stack_words=[self.slot])
            ran = emu.call_far(ADS_TICK)["ax"]
            busy = emu.call_far(SECTION_BUSY, stack_words=[tag])["ax"]
            out: list[list[object]] = [["tick", ran, busy, sum(1 for event in self.events if event[0] == "random")]]
            nodes = self._node_list()
            order = [f"{self._word(node)}:{self._word(node + 2)}" for node in nodes]
            if order != seen_order:
                out.append(["order", *order])
                seen_order = order
            for index, values in enumerate(self._sections()):
                if seen_sections.get(index) != values:
                    out.append(["section", index, *values])
                    seen_sections[index] = values
            for node in nodes:
                values = self._node(node)
                if seen_nodes.get(node) != values:
                    out.append(["node", *values])
                    seen_nodes[node] = values
            rows.extend([self.name, tag, tick, event[0], " ".join(str(value) for value in event[1:])] for event in out)
            if busy == 0:
                break
            now += 1 + tick % 3
        return rows
