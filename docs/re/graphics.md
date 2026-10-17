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
- `1028:182c`: forwards its one word to `1030:15fb`. Referenced (relocations) from `1050:0052` and `1050:0093`.
- `1028:1845`: forwards its one word to `1030:00fe`. Referenced from `1040:0f9f` and `1040:10dd` (`decoders_loadBmpMatrix`), `1050:0890`, and `1058:079a`, `1058:0837` (TTM code Ghidra does not disassemble).

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

- `1038:0ae4`: far cdecl `(record, x, y, flags)`. Does nothing for a null record. Reads record byte `+1` (scale mode the bitmaps were built for), `+2` image, `+4` mask, `+6` width, `+8` height, `+10` mirrored image, `+12` mirrored mask.
- `1038:0ae4`: picks the bitmaps: `flags & 2` → `+10`/`+12`; else `flags & 1` → none; else `+2`/`+4`. When either picked handle is 0 it falls back to `+2`/`+4` and marks the draw as a fallback.
- `1038:0ae4`: only a fallback draw negates `StretchBlt` destination extents: `flags & 1` → `y += h`, `h = -h`; `flags & 2` → `x += w`, `w = -w`. So with a pre-mirrored pair, flags 3 mirrors and does not flip upside down; without one, flags 3 does both. Where GDI puts the pixels of a negative extent is Windows behavior (OQ-18).
- `1038:0ae4`: with the clip applied, makes a memory DC and does two `StretchBlt`s from source `(0, 0, w, h)`: the mask with ROP `0x220326` (destination AND NOT source), then the image with ROP `0xEE0086` (`SRCPAINT`, destination OR source).
- `1038:0ae4`: on palette indices: the mask bit is set where the index is not 0 (`1040:035c`), so the first blit clears those pixels to 0; the image has entry 0 black (`1040:0000`), so the second blit ORs index 0 as 0. Net effect: index 0 keeps the destination, any other index replaces it. This rests on GDI keeping a 4-bit DDB's indices as is under these ROPs.
- `1038:0ae4`: dirty rect `(x, y, w, h)` from the arguments and record size, before any flip.
- `1038:0ae4`: calls `1038:0de1` first when record byte `+1` differs from `1068:2e75`, and has scaled-blit branches when `2e74`, `2e75`, `2e76` differ; all are 3 at runtime, so none runs (see Scaling).
- `1038:0ac2`: far cdecl `(record, x, y)`: `1038:0ae4` with flags 0. Callers: story code in `1010` (island, raft, and the other scenery draws).
- `1028:17d8`: forwards `(record, x, y, flags)` to `1038:0ae4`. Referenced from `1050:00fa` and from the TTM sprite opcode case at `1058:02ce`.
- `1058:025b`: the TTM case for opcodes `0xa504`..`0xa5a7` in the dispatcher `1058:0144` (jump table at `1058:03bc`, not followed by Ghidra). Flags are `(opcode >> 4) & 0x0f`. Low nibble 4 calls `1028:17d8(record, x, y, flags)`; low nibble 6 calls `1030:03d7(record, x, y, flags, w, h)`; low nibble 7 (`0xa5a7`) draws nothing here. The data uses only `0xa504` (flags 0) and `0xa524` (flags 2, mirror) (`docs/re/decoders.md`, TTM opcode coverage).
- `1030:03d7`: far cdecl `(record, x, y, flags, w, h)`. Always the plain pair `+2`/`+4`. The same two blits as `1038:0ae4`, to destination `(x, y, w, h)` from source `(0, 0, record w, record h)` with the source width negated for `flags & 2` and the source height for `flags & 1`. A negative source extent that starts at 0 points outside the bitmap; what GDI draws then is not in the binary (OQ-19). Dirty rect `(x, y, w, h)`.
- `1030:03d7`: reached only from the TTM case above with opcodes `0xa506`..`0xa536`, which no TTM script uses.
- Ours: `src/gfx/gdi/sprite.ts` draws raw indices with index 0 see-through and applies the flag rules above, including flags 3 with a pre-mirrored copy (`hasMirroredCopy`). For flags 0 and 2 it gives the same pixels as the old pipeline (`src/gfx/sprite.ts`) on every image (`src/gfx/gdi/sprite.data.test.ts`).

