import csv
import unittest
from pathlib import Path

from ne_image import ImportTarget, NeImage

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
GHIDRA_RELOCATIONS = REPO / "re/out/relocations.tsv"

RELOCATIONS_PER_SEGMENT = [27, 250, 89, 134, 54, 59, 205, 206, 107, 33, 49, 104, 19, 10]


def ghidra_address(segment: int, offset: int) -> str:
    return f"{0x1000 + (segment - 1) * 8:04x}:{offset:04x}"


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class NeImageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_header(self):
        self.assertEqual(len(self.image.segments), 14)
        self.assertEqual(self.image.auto_data_segment, 14)
        self.assertEqual(self.image.modules, ["MMSYSTEM", "GDI", "KERNEL", "USER"])
        self.assertEqual(len(self.image.entry_points), 5)

    def test_segment_sizes(self):
        self.assertEqual(len(self.image.segments[0].data), 0x28A9)
        self.assertEqual(len(self.image.segments[13].data), 0x47C0)
        self.assertTrue(self.image.segments[13].is_data)
        self.assertFalse(self.image.segments[0].is_data)

    def test_relocation_counts(self):
        self.assertEqual([len(s.relocations) for s in self.image.segments], RELOCATIONS_PER_SEGMENT)

    def test_imports_resolve_to_named_modules(self):
        imports = {r.target for s in self.image.segments for r in s.relocations if isinstance(r.target, ImportTarget)}
        self.assertIn(ImportTarget("KERNEL", 113), imports)
        self.assertIn(ImportTarget("KERNEL", 91), imports)

    @unittest.skipUnless(GHIDRA_RELOCATIONS.exists(), "needs scripts/re/ghidra-import.sh output")
    def test_relocation_sites_match_ghidra(self):
        with GHIDRA_RELOCATIONS.open() as f:
            ghidra = {row["address"] for row in csv.DictReader(f, delimiter="\t")}
        ours = {ghidra_address(s.index, r.offset) for s in self.image.segments for r in s.relocations}
        self.assertEqual(ours, ghidra)


if __name__ == "__main__":
    unittest.main()
