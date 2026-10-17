# Step 2: Palette and Screen Loaders

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-chunk-lookup.md`

**Files:**

- Modify: `scripts/re/unicorn/original_loaders.py`, `scripts/re/unicorn/dump_loaders.py`, `scripts/re/unicorn/test_original_loaders.py`
- Create: `src/decode/nibbles.ts`, `src/testing/nibbles.ts`
- Modify: `src/decode/pal.ts`, `src/decode/scr.ts`, `src/gfx/palette.ts`, `src/gfx/palette.test.ts`
- Modify (call sites only): `src/main.ts`, `src/debug-main.ts`, `src/ttm/interpreter.ts`
- Create: `src/decode/pal.test.ts`, `src/decode/pal.data.test.ts`, `src/decode/scr.test.ts`, `src/decode/scr.data.test.ts`
- Modify: `docs/re/decoders.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated), `docs/re/open-questions.md` (only if needed)

**Interfaces:**

- Consumes (from step 1):
  - `src/decode/chunks.ts`: `chunkBody(payload: Uint8Array, path: string): Uint8Array | undefined`.
  - `src/testing/build-chunks.ts`: `chunk(tag, body, container = false)`, `concat(...parts)`, `words(...values)`, `storedBody(data)`.
  - `src/testing/corpus.ts`: `hasCorpus`, `hasFixture(path)`, `loadArchive()`, `readFixtureRows(path): string[][]`, `readFixtureBytes(path): Uint8Array`.
  - `scripts/re/unicorn/original_loaders.py`: `new_loader_emulator(image, payloads) -> Emulator`, `put_string(emu, text) -> int`, `read_word(emu, segment, offset) -> int`; at the top it imports `struct`, `dataclass`, `Emulator`, `NeImage`.
  - `scripts/re/unicorn/dump_loaders.py`: `OUT` (Path), `write_tsv(name, header, rows)`, `chunked(resources, kind=None)`, the `COMMANDS` dict (currently `{"chunks": dump_chunks}`), imports from `original_loaders`.
  - `scripts/re/unicorn/test_original_loaders.py`: `chunk(tag, body, container=False)`, `words(*values)`, `stored(data)`, `BINARY`, imports `NeImage`, `unittest`.
  - Existing: `unpackChunk(body)` in `src/resource/uncompress.ts`; `TRANSPARENT = 0xff` and `Palette` (16 × RGBA `Uint8Array`) in `src/types.ts`; `makePalette()` in `src/gfx/palette.ts`.
  - Today: `decodePal(payload): { vga: Uint8Array }` (256 × 6-bit RGB); `setPaletteFromVga(pal, vga)` in `src/gfx/palette.ts` (expands with `(v << 2) | (v >> 4)`); `decodeScr(payload): { width; height; indexed }`. Callers: `src/main.ts:36`, `src/debug-main.ts:23`, `src/ttm/interpreter.ts:194` (each `setPaletteFromVga(<palette>, decodePal(<payload>).vga)`).
- Produces:
  - `decodePal(payload: Uint8Array): PalResource` with `PalResource { colors: Uint8Array }` (16 × RGB, 0..255).
  - `setPaletteColors(pal: Palette, colors: Uint8Array): void` in `src/gfx/palette.ts` (replaces `setPaletteFromVga`).
  - `decodeScr(payload: Uint8Array): ScrResource` with `ScrResource { width: number; height: number; indexed: Uint8Array }` (unchanged shape).
  - `unpackNibbles(packed: Uint8Array, pixelCount: number, from = 0): Uint8Array` in `src/decode/nibbles.ts` (high nibble first, index 0 → `TRANSPARENT`, throws when `packed` is short).
  - `packNibbles(indexed: Uint8Array): Uint8Array` in `src/testing/nibbles.ts` (inverse, for tests).
  - Python: `load_palette_original(image, name, payload, color_mode=2) -> bytes`, `load_screen_original(image, name, payload) -> ScreenStrips` (`status`, `widths: set[int]`, `strips: list[tuple[int, int]]` of `(y, rows)`, `pixels: bytes`). Fixtures `re/fixtures/loaders/palette.tsv`, `screens.tsv`, `<NAME>.SCR.pixels.bin`.

## Part A: Read the original

- [x] **Action 1: Read the palette loader**