## Scaling (dead code)

- `1068:2e74`..`1068:2e77`: four scale-mode bytes. `platform_initSaver` (`1008:143c`) sets all four to 3. The only other writers are `1038:1744` (copies `2e74` into `2e76`) and `1038:19c7` (sets `2e76`), so all four stay 3.
- `1038:0de1`: far cdecl `(record)`. When record byte `+1` differs from `2e75`, replaces the record's image and mask with doubled (`1038:109e`) or halved (`1038:1485`) copies and stores `2e75` in `+1`. `1040:0000` stores `2e74` in `+1`, so it never differs.
- `1038:109e`: far cdecl `(bitmap)`. For a one-plane bitmap, builds a copy twice as wide and tall from its bits (`GetBitmapBits`, a lookup table at `1068:42a0`, `CreateBitmapIndirect`), then calls `1038:0e8a`. Returns the new bitmap, 0 when an allocation fails, or the given bitmap unchanged when it has more than one plane.
- `1038:0e8a`: far cdecl `(original, doubled)`. Reads the bits of both, makes a third copy with a 2× `StretchBlt`, reads its bits too, then frees everything. Nothing is compared or kept: it looks like leftover test code. Only `1038:109e` calls it.
- `1038:1485`: far cdecl `(bitmap)`. For a one-plane bitmap, builds a copy half as wide and tall from every other row of its bits, merging pixel pairs through a table at `1068:44a0`. Returns it, 0 when an allocation fails, or the given bitmap unchanged when it has more than one plane.
- `1038:19c7`: far cdecl `(mode)`. When `mode` differs from `2e76`, doubles or halves the three offscreen bitmaps, selects the new ones into A, B, C, sets `2e76`, and repaints the window. Nothing references it (no call and no relocation), so it never runs.
- The `/ 2` and `<< 1` branches of `1038:0ae4`, `1038:07e8`, `1038:06ce`, and `1038:1ade` compare these bytes too and never run.

## Bitmap matrix

- `1068:45f8`: the matrix bitmap built by `decoders_loadBmpMatrix` (`1040:0db0`); `1068:45fa`/`45fc` the source x/y of the view; `1068:45fe`/`4600` the tile width/height. Only `1040:0db0` sets `45f8` non-zero.
- `1040:10ef`: deletes the matrix bitmap when there is one and clears `45f8`. Called from `1030:017f`, `1040:0db0`, and `1050:080c`.
- `1040:1113`: far cdecl `(x, y, w, h)`. When there is a matrix bitmap, `BitBlt`s `(x, y, w, h)` from it at source `(45fa, 45fc)` with `SRCCOPY` onto the draw target, then presents the rect. Reached only from the TTM case for opcode `0xa704` (`1058:023e`, call at `1058:0251`).
- `1040:1183`: far cdecl `(direction, steps)`. Moves the view by whole tiles: 0 up (`45fc -= steps × 4600`), 1 down, 2 left (`45fa -= steps × 45fe`), 3 right. Referenced only from TTM code at `1058:0721` (inside `1058:040c`).
- No resource has a `BMP:MTX:` chunk and no TTM script uses `0xF08F` or `0xa704` (`docs/re/decoders.md`), so `45f8` stays 0 and none of this draws anything.

## Dirty rects

