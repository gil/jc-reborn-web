# Step 3: Bitmap Loader

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-chunk-lookup.md`, `step-002-palette-and-screen.md` (for `unpackNibbles`, `packNibbles`, and the `Pixels` findings)

**Files:**

- Modify: `scripts/re/unicorn/original_loaders.py`, `scripts/re/unicorn/dump_loaders.py`, `scripts/re/unicorn/test_original_loaders.py`
- Modify: `src/decode/bmp.ts`
- Create: `src/decode/bmp.test.ts`, `src/decode/bmp.data.test.ts`
- Modify: `docs/re/decoders.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated), `docs/re/open-questions.md` (only if needed)

**Interfaces:**

- Consumes:
  - `src/decode/chunks.ts`: `chunkBody(payload, path): Uint8Array | undefined`.
  - `src/decode/nibbles.ts`: `unpackNibbles(packed: Uint8Array, pixelCount: number, from = 0): Uint8Array` (high nibble first unless step 2's `Pixels` finding says otherwise; index 0 → `TRANSPARENT`; throws `/short/` when `packed` runs out).
  - `src/testing/nibbles.ts`: `packNibbles(indexed: Uint8Array): Uint8Array`.
  - `src/testing/build-chunks.ts`: `chunk(tag, body, container = false)`, `concat(...parts)`, `words(...values)`, `storedBody(data)`.
  - `src/testing/corpus.ts`: `hasCorpus`, `hasFixture(path)`, `loadArchive()`, `readFixtureRows(path)`, `readFixtureBytes(path)`.
  - Existing: `unpackChunk(body)` in `src/resource/uncompress.ts`; `Sprite { width; height; indexed }` and `TRANSPARENT` in `src/types.ts`.
  - Today: `decodeBmp(payload): { sprites: Sprite[] }` in `src/decode/bmp.ts`, fixed-order parsing, throws on an odd width. Callers (unchanged by this step): `src/ads/scheduler.ts`, `src/island/island.ts`, `src/ttm/bmp-slots.ts`, `src/debug-main.ts`.
  - Python, from steps 1 and 2: `original_loaders.py` has `new_loader_emulator(image, payloads)`, `put_string(emu, text)`, `read_word(emu, segment, offset)`, imports `struct`, `dataclass`, `Emulator`, `NeImage`. `dump_loaders.py` has `OUT`, `write_tsv(name, header, rows)`, `chunked(resources, kind=None)`, `Resource`, `NeImage`, and `COMMANDS = {"chunks": ..., "palette": ..., "screens": ...}`. `test_original_loaders.py` has `chunk`, `words`, `stored`, `BINARY`.
- Produces:
  - `decodeBmp(payload: Uint8Array): BmpResource` with `BmpResource { sprites: Sprite[] }` (unchanged shape), reading `BMP:INF:` and `BMP:BIN:` by path.
  - Python: `load_bmp_original(image, name, payload) -> BitmapImages` (`widths: list[int]`, `heights: list[int]`, `packed: bytes`). Fixtures `re/fixtures/loaders/bitmaps.tsv` and `<NAME>.BMP.packed.bin`.

## Part A: Read the original

- [x] **Action 1: Read the bitmap loader**

Read `1030:1112` (`decoders_readBmpInfo`), `1030:124a` (`decoders_loadBmp`), `1030:000e`, `1030:15cc`, and `1030:1624`. Find the targets of the function pointers `1068:1e24`, `1068:2574`, and `1068:2578` in the relocation table:

Run: `rg -n "^1068:(1e24|2574|2578)" re/out/relocations.tsv`
Expected: three rows. The last two numbers of each row's values are the target NE segment and offset (segment 7 is `1030`, segment 9 is `1040`; for example `7,14` is `1030:000e`).

Read the call sites of those pointers in `re/out/functions/1030_124a_decoders_loadBmp.asm` to get the real argument order. The pseudo-C shows an extra leading value on the `1068:2574` call; trust the pushes in the assembly.

Confirm that nothing writes `1068:1ebf`:

Run: `rg -n "\[0x1ebf\]" re/out/functions --glob '*.asm'`
Expected: only reads (`CMP`, `MOV <reg>, byte ptr [0x1ebf]`), no `MOV byte ptr [0x1ebf], ...`.

Write under `Bitmap` in `docs/re/decoders.md`, one claim per bullet:

- `1030:1112`: `BMP:INF:` layout (u16 count, `count` widths, then `count` heights), the 14-byte records (`+6` width, `+8` height, what the other fields hold once `1040:0000` fills them), the zero-terminated pointer list, failure cases.
- `1030:000e` (via `1068:1e24`): the size formula, `((w + 1) / 2) * h` summed over images, and the second output it zeroes.
- `1030:124a`: opening by name or handle, the near scratch allocations (`0x3cc4` then `0x3ac4` bytes at `1068:1dbe`; say what they are for if you can tell), decoding `BMP:BIN:` into one far buffer in `0x7fff`-byte reads, the call through `1068:2574` with its arguments, the `BMP:VGA:` (`5`) and `BMP:AMG:` (`6`) branches and why they never run, the return value, cleanup.
- `1040:0000` (target of `1068:2574`): advances by `(w / 2) * h` per image, which disagrees with `1030:000e` for odd widths. All widths in the data are even, so it never matters.
- `1068:2578`: its target, and that it is only reached in the `BMP:VGA:`/`BMP:AMG:` branch.
- `1030:1624`: what the AMG expansion does (1 bit per pixel into nibbles, from the end backward), and that it never runs.
- `1030:15cc`: frees the record block and the pointer list.
- The data: 2 bitmaps carry `BMP:VGA:` (`MJTELE.BMP`, `JOHNWALK.BMP`); the original ignores it in its 16-color mode, so do we.

- [x] **Action 2: Read the bitmap matrix loader**

Read `1040:0db0` (`decoders_loadBmpMatrix`) and its helpers `1038:00d2`, `1038:0119` (named in step 1). Find who calls it; Ghidra shows no direct callers, so look for a relocation that points at it:

Run: `rg -n ",9,3504$" re/out/relocations.tsv`
Expected: the rows (if any) whose target is `1040:0db0` (`0x0db0` = 3504). The first column is the address holding the pointer; look it up in `re/out/strings.tsv` or the functions that read it.

Write under `Bitmap matrix`: the `BMP:MTX:` layout it expects, what it builds (`1068:45f8`), who reaches it, and that no resource in the data has a `BMP:MTX:` chunk (step 1's `re/fixtures/loaders/chunks.tsv` has `-1` for every `BMP:MTX:` row: check with `rg -c "BMP:MTX:\t-1" re/fixtures/loaders/chunks.tsv`, expected `117`). We need no decoder for it.

- [x] **Action 3: Name the functions**

Update `scripts/re/names.json` (sorted, status `named`, notes in our words). `1030:1112`, `1030:124a`, `1040:0db0` exist; correct their notes if needed. Suggested new names: `1030:000e` `decoders_bmpPixelBytes`, `1030:15cc` `decoders_freeBmpInfo`, `1030:1624` `decoders_expandAmgBits`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 4: Commit the findings**

```bash
git add docs/re/decoders.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): bitmap and bitmap matrix loader findings"
```

## Part B: Run the original loader

- [x] **Action 5: Write the failing Python tests**

Append to `scripts/re/unicorn/test_original_loaders.py`, before the `if __name__ == "__main__":` block, and add `load_bmp_original` to its `from original_loaders import ...` line:

```python
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
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: FAIL with `ImportError: cannot import name 'load_bmp_original'`.

- [x] **Action 6: Add the loader to the harness**

Append to `scripts/re/unicorn/original_loaders.py`:

```python
LOAD_BMP = "1030:124a"
BUILD_BITMAPS = "1040:0000"


@dataclass
class BitmapImages:
    widths: list[int]
    heights: list[int]
    packed: bytes


def load_bmp_original(image: NeImage, name: str, payload: bytes) -> BitmapImages:
    emu = new_loader_emulator(image, {name: payload})
    captured: list[BitmapImages] = []

    def build(emu: Emulator):
        records, offset, segment = emu.arg(0), emu.arg(1), emu.arg(2)
        sizes: list[tuple[int, int]] = []
        while (record := read_word(emu, emu.data_segment, records + 2 * len(sizes))) != 0:
            sizes.append((read_word(emu, emu.data_segment, record + 6), read_word(emu, emu.data_segment, record + 8)))
        total = sum((width + 1) // 2 * height for width, height in sizes)
        captured.append(BitmapImages([w for w, _ in sizes], [h for _, h in sizes], emu.read(segment, offset, total)))
        return {"ax": 0}

    emu.replace_function(BUILD_BITMAPS, build)
    handle = emu.call_far(LOAD_BMP, stack_words=[put_string(emu, name)])["ax"]
    if handle == 0 or len(captured) != 1:
        raise RuntimeError(f"{name}: bitmap load returned {handle:#x} after {len(captured)} bitmap builds")
    return captured[0]
```

`BUILD_BITMAPS` is the target of `1068:2574` from Action 1; if the relocation pointed elsewhere, use that address. The argument indices (`records`, `offset`, `segment`) must match the pushes you read at the call site; fix them if they differ.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: all pass. If the widths come out wrong, the argument indices are off. If the original does something else on purpose, the original wins: change the expectation and write the finding.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_loaders.py scripts/re/unicorn/test_original_loaders.py`
Expected: no output.

- [x] **Action 7: Dump the fixtures**

In `scripts/re/unicorn/dump_loaders.py`, add `load_bmp_original` to the `from original_loaders import ...` line, add after `dump_screens`:

```python
def dump_bitmaps(image: NeImage, resources: list[Resource]):
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for resource in chunked(resources, ".BMP"):
        result = load_bmp_original(image, resource.name, resource.payload)
        file = f"{resource.name}.packed.bin"
        (OUT / file).write_bytes(result.packed)
        rows.append([resource.name, ",".join(map(str, result.widths)), ",".join(map(str, result.heights)), file])
    write_tsv("bitmaps.tsv", ["resource", "widths", "heights", "file"], rows)
```

and add `"bitmaps": dump_bitmaps,` to the `COMMANDS` dict.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_loaders.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py bitmaps`
Expected: `bitmaps.tsv: 117 rows`.

- [x] **Action 8: Commit**

```bash
git add scripts/re/unicorn/original_loaders.py scripts/re/unicorn/dump_loaders.py scripts/re/unicorn/test_original_loaders.py
git commit -m "feat(re): run the original bitmap loader on every BMP"
```

## Part C: Fix our bitmap decoder

- [ ] **Action 9: Write the failing tests**

Create `src/decode/bmp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeBmp } from './bmp.js';

const PIXELS = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a);

function bmpPayload(widths: number[], heights: number[], packed: Uint8Array, extra: Uint8Array[] = []): Uint8Array {
  const info = chunk('INF:', words(widths.length, ...widths, ...heights));
  return chunk('BMP:', concat(info, chunk('BIN:', storedBody(packed)), ...extra), true);
}

describe('decodeBmp', () => {
  // SCRANTIC 1030:1112 1030:124a 1030:000e
  it('reads every width, then every height, and cuts one pixel buffer image by image', () => {
    const { sprites } = decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS));
    expect(sprites.map(({ width, height }) => [width, height])).toEqual([[2, 1], [4, 2]]);
    expect(Array.from(sprites[0]!.indexed)).toEqual([1, 2]);
    expect(Array.from(sprites[1]!.indexed)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // SCRANTIC 1030:124a 1068:1ebf
  it('ignores a BMP:VGA: layer, as the original does in 16-color mode', () => {
    const vga = chunk('VGA:', storedBody(new Uint8Array(PIXELS.length).fill(0xff)));
    const plain = decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS)).sprites;
    expect(decodeBmp(bmpPayload([2, 4], [1, 2], PIXELS, [vga])).sprites).toEqual(plain);
  });

  // SCRANTIC 1040:0000
  it('refuses odd widths, where the original disagrees with itself on row length', () => {
    expect(() => decodeBmp(bmpPayload([3], [1], PIXELS))).toThrow(/odd width/);
  });

  it('refuses pixel data shorter than the images need', () => {
    expect(() => decodeBmp(bmpPayload([4], [4], PIXELS))).toThrow(/short/);
  });
});
```

Adjust the expected pixel order if step 2's `Pixels` finding says the low nibble is the left pixel.

Run: `pnpm exec vitest run src/decode/bmp.test.ts`
Expected: the `BMP:VGA:` test and the short-data test may already pass or fail by luck of the old parser; at least the short-data test FAILS (the old decoder reads past the buffer as `undefined` instead of throwing).

- [ ] **Action 10: Implement**

Replace the whole of `src/decode/bmp.ts` with:

```ts
import { unpackChunk } from '../resource/uncompress.js';
import type { Sprite } from '../types.js';
import { chunkBody } from './chunks.js';
import { unpackNibbles } from './nibbles.js';

