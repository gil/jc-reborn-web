# Graphics: Colors, Masks, Primitives, Sprites, Dirty Rects, Buffers, Wipes

Findings for chunk 4. One claim per address. Our own words; no decompiled code.

The original draws with Windows GDI. The binary tells which GDI call runs with which arguments; how GDI turns that into pixels is Windows behavior. Where a claim rests on a GDI rule instead of the binary, it says so.

## Colors

- `1040:097a`: far cdecl `(color)`. In color mode 2 (`1068:1ebd`, always 2 at runtime) it keeps `color % 16`; in any other mode it uses the color as is.
- `1040:097a`: returns a full `COLORREF` from the active palette `1068:25ae` (3 bytes per entry): `AX` = red | green << 8, `DX` = blue with a zero high byte. Blue is set: the function pushes the blue byte first and pops it into `DX` before returning.
- `1040:097a`: emulated for colors 0..15 through `1038:1d31`; `colorrefHigh` in `re/fixtures/graphics/brushes.tsv` is the palette's blue byte for every color (test palette blue = `0x20 + i`, observed `0x0020`..`0x002f`).
- `1038:1d31`: far cdecl `(color)`. Below 16, or in 8-color mode (`1068:1ebd == 8`, never at runtime), it returns `CreateSolidBrush` of `1040:097a(color)`.
- `1038:1d31`: from 16 on it allocates a 0x88-byte global block and builds a packed DIB: header size `0x28`, width 8, height 8 (positive, so bottom-up), 1 plane, 4 bits, the rest of the header 0; then the 16 active palette colors as blue, green, red, 0; then 8 rows of 4 bytes.
- `1038:1d31`: buffer row `k` holds 4 copies of the color byte when `k` is even and 4 copies of the byte with its nibbles swapped when `k` is odd. So color `0x12` is a checkerboard of palette indices 1 and 2.
- `1038:1d31`: hands the block to `CreateDIBPatternBrush` (usage 0, palette colors as RGB), then unlocks and frees it.
- `1038:1d31`: emulated on all 256 colors (`re/fixtures/graphics/brushes.tsv`); `src/gfx/gdi/color.data.test.ts` checks every solid color and every pattern bit against `brushColorAt`.
- GDI behavior, not the binary: a positive-height DIB is stored bottom-up, so buffer row `k` is pattern row `7 - k`; a pattern brush is aligned to the device origin (brush origin 0, 0, never changed by the original). `brushColorAt(color, x, y)` uses both rules: odd screen rows start with the high nibble, even rows with the low nibble.

## Bitmap masks and mirrors

