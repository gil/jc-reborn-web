import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_graphics import DC_A, DC_B, DirtyEmulator, build_mask_original, create_brush_original, mirror_rows_original, wipe_shapes_original

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
PALETTE = bytes(value for i in range(16) for value in (i, 0x10 + i, 0x20 + i))


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class BrushTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_colors_below_16_make_a_solid_brush_from_the_palette(self):
        brush = create_brush_original(self.image, 5, PALETTE)
        self.assertEqual(brush.kind, "solid")
        self.assertEqual(brush.colorref[0], 5 | 0x15 << 8)

    def test_colors_from_16_make_an_8x8_4_bit_pattern(self):
        brush = create_brush_original(self.image, 0x12, PALETTE)
        self.assertEqual(brush.kind, "pattern")
        size, width, height, planes, bits = struct.unpack_from("<IiiHH", brush.dib, 0)
        self.assertEqual((size, width, height, planes, bits), (0x28, 8, 8, 1, 4))
        self.assertEqual(brush.dib[0x28 + 4 * 3:0x28 + 4 * 4], bytes([0x23, 0x13, 0x03, 0]))
        rows = [brush.dib[0x68 + 4 * k:0x68 + 4 * k + 4] for k in range(8)]
        self.assertEqual(rows, [bytes([0x12] * 4), bytes([0x21] * 4)] * 4)


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class MaskTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_mask_bit_is_set_for_every_non_zero_index_left_pixel_first(self):
        packed = bytes([0x10, 0x00, 0x02, 0x30, 0x00, 0x00, 0x00, 0x01]) + bytes(8)
        call = build_mask_original(self.image, 16, 2, packed)
        self.assertEqual((call.width, call.height, call.planes, call.bits_per_pixel), (16, 2, 1, 1))
        self.assertEqual(call.bits, bytes([0b10000110, 0b00000001, 0, 0]))

    def test_mirror_reverses_each_row_pixel_by_pixel(self):
        packed = bytes([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0]) * 2
        mirrored = mirror_rows_original(self.image, 16, 2, packed)
        self.assertEqual(mirrored, bytes([0x0F, 0xED, 0xCB, 0xA9, 0x87, 0x65, 0x43, 0x21]) * 2)


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class DirtyListTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_kind_1_rects_become_8_pixel_columns(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 13, 5, 10, 4, 1, DC_B, DC_A, 0, None, 0])
        self.assertEqual(dirty.lists(), [[0, [[1, 5, 2, 4, DC_B, DC_A, 1, 0, 8, 0]]]])

    def test_neighbours_merge_when_the_union_wastes_at_most_20(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 0, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        dirty.run(["add", 8, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        self.assertEqual(dirty.lists(), [[0, [[0, 0, 2, 8, DC_B, DC_A, 1, 0, 16, 0]]]])

    def test_replay_copies_head_to_tail_in_pixels_and_empties_the_list(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 0, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        dirty.run(["add", 400, 400, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        events = dirty.run(["replay", DC_B, DC_A, 0])
        self.assertEqual(events, [["copy", DC_B, DC_A, 400, 400, 8, 8], ["copy", DC_B, DC_A, 0, 0, 8, 8]])
        self.assertEqual(dirty.lists(), [])


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class WipeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_right_to_left_fills_strips_of_a_hundredth_of_the_width(self):
        shapes = wipe_shapes_original(self.image, "right-to-left", 0, 0, 640, 480)
        self.assertEqual(len(shapes), 107)
        self.assertEqual(shapes[0], ["rect", 634, 0, 640, 480])
        self.assertEqual(shapes[-1], ["rect", -2, 0, 4, 480])

    def test_ellipse_grows_its_radius_by_1_then_2_then_3(self):
        shapes = wipe_shapes_original(self.image, "ellipse", 0, 0, 640, 480)
        self.assertEqual(shapes[:3], [["ellipse", 318, 238, 322, 242], ["ellipse", 316, 236, 324, 244], ["ellipse", 313, 233, 327, 247]])
        self.assertEqual(len(shapes), 25)


if __name__ == "__main__":
    unittest.main()
