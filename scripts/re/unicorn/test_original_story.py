import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_story import (
    BUILDS,
    DISCARDS,
    PERCENT_LISTS,
    SCENE_COUNT,
    SCENE_SIZE,
    START_TIMES,
    StoryTracer,
    build_clock,
    random_rows,
    table_bytes,
)

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"


def python_generator(table_bytes_: bytes):
    read, write = struct.unpack_from("<HH", table_bytes_, 0)
    table = list(struct.unpack_from("<56H", table_bytes_, 4))

    def draw() -> int:
        nonlocal read, write
        at = write
        table[at] = (table[at] + table[read]) & 0xFFFF
        write = (write + 1) % 56
        read = (read + 1) % 56
        return table[at]

    return draw


def half_hour_slot(hhmm: int) -> int:
    return (hhmm // 50 + (hhmm % 100) // 30 + 14) % 16


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class StoryTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)
        cls.scenes, cls.random_table = table_bytes(cls.image)
        cls.random = random_rows(cls.image)
        cls.case0 = StoryTracer(cls.image).trace_case(0)

    def test_table_dumps_have_the_expected_sizes(self):
        self.assertEqual(len(self.scenes), SCENE_COUNT * SCENE_SIZE + 2)
        self.assertEqual(self.scenes[-2:], b"\0\0")
        self.assertEqual(len(self.random_table), 4 + 56 * 2)

    def test_the_generator_is_an_additive_lagged_fibonacci(self):
        # SCRANTIC 1018:1e60
        draw = python_generator(self.random_table)
        expected = [draw() for _ in range(300)]
        self.assertEqual([row[3] for row in self.random if row[0] == "next" and row[1] == 0], expected)

    def test_discarding_skips_values(self):
        # SCRANTIC 1018:1eb6
        draw = python_generator(self.random_table)
        for _ in range(55):
            draw()
        self.assertEqual([row[3] for row in self.random if row[0] == "next" and row[1] == 55][:20], [draw() for _ in range(20)])

    def test_percent_pick_walks_the_weights(self):
        # SCRANTIC 1018:1ef5
        draw = python_generator(self.random_table)
        for weights in PERCENT_LISTS:
            kind = "percent:" + ",".join(map(str, weights))
            for row in (row for row in self.random if row[0] == kind):
                value, result = draw(), 0
                for i, weight in enumerate(weights, start=1):
                    t = (weight * 0x28F) & 0xFFFF
                    if t > value:
                        result = i
                        break
                    value -= t
                self.assertEqual(row[3], result, f"{kind} call {row[2]}")

    def test_every_build_writes_a_queue_and_a_state_row(self):
        # SCRANTIC 1018:0540
        self.assertEqual([(row[1], row[2]) for row in self.case0], [(b, event) for b in range(BUILDS) for event in ("queue", "state")])

    def test_queue_entries_are_table_indices_and_johnny_starts_at_the_first(self):
        # SCRANTIC 1018:089b 1018:0540
        for queue, state in zip(self.case0[0::2], self.case0[1::2]):
            indices = [int(value) for value in queue[3].split(" ")]
            self.assertTrue(all(1 <= index < SCENE_COUNT for index in indices), queue)
            first = self.scenes[SCENE_SIZE * indices[0]:SCENE_SIZE * (indices[0] + 1)]
            values = [int(value) for value in state[3].split(" ")]
            self.assertEqual(values[13:15], [struct.unpack_from("b", first, 3)[0], struct.unpack_from("b", first, 4)[0]])

    def test_slot_follows_the_wall_clock_and_start_time(self):
        # SCRANTIC 1018:0540 1018:0c21
        for state in self.case0[1::2]:
            clock = build_clock(0, state[1])
            hhmm = clock.hour * 100 + (30 if clock.minute >= 30 else 0)
            expected = (half_hour_slot(hhmm) - half_hour_slot(START_TIMES[0]) + 16) % 16
            self.assertEqual(int(state[3].split(" ")[0]), expected, state)

    def test_a_fresh_install_starts_on_day_one(self):
        # SCRANTIC 1018:0b87
        values = [int(value) for value in self.case0[1][3].split(" ")]
        self.assertEqual(values[2:4], [1, 1])
        self.assertEqual(DISCARDS[0], 0)


if __name__ == "__main__":
    unittest.main()