- `1060:0000`: far cdecl `(count)`. Allocates `ceil(count / 5) × 5` zeroed 26-byte nodes in one near block (`1038:06a8`), chains them, marks the first with word `[9]` = 1 (block start), puts them in front of the free list `1068:46ee`, and adds the count to `1068:46ec`. Returns 1, or 0 when the allocation fails. `1060:007e` calls it with 5 when the free list is empty; `1050:016e` calls it at TTM setup.
- Node words: `[0]` x, `[1]` y, `[2]` w, `[3]` h, `[4]` source DC, `[5]` target DC, `[6]` kind, `[7]` age, `[8]` area, `[9]` block start, `[10]`/`[11]` saved-bits offset/segment, `[12]` next.
- `1068:46f0`: 20 list heads. A list is keyed by the source, target, and age of its head node.
- `1060:05a7`: far cdecl `(source, target, age)`. Returns the head slot whose head node matches all three, even when an empty slot comes first; else the first empty slot; else 0 (all 20 slots hold other keys, and the caller does nothing).
- `1060:007e`: far cdecl `(x, y, w, h, kind, source, target, age, saved offset, saved segment)`. Kind 4 forces the source to `-1` (`1068:287c` holds `0xffff`, the matching table entry). Finds the slot first; with none it returns.
- `1060:007e`: kind 1 with the clip off (`1068:1ea3` = 0): drops the rect when `x > width - 1`, `x + w < 0`, `y > height - 1`, or `y + h < 0` (screen size `1068:2562`/`2564`); otherwise cuts it to the screen.
- `1060:007e`: kind 1 with the clip on: drops the rect when `x2 < x`, `x + w < x1`, `y2 < y`, or `y + h < y1` (inclusive clip rect `1068:1ea4`..`1eaa`); otherwise cuts it to the clip rect. It does not also cut to the screen, so a clip rect that starts left of 0 keeps a negative x.
- `1060:007e`: kind 1 then turns x and w into 8-pixel columns: `w = (w + x % 8 + 7) / 8`, `x = x / 8` (signed division, truncated). Kind 4 keeps pixels. Any other kind is stored as given.
- `1060:007e`: drops the rect when w or h is 0. Otherwise takes a free node, fills it, and sets its area to `w × h` as a signed 16-bit word.
- `1060:007e`: kind 1 only: merges with every node of the same list whose bounding box with the new rect has a 16-bit area at most `node area + new area + 20` (all 16-bit signed, so a box of 80 columns × 480 rows, 38,400, reads negative and always merges). A merged node is unlinked and freed, and the new rect grows to the box.
- `1060:007e`: after a merge the scan goes on from the next node, then restarts from the head and stops when it reaches the node that preceded the last merge (or runs off the end with no merge pending). Then the new node is inserted at the head.
- `1060:05f9`: far cdecl `(source, target, age)`. Does nothing for a missing or empty list. Sets the copy source `1068:1eb6` and draw target `1068:1eb8` from the head node, then walks head to tail: kind 1 → `1038:06ce(x × 8, y, w × 8, h)`; kind 4 → `1030:0250(saved offset, saved segment, x, y, w, h)`; other kinds nothing. Then frees the whole list. It does not restore `1eb6`/`1eb8`.
- `1060:03d3`: far cdecl `(which)`. Saves `1eb6`/`1eb8`. With 0, walks the table at `1068:287e` (pairs of near pointers to the source and target DC globals) and replays each pair with age 0 until a pair's target pointer is 0; with anything else, replays only the pair at `1068:2882`. Restores `1eb6`/`1eb8`.
- `1068:287e`: emulated, the pairs are `(-1, A)`, `(B, A)`, `(-1, B)`, `(C, B)`, `(-1, C)`, `(A, C)`, `(A, B)`, `(B, C)`, `(C, A)` (`re/fixtures/graphics/restore-table.tsv`); `1068:2882` is `(B, A)`.
- `1060:03d3`: with `which` 0 only, after the replays it subtracts 1 from the age of every node left in every list, so age 1 lists replay on the next pass. Its only caller is `1018:088f` (chunk 7).
- `1060:04b2`: far cdecl `(x, y, w, h, target, age)`. For every list whose head has that target and age (any source), returns 1 on the first kind-1 node that overlaps the rect, comparing columns (`x / 8`, `(w + x % 8 + 7) / 8`) and rows; else 0. Called from story code in `1010`.
- `1060:046e`: moves every node of every list to the free list and empties all 20 heads.
- `1060:0556`: frees the node pool: empties the lists (`1060:046e`), then frees every block of the free list that starts with a block-start node, and clears the free list. It does not reset the pool count `1068:46ec`. Called from `1050:0a79`.
- `1060:0596`: returns the pool count `1068:46ec`. Nothing references it.
- `1060:06ac`: far cdecl `(source, target, age)`: frees one list without replaying it. Called from `1050:0b69`.
- `1060:06f5`: far cdecl `(source, target, age, new source, new target, new age)`: meant to copy one list into another key with `1060:007e`, but its loop only moves to the next node after the loop ends, so it adds the head again forever on a non-empty list. Nothing references it.
- Emulated: 300 random sequences of 40 operations (`re/fixtures/graphics/dirty.tsv`) end with the same results and lists in `src/gfx/gdi/dirty.ts` (`src/gfx/gdi/dirty.data.test.ts`).

