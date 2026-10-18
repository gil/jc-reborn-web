import unittest
from pathlib import Path

from corpus import load_resources
from ne_image import NeImage
from original_island import CASES, STEPS, IslandTracer

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"


def of_step(rows: list[list[object]], step: int) -> list[list[str]]:
    return [[str(row[2]), *str(row[3]).split(" ")] for row in rows if row[1] == step]


@unittest.skipUnless((DATA / "SCRANTIC.SCR").exists() and (DATA / "RESOURCE.MAP").exists(), "needs public/data")
class IslandTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = NeImage.load(DATA / "SCRANTIC.SCR")
        resources = {resource.name: resource.payload for resource in load_resources(DATA)}
        cls.tracer = IslandTracer(image, resources)
        cls.case0 = cls.tracer.trace_case(0)
        cls.case4 = IslandTracer(image, resources).trace_case(4)

    def test_the_first_call_only_loads_the_island_bitmaps(self):
        # SCRANTIC 1010:0136 1008:143c
        self.assertEqual([row[0] for row in self.tracer.load_events], ["sheet", "sheet"])
        self.assertEqual([row[1] for row in self.tracer.load_events], ["BACKGRND.BMP", "MRAFT.BMP"])

    def test_the_island_is_drawn_into_c_and_shown_through_b(self):
        # SCRANTIC 1010:0136
        rows = of_step(self.case0, -1)
        self.assertEqual(rows[0][:2], ["screen", "2"])
        self.assertIn(rows[0][2], ("OCEAN00.SCR", "OCEAN01.SCR", "OCEAN02.SCR"))
        self.assertIn(["copy", "2", "1", "0", "0", "640", "480"], rows)
        self.assertIn(["dirty", "1", "0", "0", "0", "0", "640", "480"], rows)
        self.assertTrue(any(row[:4] == ["sprite", "2", "BACKGRND.BMP", "0"] for row in rows))

    def test_no_island_mode_fills_the_screen_with_color_5(self):
        # SCRANTIC 1010:0136
        rows = of_step(self.case4, -1)
        self.assertEqual(rows[0], ["sheet", "HOLIDAY.BMP"])
        self.assertEqual(rows[1], ["fill", "2", "0", "0", "640", "480", "5"])
        self.assertFalse(any(row[0] == "sprite" and row[2] == "BACKGRND.BMP" and row[3] == "0" for row in rows))

    def test_overlap_answers_follow_the_rule(self):
        answers = [row[7] for step in range(-1, STEPS) for row in of_step(self.case0, step) if row[0] == "overlaps"]
        self.assertEqual(answers, ["1" if n % 3 == 1 else "0" for n in range(len(answers))])

    def test_every_step_ends_with_a_state_row(self):
        for step in range(-1, STEPS):
            self.assertEqual(of_step(self.case0, step)[-1][0], "state", step)

    def test_cases_cover_the_grid(self):
        self.assertEqual(CASES, 24)


if __name__ == "__main__":
    unittest.main()
