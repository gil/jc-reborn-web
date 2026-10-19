import random
import struct
import unittest
from pathlib import Path

from emulator import INITIAL_SP, Emulator, UnstubbedImport
from ne_image import SRC_FAR_ADDR, ImportTarget, NeImage

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class EmulatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def setUp(self):
        self.emu = Emulator(self.image)

    def test_import_far_pointers_point_at_their_stub(self):
        checked = 0
        for segment, site, relocation in self.emu.fixup_sites:
            if relocation.source_type != SRC_FAR_ADDR or not isinstance(relocation.target, ImportTarget):
                continue
            offset, paragraph = struct.unpack("<HH", self.emu.read(self.emu.paragraphs[segment], site, 4))
            self.assertEqual((paragraph, offset), self.emu.import_address(relocation.target.module, relocation.target.ordinal))
            checked += 1
        self.assertGreater(checked, 100)

    def test_ahshift_sites_hold_the_real_mode_shift(self):
        sites = [(s, o) for s, o, r in self.emu.fixup_sites if r.target == ImportTarget("KERNEL", 113)]
        self.assertTrue(sites)
        for segment, site in sites:
            self.assertEqual(struct.unpack("<H", self.emu.read(self.emu.paragraphs[segment], site, 2))[0], 12)

    def test_rtl_lxmul_matches_python(self):
        # SCRANTIC 1000:0302
        rng = random.Random(1992)
        for _ in range(200):
            a, b = rng.getrandbits(32), rng.getrandbits(32)
            regs = self.emu.call_far(
                "1000:0302",
                regs={"ax": a & 0xFFFF, "dx": a >> 16, "bx": b & 0xFFFF, "cx": b >> 16},
            )
            self.assertEqual((regs["dx"] << 16) | regs["ax"], (a * b) & 0xFFFFFFFF, f"{a:#x} * {b:#x}")

    def test_rtl_scopy_copies_and_pops_its_arguments(self):
        # SCRANTIC 1000:033a
        payload = b"Johnny 1992!!"
        src_segment, src_offset = self.emu.alloc(len(payload))
        dst_segment, dst_offset = self.emu.alloc(len(payload))
        self.emu.write(src_segment, src_offset, payload)
        regs = self.emu.call_far(
            "1000:033a",
            regs={"cx": len(payload)},
            stack_words=[dst_segment, dst_offset, src_segment, src_offset],
        )
        self.assertEqual(self.emu.read(dst_segment, dst_offset, len(payload)), payload)
        self.assertEqual(regs["sp"], INITIAL_SP)

    def test_stub_sets_registers_and_pops_arguments(self):
        self.emu.add_stub("KERNEL", 18, lambda emu: {"ax": 0x1234, "dx": 0x5678}, arg_bytes=2)
        regs = self.emu.call_far(self.emu.import_address("KERNEL", 18), stack_words=[0xBEEF])
        self.assertEqual((regs["ax"], regs["dx"]), (0x1234, 0x5678))
        self.assertEqual(regs["sp"], INITIAL_SP)

    def test_unstubbed_import_raises(self):
        with self.assertRaises(UnstubbedImport) as raised:
            self.emu.call_far(self.emu.import_address("KERNEL", 15))
        self.assertEqual(raised.exception.target, ImportTarget("KERNEL", 15))

    def test_replaced_function_runs_the_handler_with_its_arguments(self):
        seen = []

        def handler(emu):
            seen.append([emu.arg(i) for i in range(3)])
            return {"ax": 0x4242}

        self.emu.replace_function("1000:0302", handler)
        regs = self.emu.call_far("1000:0302", stack_words=[3, 2, 1])
        self.assertEqual(seen, [[1, 2, 3]])
        self.assertEqual(regs["ax"], 0x4242)
        self.assertEqual(regs["sp"], INITIAL_SP - 6)

    def test_near_alloc_hands_out_disjoint_words_after_the_data(self):
        first = self.emu.near_alloc(3)
        second = self.emu.near_alloc(4)
        self.assertEqual(first, 0x47C0)
        self.assertEqual(second, first + 4)
        with self.assertRaises(MemoryError):
            self.emu.near_alloc(0x10000)

    def test_data_segment_is_the_auto_data_paragraph(self):
        self.assertEqual(self.emu.data_segment, self.emu.paragraphs[self.image.auto_data_segment])


if __name__ == "__main__":
    unittest.main()
