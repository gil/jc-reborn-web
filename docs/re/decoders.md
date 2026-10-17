# Decoders: Chunks, Palette, Screens, Bitmaps, TTM, ADS

Findings for chunk 3. One claim per address. Our own words; no decompiled code.

## Chunk reader

- `1038:0000`: there are 4 reader records of `0x43` bytes at `1068:414e`. It scans them from the last to the first and returns the near address of the one whose first word (the file handle) equals the argument, or 0 when none does. Passing 0 finds a free record.
- `1038:0000`: record layout: `+0x00` handle; `+0x02` current tag path, NUL-terminated after the last tag; `+0x1b` a stack of u32 end positions, one per depth, with bit 15 of the high word marking a container (entry 0 is the payload end, always a container); `+0x37` depth × 4; `+0x39` occurrence of the last search; `+0x3b` u32 body position of the current chunk; `+0x3f` u32 size of the current chunk.
- `1038:016b`: takes a free record, opens the name with `resources_openFile` and mode `1068:256e` (`"rb"`), seeks to the end (`1018:1398` whence 2) and stores the position from `1018:1475` as end entry 0 with the container bit set. Then resets the record with `1038:003a` and returns the handle. Returns 0 when no record is free or the open fails.
- `1038:003a`: zeroes the whole record except the handle and end entry 0 (payload end), so path, depth, occurrence, position, and size go back to 0. Then rewinds the file with `resources_rewindFile` (`1018:14cc`).
- `1038:0584`: returns 1 when its argument is the handle of an open record, else 0. Loaders use it to accept either a resource name or an already open handle.
- `1038:054b`: clears the record's handle (freeing the record) and closes the file with `resources_closeFile`. Returns 1, or 0 for an unknown handle.
- `1038:0091`: compares two strings character by character for at most `n` characters. It stops with "equal" when both reach a NUL at the same place or after `n` characters, and with "different" at the first mismatch, so a prefix never equals the longer string.
- `1038:0215`: far cdecl `(handle, path, occurrence)`. Fails at once (`DX:AX = 0xFFFF:0xFFFF`) for an unknown handle or when the path length is 0 or not a multiple of 4.
- `1038:0215`: copies the whole record to the backup at `1068:425a` before searching. Every failure exits through `1038:01da`.
- `1038:0215`: when the path differs from the record's current path (compared with `1038:0091`, at most 25 characters), occurrence 0 or less searches for the next match **forward from the current chunk**, and a positive occurrence `n` resets the reader and finds the `n`-th match from the start.
- `1038:0215`: when the path equals the current path: occurrence 0 returns the current position at once if the file still sits at the body; `-1` seeks back to the current body and returns it; otherwise occurrence 0 finds the next match after the current one, and a positive occurrence moves forward from the last occurrence, resets and counts from the start when it lies before it, or seeks back to the body when it is the same one.
- `1038:0215`: the walk starts by skipping the body of the current chunk if it is a leaf; a container's body is entered instead. Each step first pops every container (and the current leaf) whose end equals the position, failing when the pop would go below depth 0. A leaf at the current depth is skipped by its size. Otherwise it reads the next 4-byte tag and u32 size, pushes `position + size` (container bit kept from bit 31 of the size) as the new end, and clears the container bit from the size.
- `1038:0215`: a chunk matches only when its depth equals the path length and the full path of tags from the top equals the path, so the last tag alone never matches a nested chunk.
- `1038:0215`: depth is limited to 5 tags. The sixth nested header (`+0x37` reaching `0x18`) fails the search.
- `1038:0215`: the only size check is that a chunk's size is less than the whole payload size. A chunk that runs past its parent is not detected.
- `1038:0215`: a short read of the tag or the size fails the search.
- `1038:0215`: on success it stores the occurrence in `+0x39` and returns the body position (`DX:AX`, u32). The file is left at the body start.
- `1038:01da`: copies the backup at `1068:425a` back over the record, seeks the file to the restored position, and returns `0xFFFF:0xFFFF`. A failed search leaves the reader exactly where it was.
- `1038:0215`: emulated, a new path is searched only forward: after `PAG:` is found, `VER:` (earlier in the file) is not found.
- `1038:0215`: emulated, asking for the path just found again, with the file still at its body, returns the same chunk.
- `1038:0215`: emulated, a failed search in between does not move the reader: `VER:`, `XYZ:`, `PAG:` finds `PAG:` as if `XYZ:` was never asked.
- `1038:0215`: emulated, `TAG:` alone does not match the nested `TTI:TAG:`.
- `1038:0517`: returns only the low 16 bits of the current chunk size (`+0x3f`), or `0xFFFF` for an unknown handle.
- `1038:00d2`: `(buffer, handle)` copies the handle's record into a caller buffer and returns the buffer (0 on bad arguments). Only `1040:0db0` calls it.
- `1038:0119`: `(saved)` copies a saved record back over the live record with the same handle and seeks the file to its position. Returns 1, or 0 on bad arguments. Only `1040:0db0` calls it.
- `1038:0619`: far wrapper around `1000:229c`, which is `LocalAlloc(LMEM_FIXED, size)`: near memory, not zeroed.

