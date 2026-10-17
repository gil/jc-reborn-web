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
- `1028:04f8`: the slot table at `1068:3f66` has 100 near pointers. A slot is free when it holds 0.
- `1028:03d0`: stream record fields (0x21 bytes): `+0x00` near I/O buffer, `+0x02` far codec state, `+0x06` file handle (far memory pointer for memory streams), `+0x0a` u32 input bytes consumed, `+0x0e` u32 chunk length, `+0x12` u32 uncompressed size, `+0x16` u32 bytes produced, `+0x1a` buffer fill, `+0x1b` buffer read index, `+0x1c` u32 file position of the chunk body, `+0x20` flags (low 5 bits method, `0x20` file-backed, `0x40` read mode).
- `1028:03d0`: copies the record into globals for the codec: record at `1068:4030`, I/O buffer `1068:4038`, state `1068:4032`, flags `1068:402e`. The per-call flag word `1068:3f60` is reset to `0x20` for file streams and 0 for memory streams.
- `1028:0a0d`: sets bit `0x40` of `1068:3f60`, meaning "store the output". Without it (the seek path in `1028:0b36`) the codecs decode and discard.
- `1028:0615`: the consumed counter at record `+0x0a` starts at 5, the size of the method byte and the u32 size already read.
- `1028:0125`: fetches one input byte. Returns `0xFFFF` without reading once the consumed counter equals the chunk length (record `+0x0e`). So input stops at the end of the chunk, not at the end of the file.
- `1028:0185`: reads up to `n` input bytes into a near buffer, cut to what is left of the chunk length. Returns the count, 0 at the end of the chunk.
- `1028:00b8`: copies `n` bytes straight from the file to a far address, 50 bytes at a time through a bounce buffer at `1068:3f2e`. It does not check the chunk length. Only the RLE literal path (`1028:022e`) uses it.
- `1028:0331`: hands one output byte to the caller. If the request is already full, the byte goes to the near I/O buffer instead and the function returns 0, telling the codec to pause. Otherwise it stores the byte (when `0x40` is set), advances the destination, and returns 1.
- `1028:09ca`: the read count is the request minus what is still missing. A short count means the input ran out.
- `1028:0951`: when the buffer holds more bytes than the request, the rest stay for the next call; otherwise the buffer is emptied.
- `1028:0a4b`: far `(stream, srcFar, count)`, the write-side counterpart of `1028:0a0d`. Pushes bytes through the 128-byte ring in the I/O buffer and calls the method's write function (table `+8`) with flush 0. No callers.
- `1028:0b0a`: far `(stream)`. Returns the uncompressed size from the header (record `+0x12`) in `DX:AX`, or `0xFFFFFFFF` for a bad id. Called by the BMP, ADS, and TTM loaders.
- `1028:0b36`: far `(stream, offsetLo, offsetHi, whence)`, a seek in decompressed bytes (whence 0 start, 1 current, 2 end of the uncompressed size). Forward seeks decode and discard in 32000-byte steps, clamped to the uncompressed size. Backward seeks rewind (`1028:0c92`) and decode forward from 0. Returns the new position. No callers.
- `1028:0c92`: rewinds a read-mode stream: reruns the method's read init, resets the consumed counter to 5, moves the file (or memory pointer) back to body + 5, and clears the produced count and buffer indexes. Returns `0xFFFF` for a write-mode stream. Only `1028:0b36` calls it.

## Emulated edge cases

Outputs of the original decompressor run in Unicorn by `scripts/re/unicorn/dump_decompressed.py --edge-cases`. Bodies are chunk bodies: method byte, u32 uncompressed size, data. LZW bodies are built by `pack_codes` (LSB-first codes) in `scripts/re/unicorn/original_decompress.py`.

| Case | Body | Original output |
| --- | --- | --- |
| stored | `00 03 00 00 00 01 02 03` | `01 02 03` |
| stored truncated | `00 05 00 00 00 01 02` | `01 02` |
| rle literal | `01 03 00 00 00 03 01 02 03` | `01 02 03` |
| rle run | `01 03 00 00 00 83 aa` | `aa aa aa` |
| rle zero run | `01 02 00 00 00 80 ff 02 de ad` | `de ad` |
| rle zero literal | `01 02 00 00 00 00 02 de ad` | `de ad` |
| rle truncated | `01 05 00 00 00 02 de ad` | `de ad` |
| rle run past size | `01 02 00 00 00 85 aa` | `aa aa` |
| rle run without value | `01 03 00 00 00 83` | `ff ff ff` |
| lzw new entry | `02 04 00 00 00 41 84 04 04` | `41 42 41 42` |
| lzw kwkwk | `02 03 00 00 00 41 02 02` | `41 41 41` |
| lzw truncated | `02 0a 00 00 00 41 84 00` | `41 42` |
| lzw clear | `02 02 00 00 00 41 00 02 00 00 00 00 00 00 42 00` | `41 42` |
| lzw code 256 after clear | `02 05 00 00 00 41 00 02 00 00 00 00 00 00 00 01` | `41 41 41` |
| lzw empty | `02 05 00 00 00` | `ff` |
| lzw first code above 255 | `02 05 00 00 00 2c 83 00` | `2c 41` |
| lzw width growth | 295 bytes, see `scripts/re/unicorn/test_original_decompress.py` | `41` × 33153 |

All 180 compressed chunks in `RESOURCE.001` decompress to exactly their header size in the original.

## Method table