Read `1040:09eb` (`decoders_loadPalette`), the table at `1068:25b0`, and the order of calls in `platform_initSaver` (`1008:143c`): is `1038:1744` (which sets `1068:1ebd = 2`) called before `1040:09eb`? Dump the table:

Run: `re/.venv/bin/python -I -c "import sys; sys.path.insert(0, 'scripts/re/unicorn'); from ne_image import NeImage; image = NeImage.load('public/data/SCRANTIC.SCR'); data = image.segments[image.auto_data_segment - 1].data; print(data[0x25b0:0x25f0].hex(' '))"`
Expected: 64 bytes `00 04 08 ... f4 f8 ff`.

Also read `1040:0b08` and `1040:0bc7` far enough to say how a loaded palette slot becomes the active palette at `1068:25ae` (the colors `1040:0000` copies into each bitmap). Write under `Palette` in `docs/re/decoders.md`, one claim per bullet:

- `1040:09eb`: slot search (1..9 at `1068:45e4`, none free returns 0), chunk path, how many colors in each mode, byte-by-byte reads, the level table, what it returns.
- `1068:25b0`: the mapping (level `v` → `v * 4` for 0..62, 63 → 255) and what a level above 63 would read (bytes past the table).
- `1068:1ebd`: who sets it, to what, and that it happens before the palette loads, so the original only ever reads 16 colors.
- `1040:0b08` / `1040:0bc7`: one claim each, from what you read.
- Ours: `src/gfx/palette.ts` expands with `(v << 2) | (v >> 4)`, which differs from the table for every level except 0 and 63 (for example 32 → 130, the original gives 128). This step fixes it.

- [x] **Action 2: Read the screen loader and the pixel path**

Read `1030:16d8` (`decoders_loadScreen`), the call site of `gfx_blitPixelRows` (`1040:0286`) in its assembly (which argument is the buffer offset, the segment, x, y, width, row count), and `1040:0286` itself. Then read `1040:0000` and `1040:035c` far enough to answer: which nibble of a packed byte is the left pixel, and which color index the original treats as see-through (the mask `1040:035c` builds, if any). Write under `Screen`:

- `1030:16d8`: the default size (320 × 400, `0x140` and `0x190` in the assembly), `SCR:DIM:` layout (u16 width, u16 height), `SCR:BIN:` decoding in strips, the strip size (`(width / 2) << 6` bytes, halved while the near alloc fails), the first strip not cut to the height, the last strip cut to what is left, the return value (1, or 5/6 for the VGA/AMG layers that never run because `1068:1ebf` is 0), and an odd width losing its last column (`width >> 1` bytes per row).

Write under `Pixels`:

- `1040:0000`: 4-bit DIB per image, color table from `1068:25ae`, rows in the order it gets them (does it flip them? `1040:0462` may).
- Nibble order (high nibble = left pixel, or not).
- `1040:035c`: what it builds, and which index is see-through. If the original draws index 0 opaque for screens (backgrounds) but see-through for sprites, say so. Our decoders map index 0 to `TRANSPARENT` for both; if that is wrong for screens, add an open question for chunk 4 (graphics) in Action 13 rather than changing `src/gfx/` here.

- [x] **Action 3: Name the functions**

