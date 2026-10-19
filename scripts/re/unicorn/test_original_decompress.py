import struct
import unittest
from pathlib import Path

from corpus import compressed_chunks, load_resources
from ne_image import NeImage
from original_decompress import OpenFailed, chunk_body, decompress_original, pack_codes

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
BINARY = DATA / "SCRANTIC.SCR"

STORED = 0
RLE = 1
LZW = 2


def width_growth_codes() -> list[tuple[int, int]]:
    return [(65, 9), *((code, 9) for code in range(257, 512)), (512, 10)]


def table_full_codes() -> list[tuple[int, int]]:
    codes = [(65, 9)]
    width, free = 9, 257
    for i in range(1, 4096 - 256):
        if free > (1 << width) - 1 and width < 12:
            width += 1
        codes.append((66 if i % 2 else 65, width))
        free += 1
    return [*codes, (4095, 12), (300, 12), (65, 12)]


def table_full_output() -> bytes:
    fill = b"A" + b"BA" * ((4096 - 257) // 2) + b"B"
    return fill + b"AB" + b"BA" + b"A"


# name -> (chunk body, expected original output)
EDGE_CASES = {
    "stored": (chunk_body(STORED, 3, bytes([1, 2, 3])), bytes([1, 2, 3])),
    "stored truncated": (chunk_body(STORED, 5, bytes([1, 2])), bytes([1, 2])),
    "stored past size": (chunk_body(STORED, 2, bytes([1, 2, 3])), bytes([1, 2])),
    "rle literal": (chunk_body(RLE, 3, bytes([0x03, 1, 2, 3])), bytes([1, 2, 3])),
    "rle run": (chunk_body(RLE, 3, bytes([0x83, 0xAA])), bytes([0xAA] * 3)),
    "rle zero run": (chunk_body(RLE, 2, bytes([0x80, 0xFF, 0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle zero literal": (chunk_body(RLE, 2, bytes([0x00, 0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle truncated": (chunk_body(RLE, 5, bytes([0x02, 0xDE, 0xAD])), bytes([0xDE, 0xAD])),
    "rle run past size": (chunk_body(RLE, 2, bytes([0x85, 0xAA])), bytes([0xAA] * 2)),
    "rle literal past size": (chunk_body(RLE, 2, bytes([0x04, 1, 2, 3, 4])), bytes([1, 2])),
    "rle run without value": (chunk_body(RLE, 3, bytes([0x83])), bytes([0xFF] * 3)),
    "lzw new entry": (chunk_body(LZW, 4, pack_codes([(65, 9), (66, 9), (257, 9)])), b"ABAB"),
    "lzw kwkwk": (chunk_body(LZW, 3, pack_codes([(65, 9), (257, 9)])), b"AAA"),
    "lzw truncated": (chunk_body(LZW, 10, pack_codes([(65, 9), (66, 9)])), b"AB"),
    "lzw partial last code": (chunk_body(LZW, 5, bytes([0x41, 0x84, 0xFC])), b"AB"),
    "lzw clear": (chunk_body(LZW, 2, pack_codes([(65, 9), (256, 9), (0, 54), (66, 9)])), b"AB"),
    "lzw clear drops group": (chunk_body(LZW, 3, pack_codes([(65, 9), (256, 9), (66, 9), (0, 45), (67, 9)])), b"AC"),
    "lzw code 256 after clear": (chunk_body(LZW, 5, pack_codes([(65, 9), (256, 9), (0, 54), (256, 9)])), b"AAA"),
    "lzw empty": (chunk_body(LZW, 5, b""), bytes([0xFF])),
    "lzw first code above 255": (chunk_body(LZW, 5, pack_codes([(300, 9), (65, 9)])), bytes([0x2C, 0x41])),
    "lzw width growth": (chunk_body(LZW, 33153, pack_codes(width_growth_codes())), b"A" * 33153),
    "lzw table full": (chunk_body(LZW, 5000, pack_codes(table_full_codes())), table_full_output()),
}


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class OriginalDecompressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_edge_cases(self):
        # SCRANTIC 1028:0615 1028:0a0d 1028:0875
        for name, (body, expected) in EDGE_CASES.items():
            with self.subTest(name):
                self.assertEqual(decompress_original(self.image, body, 0, len(body)), expected)

    def test_unknown_method_fails_to_open(self):
        # SCRANTIC 1028:0547
        body = chunk_body(3, 1, b"\x00")
        with self.assertRaises(OpenFailed):
            decompress_original(self.image, body, 0, len(body))

    def test_first_corpus_chunk_of_each_method_decompresses_fully(self):
        firsts = {}
        for resource, chunk in compressed_chunks(load_resources(DATA)):
            firsts.setdefault(resource.payload[chunk.body_offset], (resource, chunk))
        self.assertEqual(sorted(firsts), [RLE, LZW])
        for resource, chunk in firsts.values():
            with self.subTest(f"{resource.name} {chunk.path}"):
                (size,) = struct.unpack_from("<I", resource.payload, chunk.body_offset + 1)
                output = decompress_original(self.image, resource.payload, chunk.body_offset, chunk.size)
                self.assertEqual(len(output), size)


if __name__ == "__main__":
    unittest.main()