export interface BmpResource { sprites: Sprite[]; }

export function decodeBmp(payload: Uint8Array): BmpResource {
  const info = chunkBody(payload, 'BMP:INF:');
  const bin = chunkBody(payload, 'BMP:BIN:');
  if (!info || !bin) throw new Error('BMP:INF: or BMP:BIN: missing');
  const view = new DataView(info.buffer, info.byteOffset, info.byteLength);
  const count = view.getUint16(0, true);
  const packed = unpackChunk(bin);
  const sprites: Sprite[] = [];
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const width = view.getUint16(2 + 2 * i, true);
    const height = view.getUint16(2 + 2 * (count + i), true);
    if (width & 1) throw new Error(`bmp ${i}: odd width ${width}`);
    sprites.push({ width, height, indexed: unpackNibbles(packed, width * height, offset) });
    offset += (width / 2) * height;
  }
  return { sprites };
}
```

Run: `pnpm exec vitest run src/decode/bmp.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 11: Write the bitmap corpus tests**

Create `src/decode/bmp.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unpackChunk } from '../resource/uncompress.js';
import { concat } from '../testing/build-chunks.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { packNibbles } from '../testing/nibbles.js';
import { decodeBmp } from './bmp.js';
import { chunkBody } from './chunks.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

describe.skipIf(!hasCorpus)('every BMP resource', () => {
  it('has even widths and a BMP:BIN: exactly as long as its images need', () => {
    // SCRANTIC 1030:000e
    const wrong = bitmaps().flatMap(({ name, payload }) => {
      const needed = decodeBmp(payload).sprites.reduce((total, { width, height }) => total + Math.ceil(width / 2) * height, 0);
      const packedSize = unpackChunk(chunkBody(payload, 'BMP:BIN:')!).length;
      return packedSize === needed ? [] : [`${name}: needs ${needed} bytes, has ${packedSize}`];
    });
    expect(bitmaps()).toHaveLength(117);
    expect(wrong).toEqual([]);
  });

  it('keeps its decoded sprites', () => {
    const hashes = Object.fromEntries(
      bitmaps().map(({ name, payload }) => {
        const { sprites } = decodeBmp(payload);
        const hash = createHash('sha256');
        for (const sprite of sprites) hash.update(sprite.indexed);
        return [name, `${sprites.map(({ width, height }) => `${width}x${height}`).join(',')} ${hash.digest('hex')}`];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/bitmaps.tsv'))('bitmaps match the original SCRANTIC.SCR', () => {
  it('hands the bitmap builder the same sizes and pixels as the original loader', () => {
    // SCRANTIC 1030:124a 1040:0000
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/bitmaps.tsv');
    const wrong = rows.flatMap(([name, widths, heights, file]) => {
      const { sprites } = decodeBmp(archive.byName.get(name!)!.payload);
      const ours = concat(...sprites.map(({ indexed }) => packNibbles(indexed)));
      const same =
        sprites.map(({ width }) => width).join(',') === widths &&
        sprites.map(({ height }) => height).join(',') === heights &&
        Buffer.from(ours).equals(Buffer.from(readFixtureBytes('loaders/' + file!)));
      return same ? [] : [`${name}: original ${widths} x ${heights}`];
    });
    expect(rows).toHaveLength(117);
    expect(wrong).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/decode/bmp.data.test.ts`
