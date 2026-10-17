import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_loaders import TtmIndex, find_chunks_original, load_bmp_original, load_palette_original, load_screen_original, load_ttm_original

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


PALETTE = chunk("PAL:", chunk("VGA:", bytes(range(64)) * 12), container=True)


def level(value: int) -> int:
    return 0xFF if value == 63 else value * 4


def screen(width: int, height: int, packed: bytes, with_dim: bool = True) -> bytes:
    dim = chunk("DIM:", words(width, height)) if with_dim else b""
    return chunk("SCR:", dim + chunk("BIN:", stored(packed)), container=True)


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class PaletteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_sixteen_color_mode_reads_16_colors_through_the_level_table(self):
        self.assertEqual(load_palette_original(self.image, "TEST.PAL", PALETTE), bytes(level(v) for v in range(48)))

    def test_other_modes_read_256_colors(self):
        colors = load_palette_original(self.image, "TEST.PAL", PALETTE, color_mode=0)
        self.assertEqual(len(colors), 768)
        self.assertEqual(colors[60:65], bytes([240, 244, 248, 255, 0]))


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class ScreenTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_strips_of_64_rows_cut_to_the_height(self):
        packed = bytes(range(140))
        result = load_screen_original(self.image, "TEST.SCR", screen(4, 70, packed))
        self.assertEqual((result.status, result.widths, result.strips), (1, {4}, [(0, 64), (64, 6)]))
        self.assertEqual(result.pixels, packed)

    def test_first_strip_is_not_cut_to_a_short_height(self):
        result = load_screen_original(self.image, "TEST.SCR", screen(4, 2, bytes([0x12, 0x34, 0x56, 0x78])))
        self.assertEqual(result.strips, [(0, 64)])
        self.assertEqual(result.pixels[:4], bytes([0x12, 0x34, 0x56, 0x78]))

    def test_default_size_is_320_by_400(self):
        result = load_screen_original(self.image, "TEST.SCR", screen(0, 0, bytes(160 * 400), with_dim=False))
        self.assertEqual(result.widths, {320})
        self.assertEqual(sum(rows for _, rows in result.strips), 400)


BMP_PIXELS = bytes([0x12, 0x34, 0x56, 0x78, 0x9A])


def bitmap(widths: list[int], heights: list[int], packed: bytes, extra: bytes = b"") -> bytes:
    info = chunk("INF:", words(len(widths), *widths, *heights))
    return chunk("BMP:", info + chunk("BIN:", stored(packed)) + extra, container=True)


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class BitmapTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_info_lists_widths_then_heights_and_one_buffer_holds_every_image(self):
        result = load_bmp_original(self.image, "TEST.BMP", bitmap([2, 4], [1, 2], BMP_PIXELS))
        self.assertEqual((result.widths, result.heights, result.packed), ([2, 4], [1, 2], BMP_PIXELS))

    def test_vga_layer_is_ignored_in_16_color_mode(self):
        vga = chunk("VGA:", stored(bytes([0xFF] * len(BMP_PIXELS))))
        result = load_bmp_original(self.image, "TEST.BMP", bitmap([2, 4], [1, 2], BMP_PIXELS, vga))
        self.assertEqual(result.packed, BMP_PIXELS)


TWO_PAGES = words(0x1111, 7, 0x0FF0, 0x2002, 1, 2, 0x0FF0)


def ttm(page_count: int | None, bytecode: bytes) -> bytes:
    pag = chunk("PAG:", words(page_count)) if page_count is not None else b""
    tti = chunk("TTI:", chunk("TAG:", words(1, 9) + b"x\0"), container=True)
    return chunk("VER:", b"4.09\0") + pag + chunk("TT3:", stored(bytecode)) + tti


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class TtmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def load(self, page_count: int | None, bytecode: bytes) -> TtmIndex:
        return load_ttm_original(self.image, "TEST.TTM", ttm(page_count, bytecode))

    def test_pages_end_at_0x0ff0_and_tags_record_their_page(self):
        self.assertEqual(self.load(2, TWO_PAGES), TtmIndex(1, 2, [0, 6], [(7, 0)]))

    def test_missing_page_count_means_330_and_indexing_stops_at_the_end(self):
        self.assertEqual(self.load(None, TWO_PAGES), TtmIndex(0, 330, [0, 6, 14], [(7, 0)]))

    def test_arg_codes_8_to_14_fail_the_index(self):
        self.assertEqual(self.load(1, words(0x0018, 0x0FF0)).status, 0xFFFF)

    def test_string_args_are_padded_to_even_length(self):
        bytecode = words(0xF01F) + b"AB\0\0" + words(0x0FF0) + words(0xF02F) + b"ABC\0" + words(0x0FF0)
        self.assertEqual(self.load(2, bytecode).page_offsets, [0, 8])

    def test_af1f_takes_a_count_and_that_many_word_pairs(self):
        self.assertEqual(self.load(2, words(0xAF1F, 2, 1, 2, 3, 4, 0x0FF0, 0x0FF0)).page_offsets, [0, 14])


if __name__ == "__main__":
    unittest.main()