## Emulated edge cases

Results of the original chunk lookup (`1038:016b`, then `1038:0215` with occurrence 0 and `1038:0517` per query) run in Unicorn by `scripts/re/unicorn/test_original_loaders.py`. All queries of a case run in order on one open reader. The payload is `VER:` (body 8..12), container `TTI:` (body 21..32) holding `TAG:` (body 29..32), then `PAG:` (body 41..42). Results are `(body position, size)` or none.

| Case | Queries | Original result |
| --- | --- | --- |
| top-level and nested paths | `VER:` / `TTI:` / `TTI:TAG:` / `PAG:`, each on a fresh reader | `(8, 5)` / `(21, 12)` / `(29, 4)` / `(41, 2)` |
| last tag alone | `TAG:` | none |
| not 4-byte tags | `""` / `PAG` / `XYZ:`, each on a fresh reader | none / none / none |
| forward in file order | `VER:`, `PAG:` | `(8, 5)`, `(41, 2)` |
| backward | `PAG:`, `VER:` | `(41, 2)`, none |
| same path twice | `PAG:`, `PAG:` | `(41, 2)`, `(41, 2)` |
| failed search in between | `VER:`, `XYZ:`, `PAG:` | `(8, 5)`, none, `(41, 2)` |

## Palette

- `1040:09eb`: far cdecl `(name or handle)`. Takes the first free palette slot 1..9 in the word table at `1068:45e4` (slot 0 is the active palette). With no free slot it returns 0 without opening anything.
- `1040:09eb`: finds `PAL:VGA:` with occurrence 0. When it is missing, the slot stays free and it returns 0.
- `1040:09eb`: reads 16 colors when the color mode `1068:1ebd` is 2, else 256. The count never depends on the chunk size: a 768-byte `PAL:VGA:` gives only its first 48 bytes in mode 2.
- `1040:09eb`: allocates `count × 3` zeroed near bytes (`1038:06a8`) into the slot, then reads red, green, blue one byte at a time with `resources_getFileByte` and stores each through the level table `1068:25b0`. Returns the slot pointer (RGB triplets), or 0 when the allocation fails.
- `1040:09eb`: when it opened the file itself, it closes with the name it was given, not the handle it opened, so the close fails and the reader record stays taken.
- `1068:25b0`: 64-byte level table: level `v` gives `v × 4` for 0..62, and 63 gives 255. A level above 63 would read past the table into the current palette word at `1068:25f0` and the `PAL:VGA:` string at `1068:25f2`.
- `1068:1ebd`: `1038:1744` (display setup) always sets it to 2. `platform_initSaver` (`1008:143c`) calls `1038:1744` with mode 2 before it loads `JOHNCAST.PAL` (`1068:024a`), so the original only ever reads 16 colors.
- `1008:143c`: startup loads `JOHNCAST.PAL` with `1040:09eb`, makes it active with `1040:0b08`, frees the loaded slot with `1040:0bc7`, then loads `INTRO.SCR` (`1068:0257`) with `1030:16d8`.
- `1040:0b08`: makes a loaded palette active. On first use it allocates the active palette (slot 0) and points `1068:25ae` at it; if that fails, `1068:25ae` points at a built-in 16-color table at `1068:257e`. It copies the given slot's colors, 3 bytes each, into slot 0 and remembers the pointer at `1068:25f0`. Argument 0 returns the remembered pointer; an unknown pointer returns 0.
- `1040:0bc7`: frees the palette slot (1..9) holding the given pointer and clears it. The active copy in slot 0 stays.
- Ours, before this step: `src/gfx/palette.ts` expanded levels with `(v << 2) | (v >> 4)`, which differs from the table for every level except 0 and 63 (32 gave 130, the original gives 128), and kept 256 colors. Fixed in this step.

