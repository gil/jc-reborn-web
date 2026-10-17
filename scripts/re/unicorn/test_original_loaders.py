import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_loaders import find_chunks_original

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


TTM_LIKE = chunk("VER:", b"4.09\0") + chunk("TTI:", chunk("TAG:", words(1) + b"A\0"), container=True) + chunk("PAG:", words(3))


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class FindChunkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def find(self, *paths: str):
        return find_chunks_original(self.image, "TEST.TTM", TTM_LIKE, list(paths))

    def test_top_level_and_nested_paths(self):
        for path, expected in {"VER:": (8, 5), "TTI:": (21, 12), "TTI:TAG:": (29, 4), "PAG:": (41, 2)}.items():
            with self.subTest(path=path):
                self.assertEqual(self.find(path), [expected])

    def test_last_tag_alone_does_not_match_a_nested_chunk(self):
        self.assertEqual(self.find("TAG:"), [None])

    def test_paths_not_made_of_4_byte_tags_fail(self):
        for path in ("", "PAG", "XYZ:"):
            with self.subTest(path=path):
                self.assertEqual(self.find(path), [None])

    def test_search_only_moves_forward(self):
        self.assertEqual(self.find("VER:", "PAG:"), [(8, 5), (41, 2)])
        self.assertEqual(self.find("PAG:", "VER:"), [(41, 2), None])

    def test_same_path_twice_returns_the_same_chunk(self):
        self.assertEqual(self.find("PAG:", "PAG:"), [(41, 2), (41, 2)])

    def test_a_failed_search_leaves_the_reader_where_it_was(self):
        self.assertEqual(self.find("VER:", "XYZ:", "PAG:"), [(8, 5), None, (41, 2)])


if __name__ == "__main__":
    unittest.main()
