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

- `1038:1744`: far cdecl `(mode)`. Accepts modes 0, 2, and 8, returns 0 for any other. Always sets the color mode `1068:1ebd` to 2, and `1068:1ec1` to the device's `SIZEPALETTE` minus 1. Mode 8 releases the DC, calls `1038:194e`, and returns 0.
- `1038:1744`: the screen size `1068:2562`/`1068:2564` changes only for scale mode `1068:2e74` 0 (320 × 200) or 1 (640 × 400). At runtime `2e74` is 3, so the size stays the 640 × 480 set by `platform_initSaver` (`1008:143c`).
- `1038:1744`: creates three memory DCs compatible with the window DC (`1068:1eb4` = A, `1eb2` = B, `1eb0` = C) and three compatible bitmaps of the screen size (`1068:45a0`, `45a2`, `45a4`), selected into A, B, C. If any of the six is 0 it calls `1038:194e` and returns 0.
- `1038:1744`: sets the clip rect to the whole screen, inclusive (`1068:1ea4` x1 = 0, `1ea8` y1 = 0, `1ea6` x2 = width - 1, `1eaa` y2 = height - 1) with the clip off (`1068:1ea3` = 0), copies `2e74` into `2e76`, and registers two cursors.
- `1038:1744`: sets background `1068:1ead` = 0, foreground `1068:1eae` = 0, fill flag `1068:1eac` = 1, then fills C, B, and A (in that order) with `gfx_drawRect(0, 0, width, height)`: foreground equals background, so each is a `PATCOPY` of solid color 0. Ends with the copy source `1068:1eb6` = A and the draw target `1068:1eb8` = A. Returns 2.
- `1038:194e`: removes the cursor, then deletes each of the three DCs and three bitmaps that is not 0. It does not clear the globals.
- `1038:1ade`: far cdecl `(on)`. Does nothing when `on` is 0 and the last call (`1068:45a6`, starts 0) was also 0. Otherwise creates a rect region `(x1, y1, x2 + 1, y2 + 1)` from the clip rect when `on`, or `(0, 0, width, height)` when not, selects it into A, B, and C (GDI copies it), deletes it, and remembers `on` in `1068:45a6`.
- `1038:1ade`: halves or doubles the region when `2e74` and `2e76` differ; both are 3 at runtime, so it never does.
- `1038:1ade`: every drawing call runs it twice: before drawing with `on = 1068:1ea3`, after drawing with 0. So the clip only exists while a call draws; between calls every DC is unclipped.
- `1068:1ea0`..`1068:1eae`: `1ea0` text color, `1ea1` text back color, `1ea2` text back mode (0 opaque, else transparent), `1ea3` clip on, `1ea4`/`1ea8` clip x1/y1, `1ea6`/`1eaa` clip x2/y2 (inclusive words), `1eac` fill flag, `1ead` background (brush) color, `1eae` foreground (pen) color. Data segment values: all 0 except `1ea6` = 319, `1eaa` = 199, `1eac` = 1.
- `1068:1ea0`..`1068:1eae`: set by `1038:1744` (above); `1010:0136` (story_drawIsland: both colors, fill on); `1010:04a2` (foreground 15); `1010:1551` (saves the clip, sets it on with x2 = x + w and y2 = y + h, restores it at the end); `1048:1acb` and `1048:1e5a` (for each TTM thread, load the thread's colors and clip into these globals, with foreground = text color from one thread byte; after the loop, clip on over the whole screen); `1058:040c` (clip off, later restored); `1058:0144` (text back mode). Read in chunk 5 (`1048`, `1058`: TTM) and chunk 7 (`1010`: story).
- `1068:1ea1`: nothing writes it, so text back color is always palette color 0.
- Ours: `src/gfx/gdi/surface.ts` keeps the draw state in `DrawState` (`makeDrawState` = the values after `1038:1744`) and applies the clip per pixel with `activeClip` instead of a GDI region. The old pipeline's `src/gfx/clip.ts` is unchanged (chunk 5).

## Primitives

- `1040:0d54`: far cdecl `(x, y, color)`. `SetPixel` on the draw target with `1040:097a(color)`, so `color % 16`; it ignores the foreground. Clip as `1038:1ade` above. Dirty rect `(x, y, 1, 1)`.
- `1030:02ef`: far cdecl `(x1, y1, x2, y2)`. `SetROP2(R2_COPYPEN)`, a 1-pixel solid pen of the foreground, `MoveTo(x1, y1)`, `LineTo(x2, y2)`. Clip as above.
- `1030:02ef`: dirty rect at `(min(x1, x2), min(y1, y2))`, width `x2 - x1 + 1` when `x2 >= x1` but `-x1 - x2 + 1` when `x2 < x1`; height the same with `y`. So a line drawn left or up passes a wrong (often negative) width or height to `1038:07e8`.
- GDI behavior, not the binary: `LineTo` leaves out its end point, so a line from a point to itself draws nothing.
- `1038:1bd8`: far cdecl `(x, y, w, h)`. `SetROP2(R2_COPYPEN)`, 1-pixel solid pen of the foreground. Clip as above. Dirty rect `(x, y, w, h)`.
- `1038:1bd8`: when the fill flag `1068:1eac` is 0, or `w < 2`, or `h < 2`: an outline only, `MoveTo(x, y)`, then `LineTo` to `(x + w - 1, y)`, `(x + w - 1, y + h - 1)`, `(x, y + h - 1)`, and back to `(x, y)`. No brush is made.
- `1038:1bd8`: otherwise it selects `1038:1d31(background)`. When the foreground byte equals the background byte (compared before `% 16`), `BitBlt(x, y, w, h, PATCOPY)` paints the whole rect with the brush and the pen is unused.
- `1038:1bd8`: when they differ, `Rectangle(x, y, x + w, y + h)`. GDI behavior: the border is the 1-pixel pen on the rect's outer pixels, the inside is the brush, right and bottom edges excluded.
- `1040:0688`: far cdecl `(r, cx, cy)`. 1-pixel foreground pen, brush `1038:1d31(background)`, `Ellipse(cx - r, cy - r, cx + r, cy + r)`. Clip as above.
- `1040:0688`: its dirty call passes `(cx - r, cy - r, cx + r, cy + r)` as `(x, y, w, h)`, so the presented rect reaches `(cx + cx, cy + cy)` instead of `(cx + r, cy + r)`.
- GDI behavior, not the binary: which pixels `Ellipse` and `LineTo` pick. `src/gfx/gdi/primitives.ts` uses a midpoint line without its end point, and a circle of every pixel whose center is within `r` of `(cx, cy)` with a 1-pixel border (OQ-15).

## Text

- `1030:04ee`: far cdecl `(far string, x, y)`. Sets the text color to `1040:097a(1068:1ea0)`, the back color to `1040:097a(1068:1ea1)`, and the back mode to opaque when `1068:1ea2` is 0, else transparent. With the clip applied, `TextOut(x, y, string, length)` on the draw target, then restores the old text and back colors (not the back mode).
- `1030:04ee`: dirty rect `(x, y, 8 × length, 15)`, whatever the font's real size.
- `1030:04ce`: far cdecl `(near string, x, y)`: forwards to `1030:04ee` with the data segment.
- `1030:0765`: once (guarded by `1068:1e28`) adds the font file `WILLY.FON` (`1068:1e2a`), creates the font `Willy Beamish Dialog` (`1068:1e34`) at height 8, width 8, weight 400, pitch and family `0x32`, and selects it into the current draw target only. Returns 1.
- Ours: the model does not draw text (OQ-16).

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
| `1038:1744` | `gfx_initDisplay` | `src/gfx/gdi/surface.ts:24` `makeSurface`, `src/gfx/gdi/surface.ts:28` `makeDrawState` | fixed |
| `1038:194e` | `gfx_closeDisplay` | none (nothing to free) | match |
| `1038:1ade` | `gfx_applyClip` | `src/gfx/gdi/surface.ts:38` `activeClip` | fixed |
| `1040:0d54` | `gfx_drawPixel` | `src/gfx/gdi/primitives.ts:4` `setPixel` | fixed |
| `1030:02ef` | `gfx_drawLine` | `src/gfx/gdi/primitives.ts:8` `drawLine` | open |
| `1038:1bd8` | `gfx_drawRect` | `src/gfx/gdi/primitives.ts:12` `drawRect` | fixed |
| `1040:0688` | `gfx_drawCircle` | `src/gfx/gdi/primitives.ts:39` `drawCircle` | open |
| `1030:04ee` | `gfx_drawText` | none (text not modeled) | open |
| `1030:04ce` | `gfx_drawTextNear` | none (text not modeled) | open |
| `1030:0765` | `gfx_loadFont` | none (text not modeled) | open |
