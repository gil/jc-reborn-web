# Resources: Archive, Map, and Decompression

Findings for chunk 2. One claim per address. Our own words; no decompiled code.

## Compressed stream

- `1028:0615`: far cdecl `(method, fileHandle, modeString, lengthLo, lengthHi)`. Opens a stream on a file already positioned at a chunk body and returns a stream id (0..99), or `0xFFFF` on failure.
- `1028:0615`: in read mode the `method` argument is ignored. The method is the first byte of the chunk body, read with `1018:14e9`. The harness passes `0` and still gets RLE and LZW output.
- `1028:0615`: in read mode the next 4 bytes (u32 uncompressed size) are read with `1018:1287(buffer, 1, 4, handle)` into stream record `+0x12`.
- `1028:0615`: `length` (the chunk's own size field) is stored as a 32-bit value at stream record `+0x0e`. Open itself does not use it.
- `1028:0615`: the file position from `1018:1475` is stored at record `+0x1c`, the file handle at `+0x06`.
- `1028:0615`: if the method byte is rejected, it seeks the file back one byte (`1018:1398(handle, -1, whence 1)`), frees the stream, and returns `0xFFFF`.
- `1028:0615`: after a successful read-mode open it runs the method's read init function (method table `+0x0c`) when non-zero, then sets flags `0x40` (read) and `0x20` (file-backed) in the record's flag byte at `+0x20`.
- `1028:0458`: the mode string means read if it contains an `r` anywhere. `1068:2620` holds `"r"`.
- `1028:04f8`: takes the first empty slot of a 100-entry table of near pointers at `1068:3f66` and allocates a zeroed 0x21-byte stream record with `1038:06a8(1, 0x21)`. Returns `0xFFFF` when all 100 slots are used or the allocation fails.
- `1028:0547`: rejects methods 3 and up (signed compare against 3) with `0xFFFF`. Otherwise allocates the near I/O buffer (read mode: method table `+0`, write mode: always 0x80 bytes) into record `+0x00`, and stores the method in the low bits of the flag byte.
- `1028:0547`: the per-method state size is table `+2` in read mode and `+4` in write mode. When non-zero, the state is a far block: the preset far pointer at `1068:1dbe` if it is non-null, else a fresh `1030:199a(size, 0, 0, 0)` block. Its far pointer goes to record `+0x02`. `1068:1dbe` is null in the image's static data.
- `1028:03d0`: validates a stream id (0..99, slot non-null) and loads the record's fields into globals: flag byte `& 0x1f` is the method index (`1068:3f64`). Returns 0 for a bad id, which makes `1028:0a0d` and `1028:0875` return `0xFFFF`.
- `1028:0a0d`: far cdecl `(stream, dstOffset, dstSegment, count)`. Stores the far destination, then delegates to `1028:09ca`. Returns the number of bytes produced.
- `1028:09ca`: first drains bytes left in the near I/O buffer from the previous call (`1028:0951`), then calls the method's read function (table `+6`) for the rest, then drains again. Adds the produced count to a 32-bit total at record `+0x16`.
- `1028:0951`: copies buffered bytes (record `+0x1b` read index up to `+0x1a` fill count) to the far destination with `1030:00b9` and advances it.
- `1028:0875`: far cdecl `(stream)`. In read mode it only frees the stream. In write mode it first calls the flush function (table `+8`) and writes the final u32 size back after the method byte. Returns 0 for a read-mode stream.
- `1028:048e`: frees a stream: the near I/O buffer and the record via `1028:0478`, and the far state via `1030:1b63` only when it was allocated (state non-null and `1068:1dbe` null). Clears the slot.
- `1028:0478`: null-safe near free; calls `1038:063b`, which frees through `LocalFree` (KERNEL ordinal 7). The harness replaces `1038:063b` too.
- File layer argument layouts used by the stream code match the overview's table: `1018:1287(buf, size, count, handle)`, `1018:14e9(handle)`, `1018:1398(handle, offsetLo, offsetHi, whence)`, `1018:1475(handle)`. The harness checks the handle position on every call.

## Emulated edge cases

Outputs of the original decompressor run in Unicorn by `scripts/re/unicorn/dump_decompressed.py --edge-cases`. Bodies are chunk bodies: method byte, u32 uncompressed size, data. LZW bodies are built by `pack_codes` (LSB-first codes) in `scripts/re/unicorn/original_decompress.py`.

| Case | Body | Original output |
| --- | --- | --- |
| rle literal | `01 03 00 00 00 03 01 02 03` | `01 02 03` |
| rle run | `01 03 00 00 00 83 aa` | `aa aa aa` |
| rle zero run | `01 02 00 00 00 80 ff 02 de ad` | `de ad` |
| rle zero literal | `01 02 00 00 00 00 02 de ad` | `de ad` |
| rle truncated | `01 05 00 00 00 02 de ad` | `de ad` |
| rle run past size | `01 02 00 00 00 85 aa` | `aa aa` |
| lzw new entry | `02 04 00 00 00 41 84 04 04` | `41 42 41 42` |
| lzw kwkwk | `02 03 00 00 00 41 02 02` | `41 41 41` |
| lzw truncated | `02 0a 00 00 00 41 84 00` | `41 42` |
| lzw clear | `02 02 00 00 00 41 00 02 00 00 00 00 00 00 42 00` | `41 42` |
| lzw width growth | 295 bytes, see `scripts/re/unicorn/test_original_decompress.py` | `41` × 33153 |

All 180 compressed chunks in `RESOURCE.001` decompress to exactly their header size in the original.

## Method table

## RLE

## LZW

## Map and archive

## Name hash

## File layer

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
