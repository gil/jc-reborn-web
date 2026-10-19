import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_ads import AdsTracer

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


TTM = chunk("VER:", b"4.09\0") + chunk("PAG:", words(2)) + chunk("TT3:", stored(words(0x1111, 1, 0x0FF0, 0x0110, 0x0FF0)))
SCRIPT = words(
    1,
    0x1330, 1, 1, 0x2005, 1, 1, 0, 1, 0x1510,
    0x1350, 1, 1, 0xF010, 0xFFFF, 0x1510,
    0xFFFF,
)
ADS = chunk("VER:", b"4.09\0") + chunk("ADS:", chunk("RES:", words(1, 1) + b"A.TTM\0") + chunk("SCR:", stored(SCRIPT)), True)


def rows_of(rows: list[list[object]], tick: int) -> list[list[str]]:
    return [[str(row[3]), *str(row[4]).split(" ")] for row in rows if row[2] == tick]


def text(*values: object) -> list[str]:
    return [str(value) for value in values]


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class AdsTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = NeImage.load(BINARY)
        resources = {"TEST.ADS": ADS, "A.TTM": TTM}
        cls.tags = AdsTracer(image, resources, "TEST.ADS").section_tags()
        cls.rows = AdsTracer(image, resources, "TEST.ADS").trace_section(1)

    def test_lists_the_section_tags(self):
        # SCRANTIC 1048:04fc
        self.assertEqual(self.tags, [1])

    def test_first_tick_starts_the_scene_and_runs_its_tag_page(self):
        # SCRANTIC 1048:0874 1048:1acb 1048:1223 1048:0db6 1048:196e
        self.assertEqual(rows_of(self.rows, 0), [
            text("tick", 1, 1, 0),
            text("order", "1:1"),
            text("section", 0, 1, 0, -1),
            text("node", 1, 1, 1, 1, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0),
        ])

    def test_a_purge_finishes_a_scene_played_once(self):
        # SCRANTIC 1048:1acb 1048:196e
        self.assertEqual(rows_of(self.rows, 1), [
            text("tick", 1, 1, 0),
            text("node", 1, 1, 4, 0, -1, 1, 0, 0, 1, 0, 1, 0, 0, 0),
        ])

    def test_the_done_scene_stops_the_section_and_ends_the_run(self):
        # SCRANTIC 1048:1758 1048:1669 1048:0766
        self.assertEqual(rows_of(self.rows, 2), [
            text("tick", 0, 0, 0),
            text("section", 0, 2, 0, -1),
            text("node", 1, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, 0, 0, 0),
        ])
        self.assertEqual(max(row[2] for row in self.rows), 2)


if __name__ == "__main__":
    unittest.main()