- `1028:0547`: the table at `1068:1dc2` has 7 words per method: `+0` read-mode I/O buffer size, `+2` read state size, `+4` write state size, `+6` read function, `+8` write function (called with a flush flag), `+a` write init, `+c` read init. The overview's reading is right; `+8` is the write function itself, which `1028:0875` calls with flush 1 and `1028:0a4b` with flush 0.
- `1028:0615`: the init functions (`+a`, `+c`) are skipped when 0. `1028:09ca` calls the read function (`+6`) without a check.
- `1028:0000`: method 0's read function is 0, which is a real near address: `1028:0000` copies input bytes to the output unchanged until the input or the request runs out. Method 0 is "stored" and reads fine. Ghidra missed the function because nothing calls it directly.
- `1028:0547`: method 3 and up fail to open (signed compare against 3); `1028:0615` then seeks back over the method byte and returns `0xFFFF`.
- `1028:0547`: in read mode every method gets a 0x80-byte near I/O buffer. Only LZW has state: a far block of `0x3ab3` bytes (read) or `0x7566` bytes (write).
- `1028:11be`, `1028:1698`: write init for LZW and write function for RLE. Ghidra did not mark them as functions; they are only reached through the table.

## RLE

- `1028:0024`: reads a control byte with `1028:0125` and stops when it returns `0xFFFF` (end of chunk) or when a step pauses.
- `1028:0024`: bit 7 clear is a literal: the next `control & 0x7f` input bytes are copied (`1028:022e`).
- `1028:0024`: bit 7 set is a run: the next input byte is repeated `control & 0x7f` times (`1028:02b4`).
- `1028:0024`: a count of 0 outputs nothing in both forms. A zero run still consumes its value byte.
- `1028:0024`: the run value is not checked for end of input. A run control byte that is the last byte of the chunk repeats `0xFF` (the low byte of `0xFFFF`).
- `1028:022e`, `1028:02b4`: when the count is larger than what is left of the request, the whole literal or run goes to the near I/O buffer and the read pauses; the next read drains it. The caller sees the same byte stream cut at the requested size.
- `1028:022e`: a literal is read with `1028:00b8`, which ignores the chunk length. A literal longer than the bytes left in the chunk reads on into the following file bytes, and because the consumed counter has passed the chunk length, `1028:0125`'s equality test never stops the stream again. Only corrupt data can do this; in the harness (file ends with the chunk) `01 05 00 00 00 05 de ad` gives `de ad 00 00 00`, the zeros being untouched output memory. Ours stops at the end of the chunk instead.
- `1028:10cb`: the same RLE decoding for memory streams (flag `0x20` clear), working directly on the far source pointer. Only `1028:076c` creates memory streams, and nothing calls it.

## LZW

- `1028:0d44`: read init. Zeroes `0x3aa1` bytes of the far state, sets code width 9, max code `0x1ff`, first free code 257 (`0x101`), and suffix `i = i` for `i` < 256. Marks the next read as the first code.
- `1028:0d44`: state layout: prefix codes (u16) at `+0`, suffix bytes at `+0x2720`, decode stack at `+0x3720` growing upward. The decoder's scalar state (width, free code, previous code, first byte, bit position, input group) is in data segment globals at `1068:4044`..`1068:406a`, not per stream.
- `1028:0fc1`: input is read in groups of `width` bytes (8 codes per group). Codes are taken LSB first: bit 0 of a code is the lowest unread bit of the group. The mask table is at `1068:1dec`.
- `1028:0fc1`: a new group is read when the current one is used up, after a clear, or when the width grows. Reading a new group throws away whatever is left of the current one.
- `1028:0fc1`: a group of `k` bytes yields codes while the bit offset is below `8k - (width - 1)`, so only codes that fit entirely in the group are read. Exception: with `k = 1` (fewer bits than one code) one code is still taken, its high bits coming from the previous group's leftover bytes in `1068:4046`.
- `1028:0fc1`: returns -1 when a new group reads 0 bytes, i.e. at the end of the chunk.
- `1028:0fc1`: the width grows by one when the free code is above the max code: after entry 511 is added (free code 512) it goes to 10 bits, then 11 at 1024, 12 at 2048. At width 12 the max code is set to `0x1000`, so it never grows past 12. One entry is added per code, groups hold 8 codes, and a clear starts a new group, so growth always falls on a group boundary and skips nothing.
- `1028:0e04`: the first code is output as a byte without an end-of-input check. An empty LZW body outputs one `0xFF` (low byte of -1) and stops.
- `1028:0e04`: for each later code: if it is 256 (clear), prefix codes 0..255 are zeroed, the free code becomes 256, the clear flag makes the next read start a new 9-bit group, and the next code is read and decoded as a normal code, even if it is 256 again.
- `1028:0e04`: a code at or above the free code pushes the first byte of the previous string, then decodes the previous code instead. Codes above the free code (invalid) are treated the same way.
- `1028:0e04`: the string is built on the stack by following prefix links down to a code below 256, then output in reverse.
- `1028:0e04`: after the whole string is out, if the free code is below 4096, entry `free` gets prefix = previous code and suffix = first byte of the current string, and the free code goes up by one. At 4096 the table is full and stays unchanged until a clear.
- `1028:0e04`: the first code after a clear adds its entry at 256 with the previous code from before the clear. Entry 256 is never looked up as a string, so this is harmless.
- `1028:0e04`: when the request fills mid-string, the next byte goes to the I/O buffer (`1028:0331`), a resume flag is set, and the next read continues popping the stack.
- `1028:0e04`: the decode stack has `0x3ab3 - 0x3720 = 915` bytes before it runs past the state block. Valid streams can hold strings up to 3841 bytes, so a long string would overflow it. The deepest string in the corpus is 368 bytes (`SUZBEACH.SCR`), so the game never overflows.
- `1028:0e04`: corpus facts: 139 LZW chunks, 36 contain at least one clear, 41 fill the table to 4096.

## Map and archive

## Name hash

## File layer

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