## Screen

- `1030:16d8`: far cdecl `(name or handle)`. Width and height start at 320 × 400 (`0x140`, `0x190`). When `SCR:DIM:` exists, it reads a u16 width, then a u16 height, over them.
- `1030:16d8`: finds `SCR:BIN:` and opens a decompression stream on it with the low 16 bits of its size (`1038:0517`, `1028:0615`).
- `1030:16d8`: strips are `(width >> 1) << 6` bytes (64 rows). While the near allocation fails it halves the strip size, giving up when it drops below one row. An odd width loses its last column: a row is `width >> 1` bytes.
- `1030:16d8`: each strip is read from the stream into the near buffer and handed to `gfx_blitPixelRows` (`1040:0286`) as `(buffer offset, segment, x = 0, y, width, rows)`. The read count is not checked.
- `1030:16d8`: the row count is cut only after a strip, when the next one would pass the height. The first strip is never cut, so a screen under 64 rows still reads and blits 64 rows.
- `1030:16d8`: returns 1 after the pixels are drawn. The `SCR:VGA:` (5) and `SCR:AMG:` (6) layers are only tried when `1068:1ebf` is non-zero, and nothing writes `1068:1ebf`, so they never run.
- `1030:16d8`: when `SCR:BIN:` is missing, the stream fails, or no buffer can be allocated, the return value is an uninitialized stack word.

## Pixels

- `1040:0286`: wraps the buffer in a one-image record (width, rows), clears `1068:2572`, builds the bitmaps with `1040:0000`, and copies the bitmap to the offscreen DC at `(x, y)` with `BitBlt` `SRCCOPY`. The mask it gets is deleted unused, so screens are drawn opaque.
- `1040:0000`: for each image record in a zero-terminated list, builds a 4-bit DIB: header size `0x28`, positive height (bottom-up rows), 1 plane, 4 bits, no compression. The color table is the 16 RGB colors at `1068:25ae` (the active palette).
- `1040:0000`: when `1068:2572` is non-zero (bitmap loads), color table entry 0 is forced to black; when it is 0 (screens through `1040:0286`), entry 0 is the palette's color 0.
- `1040:0000`: builds the mask with `1040:035c` from the top-down buffer, then flips the rows with `1040:0462` so they fit the bottom-up DIB. The image advances by `(width / 2) × height` bytes.
- `1040:035c`: the left pixel of a packed byte is its high nibble.
- `1040:035c`: builds a 1-bit mask bitmap, bit set where the 4-bit index is not 0, so index 0 is see-through only where the mask is used (bitmaps, not screens). It writes `width / 8` mask bytes per row, with a row stride of `((width + 8) / 16) × 2` bytes.
- `1040:0462`: swaps rows top to bottom in place, `width / 2` bytes per row, `height / 2` swaps.
- Ours: `src/decode/` maps index 0 to `TRANSPARENT` for screens and bitmaps alike. For screens the original draws palette color 0 instead; logged as OQ-9 for chunk 4.

## Bitmap