- `1040:035c`: far cdecl `(record, far pixels)`. Builds a 1-bit mask: bit set where the 4-bit index is not 0; the left pixel of each 8 goes in bit 7. Emulated on handmade input and on every image of every BMP (`re/fixtures/graphics/*.masks.bin`).
- `1040:035c`: writes `width / 8` mask bytes per row (each eats 4 source bytes, 8 pixels) with a row stride of `((width + 8) / 16) * 2`, and passes `CreateBitmap(width, height, 1 plane, 1 bit)`.
- `1040:035c`: with a width under 8 the per-row byte count is 0 and the 16-bit loop counter wraps, so the loop runs 65,536 times. With a width that is not a multiple of 8, the last pixels of each row get no mask bit and the next row starts reading mid-row.
- `1040:035c`: GDI expects a monochrome stride of `((width + 15) / 16) * 2`. The two strides differ only when `width % 16` is 1..7.
- `1040:035c`: none of these quirks happen on real data. Every one of the 2,392 images in the 117 BMPs has a width that is a multiple of 8 (1,122 are multiples of 16, 1,270 are 8 mod 16), and for those the two strides are equal (`src/gfx/gdi/masks.data.test.ts`).
- `1040:0462`: far cdecl `(record, far pixels)`. Swaps packed rows (`width / 2` bytes each) top to bottom in place, `height / 2` swaps; the middle row of an odd height stays.
- `1040:054e`: far cdecl `(record, far pixels)`. Mirrors each packed row left to right in place: swaps bytes from both ends and swaps the nibbles of both. It does nothing when the height is 0 or a row is under 2 bytes; with an odd byte count the middle byte keeps its nibble order. Emulated on every image: the result equals our decoded sprite read right to left (`src/gfx/gdi/masks.data.test.ts`).
- `1040:0000`: for each record of a zero-terminated list: builds the mask (`+4`) from the top-down buffer, builds the DIB header and color table, flips the rows bottom-up (`1040:0462`), and creates the image (`+2`) with `CreateDIBitmap` on the paint DC or a `GetDC` of the window.
- `1040:0000`: color table entry 0 is black when `1068:2572` is non-zero. `1068:2572` is 1 in the data segment; only `1040:0286` writes it, clearing it around its own call and setting it back to 1. So every BMP image has a black entry 0, and screens keep palette color 0.
- `1040:0000`: when `1068:1e22 != 0` and `1068:4106 != 0`, it also builds pre-mirrored versions: mirrors the bottom-up buffer (`1040:054e`), creates the mirrored image (`+10`), flips the rows back to top-down, and builds the mirrored mask (`+12`). The buffer stays mirrored afterwards; it is freed at the end when `1068:2572 != 0`.
- `1068:4106`: `walk_loadJohnWalkBmp` (`1018:0000`) sets it to 1 only around loading `JOHNWALK.BMP`; `story_drawIsland` (`1010:0136`) sets it to 0 before its own loads. So only `JOHNWALK.BMP` gets pre-mirrored images.
- `1068:1e22`: 1 in the data segment. `platform_screenSaverProc` (`1008:0fcd`) clears it at startup when free global memory is under 3,250,000 bytes (under 2,500,000 it quits instead). With it cleared, no image gets pre-mirrored versions and mirroring falls back to the negative-extent `StretchBlt` (see Sprites).
- `1040:0000`: after each record it advances the buffer by `(width / 2) * height` bytes, stores the scale mode `1068:2e74` in record byte `+1`, and calls `1038:0de1` (scaling, dead code at runtime).
- `1040:0b08`, `1040:0bc7`: full claims in `docs/re/decoders.md`, `Palette`. Nothing new: `1040:0b08` makes a loaded palette active by copying it into slot 0 (`1068:25ae`), which `1040:097a`, `1038:1d31`, and `1040:0000` read; `1040:0bc7` frees a loaded slot.
- `1030:00fe`: far cdecl `(record list)`. Does nothing for a null list. Otherwise calls `1030:0000`, then deletes every non-zero GDI object of every record (`+2` image, `+4` mask, `+10` mirrored image, `+12` mirrored mask), then frees the list and records with `decoders_freeBmpInfo`.
- `1030:0000`: an empty function; it returns without doing anything.
- `1030:15fb`: far cdecl `(record list)`. Returns the number of records before the zero terminator, 0 for a null list.
- `1028:182c`: forwards its one word to `1030:15fb`. Called from `1050:0061`.
- `1028:1845`: forwards its one word to `1030:00fe`. Called from `1050:080c` and twice from `decoders_loadBmpMatrix` (`1040:0db0`).

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
| `1040:097a` | `gfx_paletteColor` | `src/gfx/gdi/color.ts:1` `colorIndex` | fixed |
| `1038:1d31` | `gfx_createColorBrush` | `src/gfx/gdi/color.ts:5` `brushColorAt` (the old pipeline masks colors with `& 0x0f` and never dithers) | fixed |
| `1040:0000` | `gfx_buildBitmaps` | none (the model blits sprites from raw indices; index 0 is see-through, see Sprites) | match |
| `1040:035c` | `gfx_buildBitmapMask` | none (the model blits sprites from raw indices; index 0 is see-through, see Sprites) | match |
| `1040:0462` | `gfx_flipPixelRows` | none (the model blits sprites from raw indices; index 0 is see-through, see Sprites) | match |
| `1040:054e` | `gfx_mirrorPixelRows` | none (the model blits sprites from raw indices; index 0 is see-through, see Sprites) | match |
| `1040:0b08` | `gfx_selectPalette` | `src/gfx/palette.ts:7` `setPaletteColors` | match |
| `1040:0bc7` | `gfx_freePalette` | `src/gfx/palette.ts:7` `setPaletteColors` | match |
| `1030:00fe` | `gfx_freeBitmaps` | none (garbage collected) | match |
| `1030:0000` | `gfx_noop` | none (does nothing) | match |
| `1030:15fb` | `gfx_countBitmapRecords` | none (`sprites.length`) | match |
| `1028:182c` | `gfx_countBitmapRecordsThunk` | none (`sprites.length`) | match |
| `1028:1845` | `gfx_freeBitmapsThunk` | none (garbage collected) | match |