## Display buffers

- `1068:1eb4`, `1eb2`, `1eb0`: three memory DCs (A, B, C) with 640 × 480 bitmaps, made by `1038:1744`. From the code: B is the clean copy that the restore table copies back into A (`(B, A)`), C is copied back into B (`(C, B)`), and the window is painted from A, or from B when `1068:429e` is set. Which TTM drawing goes where is chunk 5.
- `1068:1eb6` is the copy source and `1068:1eb8` the draw target of every drawing call. `1060:05f9` sets both from a list's head; `1060:03d3` puts them back after its pass.
- `1068:429e`: 0 in the data segment; `platform_initSaver` (`1008:143c`) sets it to 1. Two effects: `1038:06ce` skips copies whose target is A, and `1038:07e8` presents from B (or from the copy source) instead of A.
- `1038:06ce`: far cdecl `(x, y, w, h)`. Does nothing when source equals target, or `w` or `h` is 0. Widens to 8-pixel columns: `w += x % 8`, `x -= x % 8`, then `w += 8 - w % 8`, which adds a whole column even when `w` is already a multiple of 8.
- `1038:06ce`: `StretchBlt` with `SRCCOPY` from the copy source to the draw target at the same `(x, y, w, h)`, skipped when `1068:429e != 0` and the target is A; then `1038:07e8(0, x, y, w, h)` with the widened rect either way. The scale branches never run.
- `1038:07e8`: far cdecl `(dc, x, y, w, h)`. Runs only when `dc != 0`, or the split debug mode `1068:2e77 == 2` (never), or the target is A. With `dc == 0` it presents to the window `1068:2d84`, using the paint DC `1068:2d82` or `GetDC`.
- `1038:07e8`: with a window (`1068:2d84 != 0`) and no `dc`, it copies the rect from the draw target, which is A here, or from the copy source when `1068:429e != 0`. With an explicit `dc`, or with no window, it copies from A, or from B when `1068:429e != 0`.
- `1038:07e8`: when the client area differs from 640 × 480 (`1068:410c`/`410a`, set on `WM_SIZE`), it shifts the rect by half the difference to center the picture (scale mode 3).
- `1008:0fcd`: `WM_PAINT` and `WM_ERASEBKGND` blit nothing; they add a kind-1 dirty rect `(B, A)` age 0 for the painted area (`WM_ERASEBKGND` first fills the client area black), shifted back by the centering offset. The next restore pass presents it.
- `1030:01c4`: far cdecl `(buffer offset, buffer segment, x, y, w, h)`. Copies `(x, y, w, h)` of the copy source `1068:1eb6` into a new compatible bitmap and reads its bits into the caller's buffer, `1030:0197(w, h)` bytes.
- `1030:0197`: far cdecl `(w, h)`: `((w + 15) / 16 × 16) / 2 × h`, the bytes of a 4-bit bitmap with rows padded to 16 pixels.
- `1030:0250`: far cdecl `(buffer offset, buffer segment, x, y, w, h)`. Writes the buffer into a new compatible bitmap and copies it to `(x, y)` of the draw target `1068:1eb8` with `SRCCOPY`, then presents the rect.
- `1030:01c4`, `1030:0197`, `1030:0250`: reached from `1058:1510` (`1058:17ae`, `1058:17f8`, `1058:1852`), which the TTM dispatcher `1058:0144` calls for opcodes `0xa014`..`0xa094` and `0xa0b5`; `1030:0250` also from `1060:05f9` (kind-4 rects). Chunk 5 maps the opcodes.
- `1040:0286`: far cdecl `(buffer offset, buffer segment, x, y, width, rows)`. Wraps the rows in a one-image record, clears `1068:2572` so the color table keeps palette color 0, builds the bitmap with `1040:0000`, and copies it opaque (`SRCCOPY`) to `(x, y)` of the draw target; the mask it gets is deleted unused. Then presents the rect and sets `1068:2572` back to 1.
- `1040:034e`: an empty function. `decoders_loadScreen` (`1030:16d8`) calls it for each strip of the `SCR:VGA:`/`SCR:AMG:` layers, a path that never runs (`docs/re/decoders.md`, `Screen`).
- `1068:287e`: the restore table walked by `1060:03d3`, emulated: `(-1, A)`, `(B, A)`, `(-1, B)`, `(C, B)`, `(-1, C)`, `(A, C)`, `(A, B)`, `(B, C)`, `(C, A)`; `1068:2882` is `(B, A)` (`re/fixtures/graphics/restore-table.tsv`, pinned by `src/gfx/gdi/display.data.test.ts`).
- Ours: `src/gfx/gdi/display.ts` keeps three surfaces, the source and target indices, and `screenIsB` (`1068:429e`). Choices of the model: `saveRect` stores exact pixels under an id instead of a padded buffer, pixels read from outside the source are 0, and the window is presented whole every frame from `shown()` (A, or B when `screenIsB`) instead of rect by rect (OQ-17).

