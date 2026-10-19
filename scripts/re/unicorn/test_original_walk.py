import unittest
from pathlib import Path

from corpus import load_resources
from ne_image import NeImage
from original_graphics import signed
from original_loaders import read_word
from original_walk import LEGS, ROUTE_OF, SEGMENT_FRAMES, WALK_DATA, WalkTracer, walk_data_bytes

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
TRACED = (0, 7, 23, 35)
BAD_CASE = 4


def values(row: list[object]) -> list[str]:
    return str(row[3]).split(" ")


@unittest.skipUnless((DATA / "SCRANTIC.SCR").exists() and (DATA / "RESOURCE.MAP").exists(), "needs public/data")
class WalkTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(DATA / "SCRANTIC.SCR")
        cls.resources = {resource.name: resource.payload for resource in load_resources(DATA)}
        cls.tracer = WalkTracer(cls.image, cls.resources)
        cls.rows = [row for k in TRACED for row in WalkTracer(cls.image, cls.resources).trace_case(k)]

    def beats(self) -> dict[tuple[int, int], list[list[object]]]:
        grouped: dict[tuple[int, int], list[list[object]]] = {}
        for row in self.rows:
            grouped.setdefault((int(row[0]), int(row[1])), []).append(row)
        return grouped

    def test_the_walk_tables_are_one_block(self):
        # SCRANTIC 1068:02e1 1068:0355
        data = walk_data_bytes(self.image)
        self.assertEqual(len(data), WALK_DATA[1] - WALK_DATA[0])
        self.assertEqual(data[0x355 - WALK_DATA[0]:0x362 - WALK_DATA[0]], b"JOHNWALK.BMP\0")

    def test_frame_lists_follow_each_other_from_0aea(self):
        # SCRANTIC 1018:03ea
        emu = self.tracer.emu
        self.assertEqual(emu.call_far(SEGMENT_FRAMES, stack_words=[0])["ax"], 0)
        self.assertEqual(emu.call_far(SEGMENT_FRAMES, stack_words=[35])["ax"], 0)
        at = 0xAEA
        for segment, base, count in self.tracer.segments:
            self.assertEqual(base, at, f"segment {segment}")
            at = base + 6 * (count + 1)
        self.assertEqual(at, WALK_DATA[1])

    def test_routes_follow_each_other_from_0362(self):
        # SCRANTIC 1018:03ac
        emu = self.tracer.emu
        at = 0x362
        for start in range(7):
            for target in range(7):
                pointer = emu.call_far(ROUTE_OF, stack_words=[target, start])["ax"]
                if start == 0 or target == 0 or start == target:
                    self.assertEqual(pointer, 0, f"{start},{target}")
                    continue
                self.assertEqual(pointer, at, f"{start},{target}")
                while signed(read_word(emu, emu.data_segment, at)) != -7:
                    at += 2
                at += 2
        self.assertEqual(at, 0xAA2)

    def test_every_leg_ends_with_johnny_at_the_target(self):
        # SCRANTIC 1018:0094 1018:0b46
        self.assertEqual([row for row in self.rows if row[2] == "stuck"], [])
        for rows in self.beats().values():
            for row in rows:
                if row[2] == "at" and values(row)[3] == "1":
                    _, spot, heading, _ = values(row)
                    state = values(rows[-1])
                    if spot != "0":
                        self.assertEqual(state[0], spot)
                    self.assertEqual(state[1], heading)
        self.assertEqual(sum(1 for row in self.rows if row[2] == "at" and values(row)[3] == "1"), len(TRACED) * LEGS)

    def test_a_drawn_frame_adds_three_rects_of_its_size_and_sets_the_delay(self):
        # SCRANTIC 1018:0094
        drawn = 0
        for rows in self.beats().values():
            sprites = [values(row) for row in rows if row[2] == "sprite" and values(row)[1] == "JOHNWALK.BMP"]
            if not sprites:
                continue
            drawn += 1
            self.assertEqual(len(sprites), 1)
            x, y = sprites[0][3], sprites[0][4]
            dirty = [values(row) for row in rows if row[2] == "dirty"]
            self.assertEqual([d[:3] for d in dirty], [["1", "0", "0"], ["1", "0", "1"], ["2", "1", "0"]])
            self.assertTrue(all(d[3:5] == [x, y] for d in dirty))
            self.assertEqual(len({tuple(d[5:7]) for d in dirty}), 1)
            self.assertEqual(values(rows[-1])[10], "4")
        self.assertGreater(drawn, 100)

    def test_a_route_left_over_from_an_old_target_reads_past_its_target_group(self):
        # SCRANTIC 1018:0094 1018:0074 1018:0b46
        rows = WalkTracer(self.image, self.resources).trace_case(BAD_CASE)
        self.assertEqual(rows[-1][2:], ["bad", 2])
        spot, _, target, *_, route = values([row for row in rows if row[2] == "state"][-1])[:8]
        self.assertEqual(route.split(",")[1], spot)
        self.assertNotEqual(spot, target)