- `1030:1112`: far cdecl `(handle, count out, list out)`. Finds `BMP:INF:` with occurrence 0 and reads a u16 image count, then `count` u16 widths, then `count` u16 heights, each with `resources_readFile`. A missing chunk or a short read returns 0.
- `1030:1112`: allocates a zeroed near list of `count + 1` record pointers and one zeroed near block of `count` 14-byte records; the list's first entry is the block. It returns 0 when either allocation fails, without freeing what it already got.
- `1030:1112`: record layout: `+6` width and `+8` height, written here; `+1` a byte copied from `1068:2e74`, `+2` the DIB, `+4` the mask, `+0x0a` and `+0x0c` a second DIB and mask, all written later by `1040:0000`. The list ends with a 0 entry. Returns 1.
- `1030:000e` (through `1068:1e24`): `(list, second out)` sums `((width + 1) / 2) × height` over the zero-terminated record list, returned as a u32 in `DX:AX`. It always sets the second output to 0.
- `1030:124a`: far cdecl `(name or handle)`. Opens the name with `1038:016b` unless `1038:0584` says it is already a handle, and closes it at the end only when it opened it.
- `1030:124a`: reads the records with `1030:1112`, then allocates one far pixel buffer of the `1030:000e` size. A second far buffer of the second output's size is only allocated when that size is not 0, and `1030:000e` always makes it 0.
- `1030:124a`: when no decompression scratch is set at `1068:1dbe`, it checks that `0x3cc4` near bytes are free, frees them, and keeps a `0x3ac4`-byte block at `1068:1dbe`. `resources_initStreamMethod` (`1028:0547`) uses that block as the method's work buffer instead of a far allocation, and `resources_freeStream` leaves it alone. The loader frees it at the end and clears `1068:1dbe`.
- `1030:124a`: finds `BMP:BIN:` with occurrence 0, opens a decompression stream with the low 16 bits of its size, and reads it into the far buffer in `0x7fff`-byte reads until a read comes back short. The read total is not checked against the buffer size.
- `1030:124a`: calls `1068:2574` with 9 words: record list, pixel buffer (offset, segment), the stream's unpacked size from `resources_streamSize` (u32), the second buffer (offset, segment), and the `1030:000e` size (u32). Then it closes the stream.
- `1068:2574`: points at `1040:0000` (relocation). `1040:0000` reads only the record list and the pixel buffer.
- `1040:0000`: with `1068:2572` non-zero (its static value is 1; only `1040:0286` clears it, and sets it back to 1 after), it frees the pixel buffer after building every image, so a loaded bitmap keeps only its DIBs and masks.
- `1040:0000`: advances by `(width / 2) × height` bytes per image, while `1030:000e` sizes the buffer with `((width + 1) / 2) × height`. For an odd width the images after the first would start one byte per row too early. Every width in the data is even, so the two agree.
- `1030:124a`: the `BMP:VGA:` (5) and `BMP:AMG:` (6) layers are only tried when `1068:1ebf` is non-zero. Nothing writes `1068:1ebf` (static 0; the three accesses in the code are reads), so these branches never run.
- `1068:2578`: also points at `1040:0000`, but the dead `BMP:VGA:`/`BMP:AMG:` branch calls it with a layer buffer, the pixel buffer, and a byte count, which does not match `1040:0000`'s arguments. It is never reached.
- `1030:1624`: `(source, destination, count)` expands 1 bit per pixel into 4-bit indices 0 or 1, 4 output bytes per input byte, working from the end backward so it can expand in place. Bit 0 of a byte becomes its last pixel. Only the dead `BMP:AMG:` branch calls it.
- `1030:124a`: returns the record list, or 0 on any failure. On failure it frees the pixel buffer, closes the stream, and frees the records with `1030:15cc`.
- `1030:15cc`: frees the record block (the list's first entry), then the list. It reads the first entry before checking the list for 0.
- Data: 2 bitmaps carry a `BMP:VGA:` chunk (`MJTELE.BMP`, `JOHNWALK.BMP`). The original ignores it in every mode it can run in, and so do we.

## Bitmap matrix

- `1040:0db0`: far cdecl `(name or handle)`. First drops the previous matrix bitmap (`1040:10ef` deletes `1068:45f8`). Returns 0 for a 0 argument.
- `1040:0db0`: when given an open handle it saves the reader with `1038:00d2` and restores it with `1038:0119` after reading, so the caller's position is kept; when given a name it opens and closes the file itself.
- `1040:0db0`: `BMP:MTX:` layout: u16 columns, u16 rows, then `columns × rows` u16 image indices, column by column (each column top to bottom). The indices go into a far buffer; a missing chunk or failed allocation returns 0.
- `1040:0db0`: loads the same resource as a bitmap through `1028:17fa` (a thunk to `1030:124a`). Every tile has the size of image 0. It makes a compatible bitmap of `columns × tile width` by `rows × tile height` at `1068:45f8` and blits each indexed image into its cell. The index is not bounds checked. When `1068:2e77` is 2 it does a second blit per tile (not read further). Then it frees the index buffer and the bitmap records and returns 1.
- `1058:06f7`: the only caller. It is inside the TTM interpreter `1058:040c`, in the handler for opcode `0xF08F` (a jump table at `1058:12bd` that Ghidra does not follow): it drops the old matrix with `1040:10ef` when `1068:2640` is set, loads the opcode's string argument with `1040:0db0`, and stores the result in `1068:2640`. `gfx_blitBmpMatrix` (`1040:1113`) draws from it.
- Data: no resource has a `BMP:MTX:` chunk (all 117 `BMP:MTX:` lookups in `re/fixtures/loaders/chunks.tsv` fail), and `0xF08F` is not among the opcodes our TTM scripts use. We need no decoder for it.

## TTM loader

## TTM opcode coverage

## ADS loader

## ADS opcode coverage

## Thunks

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1038:0000` | `decoders_chunkReaderFor` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:003a` | `decoders_resetChunkReader` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:0091` | `decoders_tagPathEquals` | `src/decode/chunks.ts:35` (`chunk.path === path`) | match |
| `1038:00d2` | `decoders_saveChunkReader` | none (only the `BMP:MTX:` loader uses it, and the data has no `BMP:MTX:`) | match |
| `1038:0119` | `decoders_loadChunkReader` | none (only the `BMP:MTX:` loader uses it, and the data has no `BMP:MTX:`) | match |
| `1038:016b` | `decoders_openChunkFile` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:01da` | `decoders_restoreChunkReader` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:0215` | `decoders_findChunk` | `src/decode/chunks.ts:33` (`findChunk`; searches from the start, which agrees with the forward-only original because every loader asks for its chunks in file order) | fixed |
| `1038:0517` | `decoders_chunkSize` | `src/decode/chunks.ts:33` (`findChunk` `size`; the full size equals the low 16 bits because every leaf chunk is under 64 KB) | match |
| `1038:054b` | `decoders_closeChunkFile` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:0584` | `decoders_isChunkFile` | none (we hold each payload in memory and search it whole; no reader records, rewinds, or backups are needed) | match |
| `1038:0619` | `platform_nearMalloc` | none (allocation) | match |
| `1040:09eb` | `decoders_loadPalette` | `src/decode/pal.ts:8` (`decodePal`; 16 colors through the level table) | fixed |
| `1030:16d8` | `decoders_loadScreen` | `src/decode/scr.ts:10` (`decodeScr`); strips: none (we decode the whole screen at once; the only visible difference, the uncut first strip, needs a screen under 64 rows, and the data has none) | fixed |
| `1030:1112` | `decoders_readBmpInfo` | `src/decode/bmp.ts:8` (`decodeBmp`: count, widths, then heights from `BMP:INF:`) | fixed |
| `1030:124a` | `decoders_loadBmp` | `src/decode/bmp.ts:8` (`decodeBmp`: one `BMP:BIN:` buffer cut image by image); `BMP:VGA:`/`BMP:AMG:` branches: none (never run, `1068:1ebf` is 0) | fixed |
| `1030:000e` | `decoders_bmpPixelBytes` | `src/decode/bmp.ts:21` (`unpackNibbles` length check; odd widths refused at `src/decode/bmp.ts:20`) | match |
| `1030:15cc` | `decoders_freeBmpInfo` | none (memory is garbage collected) | match |
| `1030:1624` | `decoders_expandAmgBits` | none (AMG layers are never loaded) | match |
| `1040:0db0` | `decoders_loadBmpMatrix` | none (no `BMP:MTX:` in the data, and no TTM script uses its opcode `0xF08F`) | match |
