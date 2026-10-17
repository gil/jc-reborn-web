# Step 1: Colors and Bitmap Masks

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** none

**Files:**

- Create: `scripts/re/unicorn/original_graphics.py`, `scripts/re/unicorn/dump_graphics.py`, `scripts/re/unicorn/test_original_graphics.py`
- Create: `src/gfx/gdi/color.ts`, `src/gfx/gdi/color.test.ts`, `src/gfx/gdi/color.data.test.ts`, `src/gfx/gdi/masks.data.test.ts`
- Create: `docs/re/graphics.md`
- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated), `docs/re/open-questions.md` (OQ-14 only), `scripts/re/unicorn/README.md` (one section)

**Interfaces:**

- Consumes (exist already): `Emulator` (`scripts/re/unicorn/emulator.py`: `call_far(address, stack_words=[...])`, `add_stub(module, ordinal, handler, arg_bytes)`, `replace_function(address, handler)`, `arg(i)` = word `i` above the return address, `near_alloc(size)`, `alloc(size) -> (segment, 0)`, `read(segment, offset, size)`, `write(segment, offset, data)`, `data_segment`), `NeImage.load(path)`, `install_heap(emu)` (`original_decompress.py`), `load_bmp_original(image, name, payload) -> BitmapImages(widths, heights, packed)` (`original_loaders.py`), `load_resources(data_dir) -> list[Resource(name, payload, ...)]` (`corpus.py`). TypeScript: `decodeBmp(payload).sprites` (`src/decode/bmp.ts`), `TRANSPARENT` (`src/types.ts`), `hasCorpus`, `hasFixture`, `readFixtureRows`, `readFixtureBytes`, `loadArchive` (`src/testing/corpus.ts`), `packNibbles(indexed)` (`src/testing/nibbles.ts`).
- Produces:
  - `src/gfx/gdi/color.ts`: `colorIndex(color: number): number` (`color & 0x0f`), `brushColorAt(color: number, x: number, y: number): number` (palette index the original's brush for `color` paints at screen pixel `(x, y)`).
  - `scripts/re/unicorn/original_graphics.py`: `new_graphics_emulator(image)`, `pascal_args(emu, count)`, `set_byte(emu, offset, value)`, `set_word(emu, offset, value)`, `put_palette(emu, rgb)`, `create_brush_original(image, color, palette) -> Brush`, `build_mask_original(image, width, height, packed) -> MaskCall`, `mirror_rows_original(image, width, height, packed) -> bytes`, `masks_and_mirrors_original(image, widths, heights, packed) -> tuple[bytes, bytes]`.
  - `scripts/re/unicorn/dump_graphics.py` with commands `brushes` and `masks`; fixtures `re/fixtures/graphics/brushes.tsv`, `re/fixtures/graphics/masks.tsv`, `re/fixtures/graphics/<NAME>.BMP.masks.bin`, `re/fixtures/graphics/<NAME>.BMP.mirrored.bin`.
  - `docs/re/graphics.md` with all sections from the overview (empty ones hold `None yet.`).

Corpus fact checked during planning: all 2,392 images in the 117 BMPs have a width that is a multiple of 16, so the mask builder's stride and remainder quirks (overview, "Bitmap masks and flips") never trigger on real data.

## Part A: Python harness

- [ ] **Action 1: Write the harness module**

Create `scripts/re/unicorn/original_graphics.py`:

```python
import struct
from dataclasses import dataclass

from emulator import Emulator
from ne_image import NeImage
from original_decompress import install_heap

NEAR_MALLOC = "1038:0619"
COLOR_MODE = 0x1EBD
SIXTEEN_COLOR_MODE = 2
ACTIVE_PALETTE = 0x25AE
CREATE_COLOR_BRUSH = "1038:1d31"
BUILD_MASK = "1040:035c"
MIRROR_ROWS = "1040:054e"
RECORD_SIZE = 14
RECORD_WIDTH = 6
RECORD_HEIGHT = 8
FIRST_GLOBAL_HANDLE = 0x2000
DIB_SIZE = 0x28 + 16 * 4 + 8 * 4


def new_graphics_emulator(image: NeImage) -> Emulator:
    emu = Emulator(image)
    install_heap(emu)
    emu.replace_function(NEAR_MALLOC, _near_malloc)
    set_byte(emu, COLOR_MODE, SIXTEEN_COLOR_MODE)
    return emu


def _near_malloc(emu: Emulator):
    size = emu.arg(0)
    offset = emu.near_alloc(size)
    emu.write(emu.data_segment, offset, bytes(size))
    return {"ax": offset}


def pascal_args(emu: Emulator, count: int) -> list[int]:
    return [emu.arg(count - 1 - i) for i in range(count)]


def set_byte(emu: Emulator, offset: int, value: int):
    emu.write(emu.data_segment, offset, bytes([value & 0xFF]))


def set_word(emu: Emulator, offset: int, value: int):
    emu.write(emu.data_segment, offset, struct.pack("<H", value & 0xFFFF))


def put_palette(emu: Emulator, rgb: bytes):
    offset = emu.near_alloc(len(rgb))
    emu.write(emu.data_segment, offset, rgb)
    set_word(emu, ACTIVE_PALETTE, offset)


@dataclass
class Brush:
    kind: str
    colorref: tuple[int, int] | None
    dib: bytes | None


def create_brush_original(image: NeImage, color: int, palette: bytes) -> Brush:
    emu = new_graphics_emulator(image)
    put_palette(emu, palette)
    blocks: dict[int, int] = {}
    brushes: list[Brush] = []

    def global_alloc(emu: Emulator):
        _flags, high, low = pascal_args(emu, 3)
        segment, _ = emu.alloc(low | high << 16)
        handle = FIRST_GLOBAL_HANDLE + len(blocks)
        blocks[handle] = segment
        return {"ax": handle}

    def solid_brush(emu: Emulator):
        high, low = pascal_args(emu, 2)
        brushes.append(Brush("solid", (low, high), None))
        return {"ax": 0x3001}

    def pattern_brush(emu: Emulator):
        handle, _usage = pascal_args(emu, 2)
        brushes.append(Brush("pattern", None, emu.read(blocks[handle], 0, DIB_SIZE)))
        return {"ax": 0x3002}

    emu.add_stub("KERNEL", 15, global_alloc, arg_bytes=6)
    emu.add_stub("KERNEL", 18, lambda emu: {"ax": 0, "dx": blocks[emu.arg(0)]}, arg_bytes=2)
    emu.add_stub("KERNEL", 19, lambda emu: {"ax": 0}, arg_bytes=2)
    emu.add_stub("KERNEL", 17, lambda emu: {"ax": 0}, arg_bytes=2)
    emu.add_stub("GDI", 66, solid_brush, arg_bytes=4)
    emu.add_stub("GDI", 445, pattern_brush, arg_bytes=4)
    emu.call_far(CREATE_COLOR_BRUSH, stack_words=[0, color])
    if len(brushes) != 1:
        raise RuntimeError(f"color {color:#x}: {len(brushes)} brushes created")
    return brushes[0]


@dataclass
class MaskCall:
    width: int
    height: int
    planes: int
    bits_per_pixel: int
    bits: bytes


def _new_record(emu: Emulator, width: int, height: int) -> int:
    record = emu.near_alloc(RECORD_SIZE)
    emu.write(emu.data_segment, record, bytes(RECORD_SIZE))
    set_word(emu, record + RECORD_WIDTH, width)
    set_word(emu, record + RECORD_HEIGHT, height)
    return record


def _install_create_bitmap(emu: Emulator, calls: list[MaskCall]):
    def create_bitmap(emu: Emulator):
        width, height, planes, bits_per_pixel, segment, offset = pascal_args(emu, 6)
        written_stride = (width + 8) // 16 * 2
        calls.append(MaskCall(width, height, planes, bits_per_pixel, emu.read(segment, offset, height * written_stride)))
        return {"ax": 0x3003}

    emu.add_stub("GDI", 48, create_bitmap, arg_bytes=12)


def build_mask_original(image: NeImage, width: int, height: int, packed: bytes) -> MaskCall:
    emu = new_graphics_emulator(image)
    calls: list[MaskCall] = []
    _install_create_bitmap(emu, calls)
    record = _new_record(emu, width, height)
    segment, offset = emu.alloc(len(packed))
    emu.write(segment, offset, packed)
    emu.call_far(BUILD_MASK, stack_words=[segment, offset, record])
    if len(calls) != 1:
        raise RuntimeError(f"{width}x{height}: {len(calls)} bitmaps created")
    return calls[0]


def mirror_rows_original(image: NeImage, width: int, height: int, packed: bytes) -> bytes:
    emu = new_graphics_emulator(image)
    record = _new_record(emu, width, height)
    segment, offset = emu.alloc(len(packed))
    emu.write(segment, offset, packed)
    emu.call_far(MIRROR_ROWS, stack_words=[segment, offset, record])
    return emu.read(segment, offset, len(packed))


def masks_and_mirrors_original(image: NeImage, widths: list[int], heights: list[int], packed: bytes) -> tuple[bytes, bytes]:
    emu = new_graphics_emulator(image)
    calls: list[MaskCall] = []
    _install_create_bitmap(emu, calls)
    base, _ = emu.alloc(len(packed))
    emu.write(base, 0, packed)
    masks, mirrored = bytearray(), bytearray()
    position = 0
    for width, height in zip(widths, heights):
        size = width // 2 * height
        record = _new_record(emu, width, height)
        segment, offset = base + (position >> 4), position & 0xF
        emu.call_far(BUILD_MASK, stack_words=[segment, offset, record])
        call = calls[-1]
        if (call.width, call.height, call.planes, call.bits_per_pixel) != (width, height, 1, 1):
            raise RuntimeError(f"{width}x{height}: CreateBitmap got {call}")
        masks += call.bits
        emu.call_far(MIRROR_ROWS, stack_words=[segment, offset, record])
        mirrored += emu.read(segment, offset, size)
        position += size
    return bytes(masks), bytes(mirrored)
```

Ordinals used: `KERNEL` 15 `GlobalAlloc`, 17 `GlobalFree`, 18 `GlobalLock`, 19 `GlobalUnlock`; `GDI` 48 `CreateBitmap`, 66 `CreateSolidBrush`, 445 `CreateDIBPatternBrush`. If a call raises `UnstubbedImport`, its message names the module and ordinal the binary really uses; fix the number here and say so in the commit message.

- [ ] **Action 2: Write the Python tests**

Create `scripts/re/unicorn/test_original_graphics.py`:

```python
import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_graphics import build_mask_original, create_brush_original, mirror_rows_original

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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Action 3: Run the Python tests**

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_graphics.py scripts/re/unicorn/test_original_graphics.py`
Expected: no output.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_graphics.py' -v`
Expected: 4 tests pass. If one fails, the expectation came from the planning read and may be wrong: read `re/out/functions/1038_1d31_gfx_createColorBrush.asm`, `1040_035c_gfx_buildBitmapMask.asm`, or `1040_054e_FUN_1040_054e.asm`, decide whether the harness or the expectation is wrong, and fix that one. Whatever you settle, it becomes a finding in Part D.

- [ ] **Action 4: Commit**

```bash
git add scripts/re/unicorn/original_graphics.py scripts/re/unicorn/test_original_graphics.py
git commit -m "test(re): emulate the original brush, mask, and mirror builders"
```

## Part B: Corpus fixtures

- [ ] **Action 5: Write the dump CLI**

Create `scripts/re/unicorn/dump_graphics.py`:

```python
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources
from ne_image import NeImage
from original_graphics import create_brush_original, masks_and_mirrors_original
from original_loaders import load_bmp_original

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/graphics"
PALETTE = bytes(value for i in range(16) for value in (i, 0x10 + i, 0x20 + i))


def write_tsv(name: str, header: list[str], rows: list[list[object]]):
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["\t".join(header), *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / name).write_text("\n".join(lines) + "\n")


def dump_brushes(image: NeImage, resources):
    rows = []
    for color in range(256):
        brush = create_brush_original(image, color, PALETTE)
        if brush.kind == "solid":
            rows.append([color, "solid", f"{brush.colorref[0]:04x}", f"{brush.colorref[1]:04x}", ""])
        else:
            rows.append([color, "pattern", "", "", brush.dib[0x68:].hex()])
    write_tsv("brushes.tsv", ["color", "kind", "colorrefLow", "colorrefHigh", "bits"], rows)


def dump_masks(image: NeImage, resources):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in resources:
        if not resource.name.endswith(".BMP"):
            continue
        bitmap = load_bmp_original(image, resource.name, resource.payload)
        masks, mirrored = masks_and_mirrors_original(image, bitmap.widths, bitmap.heights, bitmap.packed)
        (OUT / f"{resource.name}.masks.bin").write_bytes(masks)
        (OUT / f"{resource.name}.mirrored.bin").write_bytes(mirrored)
        rows.append([resource.name, ",".join(map(str, bitmap.widths)), ",".join(map(str, bitmap.heights)), f"{resource.name}.masks.bin", f"{resource.name}.mirrored.bin"])
    write_tsv("masks.tsv", ["resource", "widths", "heights", "masks", "mirrored"], rows)


COMMANDS = {
    "brushes": dump_brushes,
    "masks": dump_masks,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run original SCRANTIC.SCR graphics code; fixtures go to re/fixtures/graphics/")
    parser.add_argument("what", nargs="*", help=f"fixtures to write, any of {', '.join(sorted(COMMANDS))} (default: all)")
    args = parser.parse_args()
    unknown = sorted(set(args.what) - set(COMMANDS))
    if unknown:
        parser.error(f"unknown fixture {', '.join(unknown)}")
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = load_resources(DATA)
    for name in args.what or sorted(COMMANDS):
        COMMANDS[name](image, resources)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Check `scripts/re/unicorn/corpus.py` for the `Resource` field names (`name`, `payload`) and adjust if they differ.

- [ ] **Action 6: Write the fixtures**

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py brushes masks`
Expected: exits 0; `re/fixtures/graphics/brushes.tsv` has 256 rows; `re/fixtures/graphics/masks.tsv` has 117 rows; 234 `.bin` files.

- [ ] **Action 7: Commit**

```bash
git add scripts/re/unicorn/dump_graphics.py
git commit -m "feat(re): dump original brushes, masks, and mirrored rows"
```

## Part C: TypeScript colors and data tests

- [ ] **Action 8: Write the failing color test**

Create `src/gfx/gdi/color.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brushColorAt, colorIndex } from './color.js';

describe('colorIndex', () => {
  it('keeps the low nibble in 16-color mode', () => {
    // SCRANTIC 1040:097a
    expect(colorIndex(0x1f)).toBe(15);
    expect(colorIndex(7)).toBe(7);
  });
});

describe('brushColorAt', () => {
  it('paints colors below 16 solid', () => {
    // SCRANTIC 1038:1d31
    expect([brushColorAt(5, 0, 0), brushColorAt(5, 3, 7)]).toEqual([5, 5]);
  });

  it('paints colors from 16 as a two-color checkerboard of their nibbles', () => {
    // SCRANTIC 1038:1d31
    const rows = [0, 1, 2].map((y) => [0, 1, 2, 3].map((x) => brushColorAt(0x12, x, y)));
    expect(rows).toEqual([
      [2, 1, 2, 1],
      [1, 2, 1, 2],
      [2, 1, 2, 1],
    ]);
  });
});
```

The row order follows from two GDI rules, not from the binary: a DIB with a positive height is stored bottom-up (buffer row `k` is screen row `7 - k`), and a pattern brush is aligned to the bitmap's origin (default brush origin 0, 0). Buffer row 0 holds the color byte as is (high nibble = left pixel), so screen rows 7, 5, 3, 1 start with the high nibble and screen rows 0, 2, 4, 6 start with the low nibble.

- [ ] **Action 9: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/color.test.ts`
Expected: FAIL, cannot resolve `./color.js`.

- [ ] **Action 10: Implement `color.ts`**

Create `src/gfx/gdi/color.ts`:

```ts
export function colorIndex(color: number): number {
  return color & 0x0f;
}

export function brushColorAt(color: number, x: number, y: number): number {
  if (color < 16) return color;
  const high = color >> 4;
  const low = color & 0x0f;
  const highFirst = (y & 1) === 1;
  const evenColumn = highFirst ? high : low;
  const oddColumn = highFirst ? low : high;
  return (x & 1) === 0 ? evenColumn : oddColumn;
}
```

- [ ] **Action 11: Run it to make sure it passes**

Run: `pnpm exec vitest run src/gfx/gdi/color.test.ts`
Expected: PASS, 3 tests.

- [ ] **Action 12: Write the brush data test**

Create `src/gfx/gdi/color.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../../testing/corpus.js';
import { brushColorAt } from './color.js';

describe.skipIf(!hasFixture('graphics/brushes.tsv'))('brushes match the original SCRANTIC.SCR', () => {
  it('makes a solid brush below 16 and the same 8x8 pattern from 16 on', () => {
    // SCRANTIC 1038:1d31
    const wrong = readFixtureRows('graphics/brushes.tsv').flatMap(([colorText, kind, low, , bits]) => {
      const color = Number(colorText);
      if (color < 16) {
        const expectedLow = color | ((0x10 + color) << 8);
        return kind === 'solid' && parseInt(low!, 16) === expectedLow ? [] : [`${color}: ${kind} ${low}`];
      }
      if (kind !== 'pattern') return [`${color}: ${kind}`];
      const bytes = Uint8Array.from(bits!.match(/../g)!.map((pair) => parseInt(pair, 16)));
      for (let row = 0; row < 8; row++) {
        for (let x = 0; x < 8; x++) {
          const byte = bytes[row * 4 + (x >> 1)]!;
          const index = x & 1 ? byte & 0x0f : byte >> 4;
          if (index !== brushColorAt(color, x, 7 - row)) return [`${color}: buffer row ${row} x ${x}`];
        }
      }
      return [];
    });
    expect(wrong).toEqual([]);
  });
});
```

- [ ] **Action 13: Write the mask and mirror data test**

Create `src/gfx/gdi/masks.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../decode/bmp.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../../testing/corpus.js';
import { packNibbles } from '../../testing/nibbles.js';
import { TRANSPARENT, type Sprite } from '../../types.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

function expectedMask({ width, height, indexed }: Sprite): Uint8Array {
  const bytesPerRow = width / 8;
  const mask = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (indexed[y * width + x] !== TRANSPARENT) mask[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return mask;
}

function mirrored({ width, height, indexed }: Sprite): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = indexed[y * width + width - 1 - x]!;
  }
  return out;
}

