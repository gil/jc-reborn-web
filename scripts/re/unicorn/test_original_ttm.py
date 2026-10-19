import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_ttm import TtmTracer

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000
CLIP = [1, 0, 0, 639, 479]


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


BYTECODE = words(
    0x1111, 1, 0x1021, 7, 0x2002, 5, 12, 0xA0A4, 1, 2, 3, 4, 0x0FF0,
    0x1201, 1, 0x0110, 0x0FF0,
)
TEST_TTM = chunk("VER:", b"4.09\0") + chunk("PAG:", words(2)) + chunk("TT3:", stored(BYTECODE))


def rows_for(rows: list[list[object]], page: int, run: str) -> list[list[object]]:
    return [[row[3], *str(row[4]).split(" ")] if row[4] != "" else [row[3]] for row in rows if row[1] == page and row[2] == run]


def text(*values: object) -> list[str]:
    return [str(value) for value in values]


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class TtmTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tracer = TtmTracer(NeImage.load(BINARY), {"TEST.TTM": TEST_TTM}, "TEST.TTM")
        cls.pages = tracer.pages
        cls.rows = tracer.trace()

    def test_finds_both_pages(self):
        self.assertEqual(self.pages, [0, 1])

    def test_draws_a_line_with_the_island_offset_and_marks_it_dirty(self):
        # SCRANTIC 1058:0608 1058:0179 1058:119e 1050:0a85
        dirty = ["8", "7", "10", "4", *text(*CLIP)]
        self.assertEqual(rows_for(self.rows, 0, "first"), [
            text("line", 1, 8, 7, 10, 9, 5, *CLIP),
            ["dirty", "1", "0", "0", *dirty],
            ["dirty", "1", "0", "1", *dirty],
            ["dirty", "2", "1", "0", *dirty],
            text("result", 1, 7, -1, 0, "-", 0, 0),
            text("thread", 5, 12, 1, 0, 0, 639, 479, 0, 0, 0),
        ])

    def test_redraws_on_replay(self):
        # SCRANTIC 1058:040c
        self.assertEqual(rows_for(self.rows, 0, "replay")[0], text("line", 1, 8, 7, 10, 9, 5, *CLIP))

    def test_goto_and_purge(self):
        # SCRANTIC 1058:0fc3 1058:13a9 1058:0f73
        self.assertEqual(rows_for(self.rows, 1, "first"), [
            text("result", 1, -1, 0, 1, "-", 0, 0),
            text("thread", 5, 12, 1, 0, 0, 639, 479, 0, 0, 0),
        ])


if __name__ == "__main__":
    unittest.main()