## Wipes

- `1020:0364`: far cdecl `(dc)`. With a non-zero `dc` it sets the draw target to A and the copy source to `dc`, copies the whole screen (`1038:06ce`), and returns; no wipe. Its only caller, `1018:0673` (chunk 7), passes 0.
- `1020:0364`: with 0 it draws on the window DC (paint DC `1068:2d82` or `GetDC`), selects the stock black brush (4) and black pen (7), and centers a 640 × 480 area in the client rect: `left + (client width - 640) / 2`, same for top.
- `1020:0364`: picks the wipe from the counter `1068:361a` (0 in the data segment) and adds 1: 0 ellipse, 1 rect, 2 right to left, 3 left to right, 4 top to bottom, 5 bottom to top. Any other value runs the ellipse and sets the counter to 1. So the order is ellipse, rect, right to left, left to right, top to bottom, bottom to top, then again from the ellipse.
- `1020:0364`: after the wipe it fills with the black brush the rect from the centered top-left corner to the client's bottom-right corner (the whole client area when it is 640 × 480), restores the old brush and pen, and releases the DC.
- `1020:0512`: ellipse out. Half sizes `hw = w / 2`, `hh = h / 2`, center `(x + hw, y + hh)`; step and radius start at 1. While `hw > 0` or `hh > 0`: `hw -= step`, `hh -= step`, `radius += step`, `step += 1`, `Ellipse(cx - radius, cy - radius, cx + radius, cy + radius)`. 25 circles for 640 × 480.
- `1020:05a0`: rect out. Steps `sx = cx / 50`, `sy = cy / 50` from the center coordinates, not the half sizes, so the steps grow when the area is offset in a larger client rect. Each round `Rectangle(cx - ix, cy - iy, cx + ix, cy + iy)` with `ix`, `iy` growing by `sx`, `sy`, while `hw > 0` or `hh > 0` (both shrink by the steps). 60 rects for 640 × 480 at the origin.
- `1020:0637`: right to left. Strip `s = w / 100`; first strip at `x + w - s`; each round `Rectangle(left, y, left + s, y + h)`, `left -= s`, `w -= s`, while `w > 0`. 107 strips for 640, the last at `-2`.
- `1020:0688`: left to right: the same strips from `x` moving right.
- `1020:06d2`: top to bottom. Strip `s = h / 200`; `Rectangle(x, top, x + w, top + s)` from `top = y` moving down while `h > 0`. 240 strips for 480.
- `1020:071c`: bottom to top: the same strips from `y + h - s` moving up.
- `1008:13cd`: every wipe calls it after each shape. It removes and dispatches at most one pending keyboard or mouse message (so input can end the saver mid-wipe). There is no timer: a wipe runs as fast as the machine draws.
- Emulated: `re/fixtures/graphics/wipes.tsv`, 6 wipes × 2 areas (at the origin and centered in 800 × 600), equal to `wipeShapes` in `src/gfx/fade.ts` (`src/gfx/fade.data.test.ts`).
- Ours: `src/gfx/fade.ts` runs the same six wipes in the same order and ends black, spread over `WIPE_TICKS` story ticks (OQ-21).

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
| `1038:0ae4` | `gfx_drawSprite` | `src/gfx/gdi/sprite.ts:11` `drawSprite` | open |
| `1038:0ac2` | `gfx_drawSpritePlain` | `src/gfx/gdi/sprite.ts:11` `drawSprite` with flags 0 | match |
| `1030:03d7` | `gfx_drawSpriteStretched` | `src/gfx/gdi/sprite.ts:25` `drawSpriteStretched` | open |
| `1028:17d8` | `gfx_callDrawSprite` | none (forwarder) | match |
| `1038:0de1` | `gfx_rescaleSprite` | none (scale modes are all 3, never runs) | match |
| `1038:0e8a` | `gfx_checkDoubledBitmap` | none (scale modes are all 3, never runs) | match |
| `1038:109e` | `gfx_doubleBitmap` | none (scale modes are all 3, never runs) | match |
| `1038:1485` | `gfx_halveBitmap` | none (scale modes are all 3, never runs) | match |
| `1038:19c7` | `gfx_rescaleDisplay` | none (scale modes are all 3, never runs) | match |
| `1040:10ef` | `gfx_freeBmpMatrix` | none (no `BMP:MTX:` in the data) | match |
| `1040:1113` | `gfx_blitBmpMatrix` | none (no `BMP:MTX:` in the data) | match |
| `1040:1183` | `gfx_scrollBmpMatrix` | none (no `BMP:MTX:` in the data) | match |
| `1060:0000` | `gfx_growDirtyPool` | none (no node pool) | match |
| `1060:007e` | `gfx_addDirtyRect` | `src/gfx/gdi/dirty.ts:47` `DirtyLists.add` | fixed |
| `1060:03d3` | `gfx_restoreDirtyRects` | `src/gfx/gdi/dirty.ts:101` `DirtyLists.restorePass` | fixed |
| `1060:046e` | `gfx_clearDirtyLists` | `src/gfx/gdi/dirty.ts:81` `DirtyLists.clear` | fixed |
| `1060:04b2` | `gfx_dirtyOverlaps` | `src/gfx/gdi/dirty.ts:64` `DirtyLists.overlaps` | fixed |
| `1060:0556` | `gfx_freeDirtyPool` | none (no node pool) | match |
| `1060:0596` | `gfx_dirtyPoolSize` | none (no node pool) | match |
| `1060:05a7` | `gfx_findDirtyList` | `src/gfx/gdi/dirty.ts:122` `find` | fixed |
| `1060:05f9` | `gfx_replayDirtyList` | `src/gfx/gdi/dirty.ts:85` `DirtyLists.replay` | fixed |
| `1060:06ac` | `gfx_dropDirtyList` | `src/gfx/gdi/dirty.ts:76` `DirtyLists.drop` | fixed |
| `1060:06f5` | `gfx_copyDirtyList` | none (dead code, endless loop, no callers) | match |
| `1038:06ce` | `gfx_copyRect` | `src/gfx/gdi/display.ts:41` `Display.copyRect` | fixed |
| `1038:07e8` | `gfx_presentRect` | `src/gfx/gdi/display.ts:37` `Display.shown` | open |
| `1030:01c4` | `gfx_saveRectBits` | `src/gfx/gdi/display.ts:50` `Display.saveRect` | fixed |
| `1030:0250` | `gfx_restoreRectBits` | `src/gfx/gdi/display.ts:56` `Display.restoreRect` | fixed |
| `1030:0197` | `gfx_rectBitsSize` | none (the model stores exact pixels) | match |
| `1040:0286` | `gfx_blitPixelRows` | `src/gfx/gdi/display.ts:61` `Display.blitScreen` | fixed |
| `1040:034e` | `gfx_noopLayerStrip` | none (empty function on a path that never runs) | match |
| `1020:0364` | `gfx_wipeScreen` | `src/gfx/fade.ts:29` `nextFadeState`, `src/gfx/fade.ts:89` `applyFade` | fixed |
| `1020:0512` | `gfx_wipeEllipseOut` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
| `1020:05a0` | `gfx_wipeRectOut` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
| `1020:0637` | `gfx_wipeRightToLeft` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
| `1020:0688` | `gfx_wipeLeftToRight` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
| `1020:06d2` | `gfx_wipeTopToBottom` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
| `1020:071c` | `gfx_wipeBottomToTop` | `src/gfx/fade.ts:39` `wipeShapes` | fixed |
