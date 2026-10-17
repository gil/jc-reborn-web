import unittest
from collections import Counter
from pathlib import Path

from corpus import CHUNKED_TYPES, compressed_chunks, load_resources, walk_chunks

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"


@unittest.skipUnless((DATA / "RESOURCE.MAP").exists(), "needs public/data/RESOURCE.MAP")
class CorpusTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.resources = load_resources(DATA)

    def test_lists_every_resource(self):
        self.assertEqual(
            Counter(resource.name[-4:] for resource in self.resources),
            {".BMP": 117, ".TTM": 41, ".SCR": 10, ".ADS": 10, ".PAL": 1, ".VIN": 1},
        )

    def test_chunk_trees_cover_every_payload(self):
        for resource in self.resources:
            if resource.name[-4:] in CHUNKED_TYPES:
                with self.subTest(resource.name):
                    self.assertTrue(walk_chunks(resource.payload))

    def test_finds_every_compressed_chunk(self):
        self.assertEqual(
            Counter(chunk.path for _, chunk in compressed_chunks(self.resources)),
            {"BMP:BIN:": 117, "TT3:": 41, "SCR:BIN:": 10, "ADS:SCR:": 10, "BMP:VGA:": 2},
        )

    def test_walk_rejects_a_chunk_that_overruns_its_parent(self):
        with self.assertRaises(ValueError):
            walk_chunks(b"BIN:\x10\x00\x00\x00abc")


if __name__ == "__main__":
    unittest.main()