Expected: 3 tests pass; a snapshot is written.

- [ ] **Action 12: Commit**

```bash
git add src/decode/bmp.ts src/decode/bmp.test.ts src/decode/bmp.data.test.ts src/decode/__snapshots__
git commit -m "fix(decode): bitmaps use chunk lookup; checked against the original on every BMP"
```

## Part D: Checklist

- [ ] **Action 13: Fill the checklist rows and open questions**

In `docs/re/decoders.md` under `Side-by-side checklist`, add rows (real line numbers):

| Original | Ours | Status |
| --- | --- | --- |
| `1030:1112` `decoders_readBmpInfo` | `decodeBmp` in `src/decode/bmp.ts` (count, widths, heights) | fixed |
| `1030:124a` `decoders_loadBmp` | `decodeBmp` in `src/decode/bmp.ts`; `BMP:VGA:`/`BMP:AMG:` branches: none (never run, `1068:1ebf` is 0) | fixed |
| `1030:000e` | `decodeBmp` (`unpackNibbles` length check; odd widths refused) | match |
| `1030:15cc` | none (memory is garbage collected) | match |
| `1030:1624` | none (AMG layers are never loaded) | match |
| `1040:0db0` `decoders_loadBmpMatrix` | none (no `BMP:MTX:` in the data) | match |

If Action 2 could not tell who reaches `1040:0db0`, still mark it `match` (the data has no input for it) and add the caller question to `docs/re/open-questions.md` with **Resolve in:** chunk 5 (TTM interpreter), since TTM opcodes are the likely caller.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 14: Run every check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): side-by-side checklist for the bitmap loaders"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