describe.skipIf(!hasCorpus)('every BMP image', () => {
  it('has a width that is a multiple of 16, so the mask stride quirks never trigger', () => {
    // SCRANTIC 1040:035c
    const odd = bitmaps().flatMap(({ name, payload }) =>
      decodeBmp(payload).sprites.flatMap(({ width }, i) => (width % 16 === 0 ? [] : [`${name}#${i} ${width}`])),
    );
    expect(odd).toEqual([]);
  });
});

describe.skipIf(!hasFixture('graphics/masks.tsv'))('masks and mirrors match the original SCRANTIC.SCR', () => {
  it('sets a mask bit exactly where the index is not 0, and mirrors rows pixel by pixel', () => {
    // SCRANTIC 1040:035c 1040:054e
    const archive = loadArchive();
    const wrong = readFixtureRows('graphics/masks.tsv').flatMap(([name, , , masksFile, mirroredFile]) => {
      const { sprites } = decodeBmp(archive.byName.get(name!)!.payload);
      const masks = readFixtureBytes(`graphics/${masksFile}`);
      const mirrors = readFixtureBytes(`graphics/${mirroredFile}`);
      const errors: string[] = [];
      let maskAt = 0;
      let mirrorAt = 0;
      sprites.forEach((sprite, i) => {
        const mask = expectedMask(sprite);
        if (!masks.subarray(maskAt, maskAt + mask.length).every((byte, j) => byte === mask[j])) errors.push(`${name}#${i} mask`);
        maskAt += mask.length;
        const packed = packNibbles(mirrored(sprite));
        if (!mirrors.subarray(mirrorAt, mirrorAt + packed.length).every((byte, j) => byte === packed[j])) errors.push(`${name}#${i} mirror`);
        mirrorAt += packed.length;
      });
      if (maskAt !== masks.length || mirrorAt !== mirrors.length) errors.push(`${name}: sizes`);
      return errors;
    });
    expect(wrong).toEqual([]);
  });
});
```

- [ ] **Action 14: Run the gdi tests**

Run: `pnpm exec vitest run src/gfx/gdi`
Expected: PASS. The data tests run (fixtures exist). If the brush test fails on the solid branch, the low word layout differs from `R | G << 8`: read `re/out/functions/1040_097a_FUN_1040_097a.asm` and fix the expectation. If the pattern rows fail, compare buffer rows by hand with Action 2's Python test and fix whichever side is wrong.

- [ ] **Action 15: Commit**

```bash
git add src/gfx/gdi/color.ts src/gfx/gdi/color.test.ts src/gfx/gdi/color.data.test.ts src/gfx/gdi/masks.data.test.ts
git commit -m "feat(gfx): original color index and dither brush, mask and mirror checked on every bitmap"
```

## Part D: Findings

- [ ] **Action 16: Read the remaining functions**

Read the pseudo-C and assembly in `re/out/functions/` for: `1040_097a`, `1038_1d31`, `1040_0000`, `1040_035c`, `1040_0462`, `1040_054e`, `1040_0b08`, `1040_0bc7`, `1030_00fe`, `1030_0000`, and the thunks `1028_182c`, `1028_1845` (and the function at `1030:15fb` that `1028:182c` forwards to; it may sit inside another export, find it with `rg -n "1030:15fb" re/out/functions/*.asm`). Answer these and write each answer as a finding:

1. Does `1040:097a` set `DX` (blue) at all? Look at the assembly. If not, `CreateSolidBrush` and `CreatePen` get a blue byte from whatever `DX` held: say so, and log it as OQ-<n> (below) because the drawn color would depend on the driver's nearest-color match.
2. What does `brushes.tsv` show in `colorrefHigh` for colors 0..15? Write the observed values.
3. In `1040:0000`: who sets `1068:2572` (only `1040:0286` clears and sets it), and exactly when entry 0 becomes black. Confirm the pre-mirrored path conditions (`1068:1e22`, `1068:4106`) and which record fields it fills.
4. `1030:00fe`, `1030:0000`, `1030:15fb`: what each frees or counts.

- [ ] **Action 17: Create `docs/re/graphics.md`**

```markdown
# Graphics: Colors, Masks, Primitives, Sprites, Dirty Rects, Buffers, Wipes

Findings for chunk 4. One claim per address. Our own words; no decompiled code.

The original draws with Windows GDI. The binary tells which GDI call runs with which arguments; how GDI turns that into pixels is Windows behavior. Where a claim rests on a GDI rule instead of the binary, it says so.

## Colors

## Bitmap masks and mirrors

## Surfaces and clip

None yet.

## Primitives

None yet.

## Text

None yet.

## Sprites

None yet.

## Scaling (dead code)

None yet.

## Bitmap matrix

None yet.

## Dirty rects

None yet.

## Display buffers

None yet.

## Wipes

None yet.

## Past fixes reviewed

None yet.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
```

Fill `Colors` and `Bitmap masks and mirrors` with one bullet per claim, each starting with its address. At least:

- `1040:097a`: color mode 2 keeps `color % 16`; returns the RGB of that entry of the active palette (`1068:25ae`); the answer to question 1.
- `1038:1d31`: the solid and pattern rules (overview "Colors"), the BGR0 color table, the row parity, emulated on all 256 colors (`re/fixtures/graphics/brushes.tsv`). One bullet for the GDI rules used by `brushColorAt` (bottom-up rows, brush origin 0, 0) marked as GDI behavior.
- `1040:035c`: bit set where the index is not 0, left pixel in bit 7; `width / 8` bytes per row; stride `((width + 8) / 16) * 2`; with a width under 8 the byte loop starts at 0 and runs 65,536 times; a width that is not a multiple of 8 leaves the last pixels unmasked and drifts the source; GDI expects `((width + 15) / 16) * 2`. Then: every image in the data has a width that is a multiple of 16, so none of this happens (`src/gfx/gdi/masks.data.test.ts`). Emulated on every image.
- `1040:0462`, `1040:054e`, `1040:0000`: what each does; the pre-mirrored path only for `JOHNWALK.BMP`; mirrored rows equal our sprite read right to left on every image.
- `1040:0b08`, `1040:0bc7`: point to `docs/re/decoders.md` `Palette` for the full claims and add anything new.
- `1030:00fe`, `1030:0000`, `1030:15fb`, `1028:182c`, `1028:1845`: one bullet each.

Add checklist rows: `1040:097a` → `src/gfx/gdi/color.ts:1` `colorIndex`, `fixed`; `1038:1d31` → `src/gfx/gdi/color.ts:5` `brushColorAt`, `fixed` (the old pipeline masks colors with `& 0x0f` and never dithers); `1040:035c`, `1040:0462`, `1040:054e`, `1040:0000` → `none (the model blits sprites from raw indices; index 0 is see-through, see Sprites)`, `match`; `1040:0b08` / `1040:0bc7` → `src/gfx/palette.ts:7` `setPaletteColors`, `match`; `1030:00fe`, `1030:0000`, `1030:15fb`, `1028:182c`, `1028:1845` → `none (garbage collected)` or what fits, `match`. Use the real line numbers from the files.

- [ ] **Action 18: Log open questions**

In `docs/re/open-questions.md`:

- If question 1 found that blue is not set, add under "Workarounds without a known root cause" (use the next free OQ number):

```markdown
### OQ-<n>: Pen and solid brush colors may lose their blue byte

- **Where:** `1040:097a`, used by `1030:02ef`, `1038:1bd8`, `1040:0688`, `1040:0d54`, `1038:1d31`
- **What it does:** returns red and green in `AX` and leaves `DX` (blue) as it was. <what the assembly shows>
- **Ours:** `src/gfx/gdi/` keeps palette indices, so the blue byte never matters in the model.
- **Resolve in:** none until we model the display driver's color matching; out of scope
- **Status:** open, by choice
```

- Edit OQ-14: the three forwarders `1028:17d8`, `1028:182c`, `1028:1845`: write what `1028:182c` and `1028:1845` reach, and leave `1028:17d8` for step 3.

- [ ] **Action 19: Name the functions**

In `scripts/re/names.json`, entries live under `"functions"`, sorted by address, and look like this:

```json
"1040:054e": {
  "name": "gfx_mirrorPixelRows",
  "subsystem": "gfx",
  "status": "verified",
  "note": "Mirrors each packed pixel row left to right in place (byte order and nibble order); builds the pre-mirrored JOHNWALK images",
  "signature": null,
  "callingConvention": null
}
```

Add or update: `1040:097a` `gfx_paletteColor`, `1040:054e` `gfx_mirrorPixelRows`, `1030:00fe` `gfx_freeBitmaps`, `1030:0000` and `1030:15fb` and `1028:182c` / `1028:1845` with names that fit what you read (`gfx_` subsystem). Set status `verified` for every function in this step's scope whose checklist row is `match` or `fixed`: `1040:097a`, `1038:1d31`, `1040:0000`, `1040:035c`, `1040:0462`, `1040:054e`, `1040:0b08`, `1040:0bc7`, `1030:00fe`, `1030:0000`, `1028:182c`, `1028:1845`. Notes are one line, our own words.

Run: `node scripts/re/function-map.mjs`
Expected: no errors; `docs/re/function-map.md` regenerated.

- [ ] **Action 20: README**

Append to `scripts/re/unicorn/README.md`:

```markdown
## Original graphics

    re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py
    re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py brushes masks

Runs original graphics code that needs no drawing (brush and mask builders, row mirror, and later the dirty-rect lists and wipe geometry) and writes fixtures to `re/fixtures/graphics/` (gitignored). `original_graphics.py` stubs the few GDI and KERNEL imports involved with handlers that capture their arguments. Inside a stub, `pascal_args(emu, n)` returns the import's arguments in declared order.
```

- [ ] **Action 21: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/graphics.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md scripts/re/unicorn/README.md
git commit -m "docs(re): chunk 4 colors and bitmap masks verified"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