Add or update `scripts/re/names.json` entries (sorted, status `named`, notes in our words). `1040:09eb` and `1030:16d8` exist; correct their notes if the findings changed them (`decoders_loadScreen`'s note says "default 320x200"; it is 320 × 400). New names, adjust to what you found: `1040:0000` `gfx_buildBitmaps`, `1040:035c` `gfx_buildBitmapMask`, `1040:0462` `gfx_prepareBitmapRows` (rename after reading), `1040:0b08` and `1040:0bc7` (`gfx_` names for palette selection), `1038:1744` `gfx_initDisplay`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 4: Commit the findings**

```bash
git add docs/re/decoders.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): palette, screen, and pixel findings"
```

## Part B: Run the original loaders

- [ ] **Action 5: Write the failing Python tests**

Append to `scripts/re/unicorn/test_original_loaders.py`, before the `if __name__ == "__main__":` block, and add `load_palette_original, load_screen_original` to its `from original_loaders import ...` line:

```python
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
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: FAIL with `ImportError: cannot import name 'load_palette_original'`.

- [ ] **Action 6: Add the loaders to the harness**

Append to `scripts/re/unicorn/original_loaders.py`:

```python
LOAD_PALETTE = "1040:09eb"
COLOR_MODE = 0x1EBD
SIXTEEN_COLOR_MODE = 2
LOAD_SCREEN = "1030:16d8"
BLIT_PIXEL_ROWS = "1040:0286"


def load_palette_original(image: NeImage, name: str, payload: bytes, color_mode: int = SIXTEEN_COLOR_MODE) -> bytes:
    emu = new_loader_emulator(image, {name: payload})
    emu.write(emu.data_segment, COLOR_MODE, bytes([color_mode]))
    colors = emu.call_far(LOAD_PALETTE, stack_words=[put_string(emu, name)])["ax"]
    if colors == 0:
        raise RuntimeError(f"{name}: palette load failed")
    count = 16 if color_mode == SIXTEEN_COLOR_MODE else 256
    return emu.read(emu.data_segment, colors, count * 3)


@dataclass
class ScreenStrips:
    status: int
    widths: set[int]
    strips: list[tuple[int, int]]
    pixels: bytes


def load_screen_original(image: NeImage, name: str, payload: bytes) -> ScreenStrips:
    emu = new_loader_emulator(image, {name: payload})
    widths: set[int] = set()
    strips: list[tuple[int, int]] = []
    pixels = bytearray()

    def blit(emu: Emulator):
        offset, segment, y, width, rows = emu.arg(0), emu.arg(1), emu.arg(3), emu.arg(4), emu.arg(5)
        widths.add(width)
        strips.append((y, rows))
        pixels.extend(emu.read(segment, offset, rows * (width // 2)))
        return {"ax": 0}

    emu.replace_function(BLIT_PIXEL_ROWS, blit)
    status = emu.call_far(LOAD_SCREEN, stack_words=[put_string(emu, name)])["ax"]
    return ScreenStrips(status, widths, strips, bytes(pixels))
```

The blit argument indices follow the pseudo-C (buffer offset, segment, x, y, width, rows). If Action 2 found another order in the assembly, change the indices to match it.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: all pass. If one fails because the original does something else (for example the first strip is cut after all), the original wins: change the expected value and write the finding under `Screen`. If it fails with `UnstubbedImport` or an argument error, fix the harness.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_loaders.py scripts/re/unicorn/test_original_loaders.py`
Expected: no output.

- [ ] **Action 7: Dump the fixtures**

In `scripts/re/unicorn/dump_loaders.py`, add `load_palette_original, load_screen_original` to the `from original_loaders import ...` line, add these functions after `dump_chunks`:

```python
def dump_palette(image: NeImage, resources: list[Resource]):
    [palette] = chunked(resources, ".PAL")
    colors = load_palette_original(image, palette.name, palette.payload)
    write_tsv("palette.tsv", ["index", "red", "green", "blue"], [[i, *colors[i * 3:i * 3 + 3]] for i in range(16)])


def dump_screens(image: NeImage, resources: list[Resource]):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in chunked(resources, ".SCR"):
        result = load_screen_original(image, resource.name, resource.payload)
        file = f"{resource.name}.pixels.bin"
        (OUT / file).write_bytes(result.pixels)
        width = ",".join(str(w) for w in sorted(result.widths))
        rows.append([resource.name, result.status, width, sum(count for _, count in result.strips), file])
    write_tsv("screens.tsv", ["resource", "status", "width", "rows", "file"], rows)
```

and replace the `COMMANDS` dict with:

```python
COMMANDS = {
    "chunks": dump_chunks,
    "palette": dump_palette,
    "screens": dump_screens,
}
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_loaders.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py palette screens`
Expected: `palette.tsv: 16 rows` and `screens.tsv: 10 rows`. Every `screens.tsv` row has status `1`, width `640`, and rows `350` or `480`.

- [ ] **Action 8: Commit**

```bash
git add scripts/re/unicorn/original_loaders.py scripts/re/unicorn/dump_loaders.py scripts/re/unicorn/test_original_loaders.py
git commit -m "feat(re): run the original palette and screen loaders"
```

## Part C: Fix our palette

- [ ] **Action 9: Write the failing tests**

Create `src/decode/pal.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chunk } from '../testing/build-chunks.js';
import { decodePal } from './pal.js';

function palPayload(levels: number[]): Uint8Array {
  return chunk('PAL:', chunk('VGA:', Uint8Array.from(levels)), true);
}

describe('decodePal', () => {
  // SCRANTIC 1040:09eb 1068:25b0
  it('reads 16 colors and maps every channel level through the level table', () => {
    const levels = Array.from({ length: 768 }, (_, i) => i % 64);
    const { colors } = decodePal(palPayload(levels));
    expect(colors).toHaveLength(48);
    expect(Array.from(colors.subarray(0, 4))).toEqual([0, 4, 8, 12]);
    expect(Array.from(colors.subarray(30, 33))).toEqual([120, 124, 128]);
  });

  // SCRANTIC 1068:25b0
  it('maps level 63 to 255 and level 62 to 248', () => {
    const levels = Array.from({ length: 768 }, () => 0);
    levels[0] = 63;
    levels[1] = 62;
    expect(Array.from(decodePal(palPayload(levels)).colors.subarray(0, 2))).toEqual([255, 248]);
  });

  it('refuses a level above 63', () => {
    const levels = Array.from({ length: 768 }, () => 0);
    levels[5] = 64;
    expect(() => decodePal(palPayload(levels))).toThrow(/above 63/);
  });
});
```

Replace the whole of `src/gfx/palette.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { makePalette, setPaletteColors } from './palette.js';

describe('setPaletteColors', () => {
  it('copies 16 RGB colors and makes every entry opaque', () => {
    const colors = Uint8Array.from({ length: 48 }, (_, i) => i * 5);
    const palette = makePalette();
    setPaletteColors(palette, colors);
    expect(Array.from(palette.subarray(0, 8))).toEqual([0, 5, 10, 255, 15, 20, 25, 255]);
    expect(Array.from(palette.subarray(60, 64))).toEqual([225, 230, 235, 255]);
  });
});
```

Run: `pnpm exec vitest run src/decode/pal.test.ts src/gfx/palette.test.ts`
Expected: FAIL (`colors` is undefined; `setPaletteColors` is not exported).

- [ ] **Action 10: Implement**

Replace the whole of `src/decode/pal.ts` with:

```ts
import { chunkBody } from './chunks.js';

const COLORS_READ_IN_16_COLOR_MODE = 16;
const CHANNEL_LEVELS = Array.from({ length: 64 }, (_, level) => (level === 63 ? 0xff : level * 4));

export interface PalResource { colors: Uint8Array; }

export function decodePal(payload: Uint8Array): PalResource {
  const body = chunkBody(payload, 'PAL:VGA:');
  const size = COLORS_READ_IN_16_COLOR_MODE * 3;
  if (!body || body.length < size) throw new Error('PAL:VGA: missing or short');
  const colors = body.slice(0, size).map((level) => {
    const value = CHANNEL_LEVELS[level];
    if (value === undefined) throw new Error(`PAL:VGA: channel level ${level} above 63`);
    return value;
  });
  return { colors };
}
```

Replace `setPaletteFromVga` in `src/gfx/palette.ts` with:

```ts
export function setPaletteColors(pal: Palette, colors: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    pal[i * 4 + 0] = colors[i * 3 + 0]!;
    pal[i * 4 + 1] = colors[i * 3 + 1]!;
    pal[i * 4 + 2] = colors[i * 3 + 2]!;
    pal[i * 4 + 3] = 0xff;
  }
}
```

Update the three callers:

- `src/main.ts`: `import { makePalette, setPaletteFromVga } from './gfx/palette.js';` → `import { makePalette, setPaletteColors } from './gfx/palette.js';`; `setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);` → `setPaletteColors(pal, decodePal(palResRaw.payload).colors);`
- `src/debug-main.ts`: the same two changes.
- `src/ttm/interpreter.ts`: `import { setPaletteFromVga } from '../gfx/palette.js';` → `import { setPaletteColors } from '../gfx/palette.js';`; `if (res) setPaletteFromVga(ctx.palette, decodePal(res.payload).vga);` → `if (res) setPaletteColors(ctx.palette, decodePal(res.payload).colors);`

Run: `rg -n "setPaletteFromVga|\.vga\b" src`
Expected: no matches.

Run: `pnpm exec vitest run src/decode/pal.test.ts src/gfx/palette.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 11: Write the palette corpus tests**

Create `src/decode/pal.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { chunkBody } from './chunks.js';
import { decodePal } from './pal.js';

const johncast = () => loadArchive().byName.get('JOHNCAST.PAL')!.payload;

describe.skipIf(!hasCorpus)('the real JOHNCAST.PAL', () => {
  it('stores 256 colors with channel levels 0 to 63', () => {
    // SCRANTIC 1068:25b0
    const body = chunkBody(johncast(), 'PAL:VGA:')!;
    expect(body).toHaveLength(768);
    expect(Math.max(...body)).toBeLessThanOrEqual(63);
  });

  it('keeps its decoded colors', () => {
    expect(Array.from(decodePal(johncast()).colors)).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/palette.tsv'))('palette matches the original SCRANTIC.SCR', () => {
  it('gives the same 16 colors as the original loader in 16-color mode', () => {
    // SCRANTIC 1040:09eb
    const original = readFixtureRows('loaders/palette.tsv').flatMap(([, red, green, blue]) => [Number(red), Number(green), Number(blue)]);
    expect(Array.from(decodePal(johncast()).colors)).toEqual(original);
  });
});
```

Run: `pnpm exec vitest run src/decode/pal.data.test.ts`
Expected: 3 tests pass; a new snapshot is written to `src/decode/__snapshots__/pal.data.test.ts.snap`.

- [ ] **Action 12: Commit**

```bash
git add src/decode/pal.ts src/decode/pal.test.ts src/decode/pal.data.test.ts src/decode/__snapshots__ src/gfx/palette.ts src/gfx/palette.test.ts src/main.ts src/debug-main.ts src/ttm/interpreter.ts
git commit -m "fix(decode): palette reads 16 colors through the original level table"
```

## Part D: Fix our screen decoder

- [ ] **Action 13: Write the failing tests**

Create `src/decode/scr.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { TRANSPARENT } from '../types.js';
import { decodeScr } from './scr.js';

function scrPayload(dim: Uint8Array | null, packed: Uint8Array): Uint8Array {
  const parts = dim ? [chunk('DIM:', dim)] : [];
  return chunk('SCR:', concat(...parts, chunk('BIN:', storedBody(packed))), true);
}

describe('decodeScr', () => {
  // SCRANTIC 1030:16d8
  it('reads the size from SCR:DIM: and unpacks two pixels per byte, high nibble first', () => {
    const scr = decodeScr(scrPayload(words(4, 1), Uint8Array.of(0x12, 0x30)));
    expect(scr).toMatchObject({ width: 4, height: 1 });
    expect(Array.from(scr.indexed)).toEqual([1, 2, 3, TRANSPARENT]);
  });

  // SCRANTIC 1030:16d8
  it('uses 320 x 400 when SCR:DIM: is missing', () => {
    const scr = decodeScr(scrPayload(null, new Uint8Array(160 * 400)));
    expect(scr).toMatchObject({ width: 320, height: 400 });
    expect(scr.indexed).toHaveLength(320 * 400);
  });

  it('refuses pixel data shorter than width x height', () => {
    expect(() => decodeScr(scrPayload(words(4, 2), Uint8Array.of(0x12)))).toThrow(/short/);
  });
});
```

If Action 2 found that the left pixel is the low nibble, change the first expectation to `[2, 1, TRANSPARENT, 3]` and the `unpackNibbles` code in Action 14 to match. If it found index 0 is drawn opaque, keep `TRANSPARENT` here (our graphics code relies on it) and make sure the open question from Action 2 exists.

Run: `pnpm exec vitest run src/decode/scr.test.ts`
Expected: FAIL (the 320 × 400 default and the short-data check are missing; the old decoder also throws on the missing `DIM:` chunk).

- [ ] **Action 14: Implement**

Create `src/decode/nibbles.ts`:

```ts
import { TRANSPARENT } from '../types.js';

export function unpackNibbles(packed: Uint8Array, pixelCount: number, from = 0): Uint8Array {
  const needed = Math.ceil(pixelCount / 2);
  if (from + needed > packed.length) throw new Error(`pixel data short: need ${needed} bytes at ${from}, have ${packed.length - from}`);
  const indexed = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const byte = packed[from + (i >> 1)]!;
    const index = i & 1 ? byte & 0x0f : byte >> 4;
    indexed[i] = index === 0 ? TRANSPARENT : index;
  }
  return indexed;
}
```

Replace the whole of `src/decode/scr.ts` with:

```ts
import { unpackChunk } from '../resource/uncompress.js';
import { chunkBody } from './chunks.js';
import { unpackNibbles } from './nibbles.js';

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 400;

export interface ScrResource { width: number; height: number; indexed: Uint8Array; }

export function decodeScr(payload: Uint8Array): ScrResource {
  const dim = chunkBody(payload, 'SCR:DIM:');
  const view = dim && new DataView(dim.buffer, dim.byteOffset, dim.byteLength);
  const width = view ? view.getUint16(0, true) : DEFAULT_WIDTH;
  const height = view ? view.getUint16(2, true) : DEFAULT_HEIGHT;
  const bin = chunkBody(payload, 'SCR:BIN:');
  if (!bin) throw new Error('SCR:BIN: missing');
  return { width, height, indexed: unpackNibbles(unpackChunk(bin), width * height) };
}
```

Create `src/testing/nibbles.ts`:

```ts
import { TRANSPARENT } from '../types.js';

export function packNibbles(indexed: Uint8Array): Uint8Array {
  const packed = new Uint8Array(Math.ceil(indexed.length / 2));
  indexed.forEach((index, i) => {
    const nibble = index === TRANSPARENT ? 0 : index;
    packed[i >> 1] = (packed[i >> 1] ?? 0) | (i & 1 ? nibble : nibble << 4);
  });
  return packed;
}
```

Run: `pnpm exec vitest run src/decode/scr.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 15: Write the screen corpus tests**

Create `src/decode/scr.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unpackChunk } from '../resource/uncompress.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { packNibbles } from '../testing/nibbles.js';
import { chunkBody } from './chunks.js';
import { decodeScr } from './scr.js';

const screens = () => loadArchive().list.filter((resource) => resource.type === '.SCR');

describe.skipIf(!hasCorpus)('every SCR resource', () => {
  it('decodes to width x height pixels and uses every byte of SCR:BIN:', () => {
    // SCRANTIC 1030:16d8
    const wrong = screens().flatMap(({ name, payload }) => {
      const { width, height } = decodeScr(payload);
      const packedSize = unpackChunk(chunkBody(payload, 'SCR:BIN:')!).length;
      return packedSize === (width * height) / 2 ? [] : [`${name}: ${width}x${height}, ${packedSize} packed bytes`];
    });
    expect(screens()).toHaveLength(10);
    expect(wrong).toEqual([]);
  });

  it('keeps its decoded pixels', () => {
    const hashes = Object.fromEntries(
      screens().map(({ name, payload }) => {
        const { width, height, indexed } = decodeScr(payload);
        return [name, `${width}x${height} ${createHash('sha256').update(indexed).digest('hex')}`];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/screens.tsv'))('screens match the original SCRANTIC.SCR', () => {
  it('hands the screen blitter the same rows as the original loader', () => {
    // SCRANTIC 1030:16d8 1040:0286
    const archive = loadArchive();
    const wrong = readFixtureRows('loaders/screens.tsv').flatMap(([name, status, width, rows, file]) => {
      const scr = decodeScr(archive.byName.get(name!)!.payload);
      const original = readFixtureBytes('loaders/' + file!);
      const same =
        status === '1' &&
        Number(width) === scr.width &&
        Number(rows) === scr.height &&
        Buffer.from(packNibbles(scr.indexed)).equals(Buffer.from(original));
      return same ? [] : [`${name}: original status ${status}, width ${width}, ${rows} rows, ${original.length} bytes`];
    });
    expect(wrong).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/decode/scr.data.test.ts`
Expected: 3 tests pass; a snapshot is written.

- [ ] **Action 16: Commit**

```bash
git add src/decode/nibbles.ts src/decode/scr.ts src/decode/scr.test.ts src/decode/scr.data.test.ts src/decode/__snapshots__ src/testing/nibbles.ts
git commit -m "fix(decode): screens use chunk lookup and the original 320x400 default"
```

## Part E: Checklist

- [ ] **Action 17: Fill the checklist rows and open questions**

In `docs/re/decoders.md` under `Side-by-side checklist`, add rows:

| Original | Ours | Status |
| --- | --- | --- |
| `1040:09eb` `decoders_loadPalette` | `decodePal` in `src/decode/pal.ts` (16 colors, level table) | fixed |
| `1030:16d8` `decoders_loadScreen` | `decodeScr` in `src/decode/scr.ts`; strips: none (we decode the whole screen at once; the only visible difference, the uncut first strip, needs a screen under 64 rows, and the data has none) | fixed |

Use real line numbers.

For any behavior you could not settle (for example screen transparency from Action 2), add an entry to `docs/re/open-questions.md` (next free `OQ-` number) with **Resolve in:** chunk 4 (graphics).

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 18: Run every check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): side-by-side checklist for the palette and screen loaders"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
