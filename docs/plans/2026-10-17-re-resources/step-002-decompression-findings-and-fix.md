# Step 2: Decompression Findings and Fix

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-unicorn-original-decompressor.md`

**Files:**

- Create: `src/testing/corpus.ts`
- Create: `src/testing/corpus.test.ts`
- Create: `src/resource/uncompress.data.test.ts` (and its generated `src/resource/__snapshots__/uncompress.data.test.ts.snap`)
- Modify: `src/resource/uncompress.ts`
- Modify: `src/resource/uncompress.test.ts` (rewrite)
- Modify: `src/decode/scr.ts`, `src/decode/bmp.ts`, `src/decode/ttm-loader.ts`, `src/decode/ads-loader.ts` (compressed chunk reads only)
- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/resources.md`, `docs/re/open-questions.md`

**Interfaces:**

- Consumes:
  - `re/fixtures/decompressed/index.tsv` (header `resource	chunk	bodyOffset	method	size	produced	file`) and the `.bin` files next to it: the original's output per compressed chunk. `bodyOffset` is the offset of the chunk body (method byte) in `RawResource.payload`. Regenerate with `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py`.
  - `docs/re/resources.md` sections `Compressed stream` and `Emulated edge cases` (the original's output on handmade inputs). **That table wins over every expected value written in this file.**
  - Existing TS: `uncompress(method: number, input: Uint8Array, outSize: number): Uint8Array` in `src/resource/uncompress.ts`; `parseMap(buf: ArrayBuffer): MapFile` in `src/resource/resource-map.ts`; `indexArchive(map: MapFile, archive: ArrayBuffer): ParsedArchive` in `src/resource/resource-archive.ts`; `ParsedArchive { byName: Map<string, RawResource>; list: RawResource[] }`, `RawResource { name: string; type: string; payload: Uint8Array }` (`type` is like `.BMP`) in `src/resource/types.ts`.
- Produces:
  - `src/testing/corpus.ts`: `DATA_DIR: string`, `FIXTURES_DIR: string`, `hasCorpus: boolean`, `readDataFile(name: string): ArrayBuffer`, `loadArchive(): ParsedArchive`, `walkChunks(payload: Uint8Array): Chunk[]`, `Chunk { path: string; bodyOffset: number; size: number; container: boolean }`, `CHUNKED_TYPES: Set<string>`, `COMPRESSED_CHUNKS: Set<string>`. Step 3 uses these.
  - `unpackChunk(body: Uint8Array): Uint8Array` in `src/resource/uncompress.ts`: takes a compressed chunk body (u8 method, u32 size, data) and returns the decompressed bytes.
  - `uncompress` returns only the bytes it produced: a shorter array when the input ends early.

## Part A: Read the original

- [x] **Action 1: Read the stream and codec code**

Read the pseudo-C (`re/out/functions/<ssss>_<oooo>_*.c`) and, where unclear, the assembly (`.asm`) of every function in `1028:0000`..`1028:1797`. Answer these questions in `docs/re/resources.md`, one claim per bullet, each starting with its address. Our own words, no pasted code.

`Method table` section (`1028:0547`, `1028:09ca`, `1028:0875`, `1028:0615`, data at `1068:1dc2`):

- Confirm or correct the field meanings in the overview's method table.
- What does read mode do with method 0 (its read function pointer is 0)? With method 3 and up?
- Where does a read-mode stream keep its buffers (near vs far, sizes)?

`Compressed stream` section (add to what step 1 wrote):

- `1028:04f8`, `1028:03d0`, `1028:048e`: the stream slot table at `1068:3f66` (how many slots, record size, which record fields matter).
- `1028:0125`, `1028:00b8`, `1028:0185`: how input bytes are fetched. Does reading stop at the chunk length passed to open (record `+0xe`/`+0x10`), or only at file end?
- `1028:0331`, `1028:0951`, `1028:09ca`: how output is handed to the caller. A codec pauses when the request is full and resumes on the next read. What is the returned count?
- `1028:0a4b`, `1028:0b0a`, `1028:0b36`, `1028:0c92`: what each does (`1028:0c92` looks like a rewind to body + 5).

`RLE` section (`1028:0024`, `1028:022e`, `1028:02b4`, `1028:10cb`):

- Control byte rule for bit 7 clear and bit 7 set, and the count mask.
- A count of 0 in both forms.
- End of input, and a run or literal that is longer than the bytes still requested.
- What `1028:10cb` is for (the branch taken when the stream is not file-backed).

`LZW` section (`1028:0d44`, `1028:0e04`, `1028:0fc1`):

- Initial code width and maximum width; first free code after init.
- Bit order of codes in the input.
- When the width grows (which free-code value triggers it, and whether any input bits are skipped when it does).
- Clear code: which code, what is reset, the free code after a clear, and how many input bits are skipped (the `lzw clear` edge case shows what the original does with a 54-bit gap).
- Table size cap and what happens to new entries at the cap.
- A code equal to or above the next free code.
- The decode stack: where it lives and how big it is (the init zeroes `0x3aa1` bytes and the stack starts at state `+0x3720`). Can a long string overflow it?
- End of input.

Compress (write) side: `1028:0072`, `1028:0384`, `1028:11be`, `1028:1233`, `1028:13cf`, `1028:155d`, `1028:157c`, `1028:1654`, `1028:1698`, plus whatever else in the range only writes. Read enough to name them. You do not have to understand the encoders; Action 3 logs them.

- [x] **Action 2: Name every function in the range**

Add an entry to `scripts/re/names.json` for every function in `1028:0000`..`1028:1797` (status `named` for now; step 4 promotes to `verified`). Use `resources_` names that say what the function does, e.g. `resources_rleRead`, `resources_lzwInit`, `resources_lzwRead`, `resources_lzwReadCode`, `resources_streamGetByte`, `resources_streamPutByte`, `resources_selectStream`, `resources_allocStreamSlot`, `resources_freeStream`, `resources_initStreamMethod`, `resources_isReadMode`, `resources_rewindStream`. Change any suggested name that does not fit what you read. Keep the file sorted.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`. Needed so the export test (`scripts/re/export.data.test.ts`, "applies every names.json entry") sees the new names.

- [x] **Action 3: Log the compress side as one open question**

It is not a workaround, so it does not go under "Workarounds without a known root cause". Add a new section to `docs/re/open-questions.md`, above `## Resolved`:

```markdown
## Not reviewed on purpose

### OQ-7: Compression (write) side of the stream code

- **Where:** `1028:0072`, `1028:0384`, `1028:11be`, `1028:1233`, `1028:13cf`, `1028:155d`, `1028:157c`, `1028:1654`, `1028:1698` (list exactly the functions you found)
- **What it does:** RLE and LZW encoders and the write-mode stream paths.
- **Why not reviewed:** the engine only reads `RESOURCE.001`; nothing in the original's runtime writes compressed data that we need to reproduce.
- **Status:** open, by choice
```

If you found a call from game code (not from the stream code itself) into a write path, say so in the entry; that changes the reasoning.

- [x] **Action 4: Commit the findings**

```bash
git add docs/re/resources.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): decompression stream, RLE, and LZW findings"
```

## Part B: Corpus test helper

- [x] **Action 5: Write the failing helper test**

Create `src/testing/corpus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { walkChunks } from './corpus.js';

function chunk(tag: string, size: number, body: number[] = []): number[] {
  return [...Array.from(tag, (c) => c.charCodeAt(0)), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24, ...body];
}

describe('walkChunks', () => {
  it('walks nested containers and reports body offsets', () => {
    const inner = chunk('BIN:', 2, [7, 8]);
    const payload = new Uint8Array(chunk('BMP:', (0x80000000 | inner.length) >>> 0, inner));
    expect(walkChunks(payload)).toEqual([
      { path: 'BMP:', bodyOffset: 8, size: 10, container: true },
      { path: 'BMP:BIN:', bodyOffset: 16, size: 2, container: false },
    ]);
  });

  it('rejects a chunk that overruns its parent', () => {
    expect(() => walkChunks(new Uint8Array(chunk('BIN:', 16, [1, 2, 3])))).toThrow(/overruns/);
  });

  it('rejects stray bytes after the last chunk', () => {
    expect(() => walkChunks(new Uint8Array([...chunk('BIN:', 0), 1, 2]))).toThrow(/stray/);
  });
});
```

Run: `pnpm exec vitest run src/testing/corpus.test.ts`
Expected: FAIL, cannot resolve `./corpus.js`.

- [x] **Action 6: Implement the helper**

Create `src/testing/corpus.ts`. It mirrors `scripts/re/unicorn/corpus.py`; keep the two in step.

```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { indexArchive } from '../resource/resource-archive.js';
import { parseMap } from '../resource/resource-map.js';
import type { ParsedArchive } from '../resource/types.js';

export const DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url));
export const FIXTURES_DIR = fileURLToPath(new URL('../../re/fixtures/', import.meta.url));
export const hasCorpus = existsSync(DATA_DIR + 'RESOURCE.MAP') && existsSync(DATA_DIR + 'RESOURCE.001');

export const CHUNKED_TYPES = new Set(['.ADS', '.BMP', '.PAL', '.SCR', '.TTM']);
export const COMPRESSED_CHUNKS = new Set(['BMP:BIN:', 'BMP:VGA:', 'SCR:BIN:', 'ADS:SCR:', 'TT3:']);
const CONTAINER_FLAG = 0x80000000;
const SIZE_MASK = 0x7fffffff;

export interface Chunk {
  path: string;
  bodyOffset: number;
  size: number;
  container: boolean;
}

export function readDataFile(name: string): ArrayBuffer {
  return new Uint8Array(readFileSync(DATA_DIR + name)).buffer;
}

export function loadArchive(): ParsedArchive {
  return indexArchive(parseMap(readDataFile('RESOURCE.MAP')), readDataFile('RESOURCE.001'));
}

export function walkChunks(payload: Uint8Array, start = 0, end = payload.length, prefix = ''): Chunk[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const chunks: Chunk[] = [];
  let pos = start;
  while (pos < end) {
    if (pos + 8 > end) throw new Error(`${end - pos} stray bytes in ${prefix || 'top level'} at ${pos}`);
    const rawSize = view.getUint32(pos + 4, true);
    const chunk: Chunk = {
      path: prefix + String.fromCharCode(...payload.subarray(pos, pos + 4)),
      bodyOffset: pos + 8,
      size: rawSize & SIZE_MASK,
      container: (rawSize & CONTAINER_FLAG) !== 0,
    };
    if (chunk.bodyOffset + chunk.size > end) throw new Error(`${chunk.path} at ${pos} overruns its parent`);
    chunks.push(chunk);
    if (chunk.container) chunks.push(...walkChunks(payload, chunk.bodyOffset, chunk.bodyOffset + chunk.size, chunk.path));
    pos = chunk.bodyOffset + chunk.size;
  }
  return chunks;
}
```

Run: `pnpm exec vitest run src/testing/corpus.test.ts`
Expected: 3 tests pass.

- [x] **Action 7: Commit**

```bash
git add src/testing/corpus.ts src/testing/corpus.test.ts
git commit -m "test: corpus loader and chunk walker for data tests"
```

## Part C: Pin the behavior

- [x] **Action 8: Write the corpus comparison test**

Create `src/resource/uncompress.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNKED_TYPES, COMPRESSED_CHUNKS, FIXTURES_DIR, hasCorpus, loadArchive, walkChunks } from '../testing/corpus.js';
import { unpackChunk } from './uncompress.js';

const ORIGINAL_DIR = FIXTURES_DIR + 'decompressed/';
const hasOriginal = hasCorpus && existsSync(ORIGINAL_DIR + 'index.tsv');

function compressedChunks() {
  return loadArchive()
    .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
    .flatMap((resource) =>
      walkChunks(resource.payload)
        .filter((chunk) => COMPRESSED_CHUNKS.has(chunk.path))
        .map((chunk) => ({
          key: `${resource.name} ${chunk.path}`,
          body: resource.payload.subarray(chunk.bodyOffset, chunk.bodyOffset + chunk.size),
        })),
    );
}

function headerSize(body: Uint8Array): number {
  return new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1, true);
}

function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe.skipIf(!hasCorpus)('decompression over the whole corpus', () => {
  it('finds every compressed chunk', () => {
    expect(compressedChunks()).toHaveLength(180);
  });

  it('decompresses every chunk to the size in its header', () => {
    const wrong = compressedChunks()
      .map(({ key, body }) => ({ key, size: headerSize(body), got: unpackChunk(body).length }))
      .filter(({ size, got }) => size !== got);
    expect(wrong).toEqual([]);
  });

  it('keeps the decoded bytes of every chunk', () => {
    const hashes = Object.fromEntries(
      compressedChunks().map(({ key, body }) => [key, createHash('sha256').update(unpackChunk(body)).digest('hex')]),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasOriginal)('decompression matches the original SCRANTIC.SCR', () => {
  it('produces the same bytes as the original stream reader for every chunk', () => {
    // SCRANTIC 1028:0615 1028:0a0d
    const [, ...rows] = readFileSync(ORIGINAL_DIR + 'index.tsv', 'utf8').trimEnd().split('\n');
    const ours = new Map(compressedChunks().map(({ key, body }) => [key, unpackChunk(body)]));
    const mismatches = rows.flatMap((row) => {
      const [resource, chunk, , , , , file] = row.split('\t');
      const key = `${resource} ${chunk}`;
      const original = new Uint8Array(readFileSync(ORIGINAL_DIR + file));
      const mine = ours.get(key) ?? new Uint8Array();
      const at = firstDifference(mine, original);
      return at < 0 ? [] : [`${key}: first difference at byte ${at} (ours ${mine.length} bytes, original ${original.length})`];
    });
    expect(rows).toHaveLength(180);
    expect(mismatches).toEqual([]);
  });
});
```

This fails to compile until `unpackChunk` exists. Add the export now in `src/resource/uncompress.ts`, above `uncompress`:

```ts
export function unpackChunk(body: Uint8Array): Uint8Array {
  const size = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(1, true);
  return uncompress(body[0]!, body.subarray(5), size);
}
```

- [x] **Action 9: Run the original comparison only (no snapshot yet)**

Run: `pnpm exec vitest run src/resource/uncompress.data.test.ts -t "matches the original"`
Expected: either PASS, or FAIL listing mismatching chunks with the first differing byte. Write down the result. Do not run the snapshot test yet; a snapshot written now would freeze wrong output.

If the test is skipped, `re/fixtures/decompressed/index.tsv` is missing: run `re/.venv/bin/python -I scripts/re/unicorn/dump_decompressed.py` first.

- [x] **Action 10: Rewrite the unit tests from the findings**

Replace `src/resource/uncompress.test.ts`. Before running, compare every expected value with the `Emulated edge cases` table in `docs/re/resources.md`. **Where they differ, the table wins: change the test.** Then add one test per extra rule you wrote under `RLE` and `LZW` in Action 1 that these cases do not cover, each citing its address.

```ts
import { describe, expect, it } from 'vitest';
import { uncompress, unpackChunk } from './uncompress.js';

const RLE = 1;
const LZW = 2;

function chunkBody(method: number, size: number, data: ArrayLike<number>): Uint8Array {
  const body = new Uint8Array(5 + data.length);
  body[0] = method;
  new DataView(body.buffer).setUint32(1, size, true);
  body.set(data, 5);
  return body;
}

function packCodes(codes: Array<[code: number, bits: number]>): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let held = 0;
  for (const [code, bits] of codes) {
    acc |= code << held;
    held += bits;
    while (held >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      held -= 8;
    }
  }
  if (held > 0) bytes.push(acc & 0xff);
  return new Uint8Array(bytes);
}

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const decoded = (method: number, size: number, data: ArrayLike<number>) => Array.from(unpackChunk(chunkBody(method, size, data)));

describe('RLE (method 1)', () => {
  // SCRANTIC 1028:0024
  it('copies the next count bytes when bit 7 is clear', () => {
    expect(decoded(RLE, 3, [0x03, 1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('repeats the next byte count times when bit 7 is set', () => {
    expect(decoded(RLE, 3, [0x83, 0xaa])).toEqual([0xaa, 0xaa, 0xaa]);
  });

  it('a zero-length run still consumes its value byte', () => {
    expect(decoded(RLE, 2, [0x80, 0xff, 0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('a zero-length literal copies nothing', () => {
    expect(decoded(RLE, 2, [0x00, 0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('stops at the end of input with the bytes produced so far', () => {
    expect(decoded(RLE, 5, [0x02, 0xde, 0xad])).toEqual([0xde, 0xad]);
  });

  it('stops at the requested size inside a run', () => {
    expect(decoded(RLE, 2, [0x85, 0xaa])).toEqual([0xaa, 0xaa]);
  });
});

describe('LZW (method 2)', () => {
  // SCRANTIC 1028:0e04 1028:0fc1
  it('adds the previous string plus the first byte of the current one as the next code', () => {
    expect(decoded(LZW, 4, packCodes([[65, 9], [66, 9], [257, 9]]))).toEqual(ascii('ABAB'));
  });

  it('decodes a code that is not in the table yet as previous string plus its first byte', () => {
    expect(decoded(LZW, 3, packCodes([[65, 9], [257, 9]]))).toEqual(ascii('AAA'));
  });

  it('stops at the end of input with the bytes produced so far', () => {
    expect(decoded(LZW, 10, packCodes([[65, 9], [66, 9]]))).toEqual(ascii('AB'));
  });

  it('clear code skips to the next code group and restarts the table', () => {
    expect(decoded(LZW, 2, packCodes([[65, 9], [256, 9], [0, 54], [66, 9]]))).toEqual(ascii('AB'));
  });

  it('widens codes to 10 bits once entry 511 is added', () => {
    const codes: Array<[number, number]> = [[65, 9]];
    for (let code = 257; code < 512; code++) codes.push([code, 9]);
    codes.push([512, 10]);
    const out = unpackChunk(chunkBody(LZW, 33153, packCodes(codes)));
    expect(out.length).toBe(33153);
    expect(out.every((b) => b === 65)).toBe(true);
  });
});

describe('unpackChunk', () => {
  // SCRANTIC 1028:0615
  it('reads the method byte and the u32 uncompressed size from the chunk body', () => {
    expect(decoded(RLE, 3, [0x83, 0xaa])).toEqual([0xaa, 0xaa, 0xaa]);
  });

  // SCRANTIC 1028:0547
  it('rejects a method the original cannot open', () => {
    expect(() => uncompress(3, new Uint8Array([0]), 1)).toThrow(/method 3/);
  });
});
```

If your Action 1 reading says method 0 also cannot be read, add a matching `uncompress(0, ...)` throw test citing the address. If it says method 0 does something, pin that instead.

Run: `pnpm exec vitest run src/resource/uncompress.test.ts`
Expected: some tests fail. The early-end cases fail at least, because today `uncompress` always returns `outSize` bytes.

- [x] **Action 11: Record the failures, do not commit yet**

Write down which unit tests fail and which corpus chunks mismatch (Action 9). Each failure should map to a claim in your `RLE` or `LZW` findings. A failure with no matching finding means a finding is missing: go back to the code and add it. Do not commit: work is committed green, and Part D makes it green.

## Part D: Fix the code

- [x] **Action 12: Fix RLE**

Replace `uncompressRle` in `src/resource/uncompress.ts` with this version. Adjust it only where your `RLE` findings say otherwise.

```ts
function uncompressRle(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let inOff = 0;
  let outOff = 0;
  while (outOff < outSize && inOff < input.length) {
    const control = input[inOff++]!;
    const count = control & 0x7f;
    if (control & 0x80) {
      if (inOff === input.length) break;
      const value = input[inOff++]!;
      for (let i = 0; i < count && outOff < outSize; i++) out[outOff++] = value;
    } else {
      for (let i = 0; i < count && outOff < outSize && inOff < input.length; i++) out[outOff++] = input[inOff++]!;
    }
  }
  return out.subarray(0, outOff);
}
```

Run: `pnpm exec vitest run src/resource/uncompress.test.ts -t RLE`
Expected: all RLE tests pass.

- [x] **Action 13: Fix LZW**

Make three changes to `uncompressLzw`, then let the tests drive the rest.

1. Stop at end of input instead of reading zero bits past it. Count the bits read and replace the `getBits` definition with:

```ts
  let bitsRead = 0;
  const getBits = (n: number): number => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (curByte & (1 << nextBit)) x |= 1 << i;
      bitsRead++;
      nextBit++;
      if (nextBit > 7) {
        curByte = inOff < input.length ? input[inOff++]! : 0;
        nextBit = 0;
      }
    }
    return x;
  };
  const bitsLeft = () => input.length * 8 - bitsRead;
```

Before the first `getBits(nBits)` call: `if (bitsLeft() < nBits) return new Uint8Array(0);`. Replace `while (inOff <= input.length) {` with `while (bitsLeft() >= nBits) {`. A skip after a clear can run past the end; `bitsLeft()` then goes negative and the loop ends.

2. Return only what was produced. Change the final `return out;` to `return out.subarray(0, outOff);`, and change the early `if (outOff >= outSize) return out;` to `return out.subarray(0, outOff);` (the same value; it keeps both exits explicit).

3. Delete the comment `// LSB-first bit reader matching uncompress.c:54-74`. If bit order needs a comment at all after your findings, write one that cites `1028:0fc1`.

Run: `pnpm exec vitest run src/resource/uncompress.test.ts`
Expected: everything passes. If an LZW case fails, compare what the test expects (the original, via the edge-case table) with what the code does, find the rule in your `LZW` findings, and change the code. The rules most likely to differ: the free code after clear, the skip after clear (the `bitpos` arithmetic), the moment the width grows, and the table cap.

Run: `pnpm exec vitest run src/resource/uncompress.data.test.ts -t "matches the original"`
Expected: PASS. If some chunks still differ, take the first one, decode it with a temporary `console.log` around the first differing byte, and find which rule from your findings the code breaks. Real data hits paths the edge cases do not (table full at 4096, many clears, long strings). Add a unit test for each rule you fix this way, citing its address. Remove the temporary logging.

- [x] **Action 14: Throw with the method in the message**

Make sure the dispatch error message contains `method <n>` (the existing `unknown compression method ${method}` does). If your findings say method 0 is readable, implement it; otherwise make it throw the same way.

Run: `pnpm exec vitest run src/resource/`
Expected: all pass. The snapshot test writes `src/resource/__snapshots__/uncompress.data.test.ts.snap` (180 hashes) on this first run. That is safe now because the bytes match the original.

- [x] **Action 15: Commit the fix**

```bash
git add src/resource/uncompress.ts src/resource/uncompress.test.ts src/resource/uncompress.data.test.ts src/resource/__snapshots__/uncompress.data.test.ts.snap
git commit -m "fix(resources): RLE and LZW match the original byte for byte on the whole corpus"
```

## Part E: One chunk unpacker for every decoder

Each decoder repeats the same five lines: read the chunk size, subtract 5, read the method byte and the u32 size, slice the input, call `uncompress`. The original reads the same header inside its stream open (`1028:0615`). Replace those lines with `unpackChunk`. Change nothing else in the decoders; they belong to chunk 3.

- [x] **Action 16: Switch the decoders**

In `src/decode/scr.ts` replace

```ts
  r.expect('BIN:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const packed = uncompress(method, compInput, uncompSize);
```

with

```ts
  r.expect('BIN:');
  const packed = unpackChunk(r.bytes(r.u32()));
```

Do the same in `src/decode/bmp.ts` (identical block after `r.expect('BIN:');`).

In `src/decode/ttm-loader.ts` replace

```ts
  r.expect('TT3:');
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const bytecode = uncompress(method, compInput, uncompSize);
  r.pos += compSize;
```

with

```ts
  r.expect('TT3:');
  const bytecode = unpackChunk(r.bytes(r.u32()));
```

In `src/decode/ads-loader.ts` do the same for the block after `r.expect('SCR:');` (it also ends with `r.pos += compSize;`).

In all four files change `import { uncompress } from '../resource/uncompress.js';` to `import { unpackChunk } from '../resource/uncompress.js';`.

`r.bytes(n)` advances the reader by `n`, which equals the old `5 + compSize`, so the reads that follow stay aligned.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

- [x] **Action 17: Commit**

```bash
git add src/decode/scr.ts src/decode/bmp.ts src/decode/ttm-loader.ts src/decode/ads-loader.ts
git commit -m "refactor(decode): read compressed chunks through unpackChunk"
```

## Part F: Side-by-side checklist

- [x] **Action 18: Fill the checklist rows for the stream and codecs**

In `docs/re/resources.md` under `Side-by-side checklist`, add one row per function in `1028:0000`..`1028:1797`. `Ours` is the TS function and line (`src/resource/uncompress.ts:<line>` for `uncompressRle`, `uncompressLzw`, `unpackChunk`, `uncompress`), or `none (reason)`, e.g. `none (stream slots: we decode a whole chunk in one call)`. Status `fixed` where Part D changed behavior, `match` where it already agreed, `open` only with an `open-questions.md` entry (the compress side points at OQ-7).

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 19: Commit**

```bash
git add docs/re/resources.md docs/re/function-map.md scripts/re/names.json
git commit -m "docs(re): side-by-side checklist for the decompression stream"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
