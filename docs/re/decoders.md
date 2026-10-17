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

## Screen

## Pixels

## Bitmap

## Bitmap matrix

## TTM loader

## TTM opcode coverage

## ADS loader

## ADS opcode coverage

## Thunks

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
