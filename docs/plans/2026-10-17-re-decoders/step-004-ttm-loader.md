# Step 4: TTM Loader and Page Index

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-chunk-lookup.md` (steps 2 and 3 should be done first because they extend the same files, but this step uses none of their code)

**Files:**

- Modify: `scripts/re/unicorn/original_loaders.py`, `scripts/re/unicorn/dump_loaders.py`, `scripts/re/unicorn/test_original_loaders.py`
- Create: `src/decode/ttm-bytecode.ts`, `src/decode/ttm-bytecode.test.ts`
- Modify: `src/decode/ttm-loader.ts`, `src/decode/ttm-disasm.ts`
- Create: `src/decode/ttm-loader.test.ts`, `src/decode/ttm-loader.data.test.ts`
- Modify (test literals only): `src/ttm/interpreter.test.ts`
- Modify: `docs/re/decoders.md`, `docs/re/open-questions.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes:
  - `src/decode/chunks.ts`: `chunkBody(payload, path): Uint8Array | undefined`.
  - `src/testing/build-chunks.ts`: `ascii(text)`, `chunk(tag, body, container = false)`, `concat(...parts)`, `words(...values)`, `storedBody(data)`.
  - `src/testing/corpus.ts`: `hasCorpus`, `hasFixture(path)`, `loadArchive()`, `readFixtureRows(path)`.
  - `src/ttm/opcodes.ts`: `OP` (opcode name → value; `OP.UPDATE = 0x0ff0`, `OP.TAG = 0x1111`), `TTM_OPCODE_NAMES: Record<number, string>` (value → name).
  - Existing: `unpackChunk(body)` in `src/resource/uncompress.ts`.
  - Today: `decodeTtm(payload): TtmResource` with `TtmResource { version: string; numPages: number; bytecode: Uint8Array; tags: TtmTag[] }` and `TtmTag { id; description; offset }`, parsed in fixed order from `VER:`, `PAG:` (stores the chunk size, always 2, as `numPages`), `TT3:`, `TTI:`, `TAG:`. Consumers read only `.bytecode` (`src/ads/scheduler.ts`, `src/ttm/interpreter.ts`, `src/debug-main.ts`). `src/ttm/interpreter.test.ts` builds `TtmResource` literals at lines 30 and 48. `disasmTtm(bytecode, opcodeNames?)` in `src/decode/ttm-disasm.ts` (used by `src/debug-main.ts`).
  - Python, from earlier steps: `original_loaders.py` has `new_loader_emulator(image, payloads)`, `put_string(emu, text)`, `read_word(emu, segment, offset)`, imports `struct`, `dataclass`, `Emulator`, `NeImage`. `dump_loaders.py` has `write_tsv(name, header, rows)`, `chunked(resources, kind=None)`, `Resource`, `NeImage`, and the `COMMANDS` dict. `test_original_loaders.py` has `chunk`, `words`, `stored`, `BINARY`.
- Produces:
  - `src/decode/ttm-bytecode.ts`: `interface TtmInstruction { offset: number; opcode: number; args: number[]; text?: string; next: number }` (args are raw u16 words), `readTtmInstruction(bytecode: Uint8Array, offset: number): TtmInstruction` (throws on arg codes 8..14 and on an unterminated string).
  - `src/decode/ttm-loader.ts`: `interface TtmTag { id: number; page: number }`, `interface TtmResource { pageCount: number; bytecode: Uint8Array; pageOffsets: number[]; tags: TtmTag[] }`, `decodeTtm(payload: Uint8Array): TtmResource`.
  - Python: `load_ttm_original(image, name, payload, ttm_id=1) -> TtmIndex` (`status`, `page_count`, `page_offsets: list[int]`, `tags: list[tuple[int, int]]` of `(tag, page)`). Fixture `re/fixtures/loaders/ttm.tsv`.
  - An open question for chunk 5 about the interpreter's own framing and tag lookup.

## Part A: Read the original

- [x] **Action 1: Read the TTM loader**

Read `1050:0177`, `1048:0044`, `1050:04d6`, `1050:042a`, `1050:04a8`, `1050:013e`, `1050:03e2`, and the two RTL helpers `1050:042a` calls (`1000:121a`, probably `memset`; `1048:040f` uses `1000:11d0`, probably `memcpy`). Write under `TTM loader` in `docs/re/decoders.md`, one claim per bullet:

- `1050:0177`: opening by name or handle; `PAG:` body is a u16 page count, 330 (`0x14a`) when missing; `TT3:` decompressed whole (method argument `0xFFFF`, ignored in read mode); a short read frees the buffer and fails; the `0xd4`-byte record (fields from the overview) appended to the list at `1068:2634`, current record at `1068:2638`; the page table of `count + 1` far pointers; return value.
- No `VER:` or `TTI:TAG:` read anywhere (no such strings in the binary). The tag names in `TTI:TAG:` are only for the original's authoring tools, as far as this binary is concerned.
- `1048:0044`: load, store the id in record word `[0]`, run the page index. Its return value ignores the index result.
- `1050:03e2`: finds a TTM record by id and makes it current.
- `1050:04d6`: the page index, step by step: clearing the table, where page 0 starts, the end test (`offset >= length - 1`, the record holds a pointer to the last byte), what ends a page (`0x0FF0`, and the next page starts after it), the size rule per arg code (0..7 words; `0xF` string via `1050:04a8`, except `0xAF1F`/`0xAF2F`: count word plus `2 * count` words; 8..14 fail with `0xFFFF`), the `0x1111` tag records, the return values (1 all pages found, 0 bytecode ended first).
- `1050:042a`: the tag node (`0x3d` bytes, near; words `[0]` TTM id, `[1]` tag id, `[2]` and `[4]` page, `[5]` `0xFFFF`; next at byte `+0x3b`), appended at the tail of `1068:263c`.
- `1050:04a8`: string field length rounded up to even, counted from the start of the string.
- `1050:013e`: reads one word through a far pointer.

- [x] **Action 2: Name the functions**

Add `scripts/re/names.json` entries (sorted, status `named`). Suggested: `1050:0177` `ttm_loadTtm`, `1048:0044` `ttm_loadTtmWithId` (subsystem `ttm`; it lives in the ADS segment), `1050:04d6` `ttm_indexPages`, `1050:042a` `ttm_addTagRecord`, `1050:04a8` `ttm_skipStringArg`, `1050:013e` `ttm_readWord`, `1050:03e2` `ttm_selectTtm`, `1000:121a` `rtl_memset` and `1000:11d0` `rtl_memcpy` (subsystem `rtl`, only after checking their code for a few minutes).

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 3: Commit the findings**

```bash
git add docs/re/decoders.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): TTM loader and page index findings"
```

## Part B: Run the original loader

- [x] **Action 4: Write the failing Python tests**

Append to `scripts/re/unicorn/test_original_loaders.py`, before the `if __name__ == "__main__":` block, and add `TtmIndex, load_ttm_original` to its `from original_loaders import ...` line:

```python
TWO_PAGES = words(0x1111, 7, 0x0FF0, 0x2002, 1, 2, 0x0FF0)


def ttm(page_count: int | None, bytecode: bytes) -> bytes:
    pag = chunk("PAG:", words(page_count)) if page_count is not None else b""
    tti = chunk("TTI:", chunk("TAG:", words(1, 9) + b"x\0"), container=True)
    return chunk("VER:", b"4.09\0") + pag + chunk("TT3:", stored(bytecode)) + tti


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class TtmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def load(self, page_count: int | None, bytecode: bytes) -> TtmIndex:
        return load_ttm_original(self.image, "TEST.TTM", ttm(page_count, bytecode))

    def test_pages_end_at_0x0ff0_and_tags_record_their_page(self):
        self.assertEqual(self.load(2, TWO_PAGES), TtmIndex(1, 2, [0, 6], [(7, 0)]))

    def test_missing_page_count_means_330_and_indexing_stops_at_the_end(self):
        self.assertEqual(self.load(None, TWO_PAGES), TtmIndex(0, 330, [0, 6, 14], [(7, 0)]))

    def test_arg_codes_8_to_14_fail_the_index(self):
        self.assertEqual(self.load(1, words(0x0018, 0x0FF0)).status, 0xFFFF)

    def test_string_args_are_padded_to_even_length(self):
        bytecode = words(0xF01F) + b"AB\0\0" + words(0x0FF0) + words(0xF02F) + b"ABC\0" + words(0x0FF0)
        self.assertEqual(self.load(2, bytecode).page_offsets, [0, 8])

    def test_af1f_takes_a_count_and_that_many_word_pairs(self):
        self.assertEqual(self.load(2, words(0xAF1F, 2, 1, 2, 3, 4, 0x0FF0, 0x0FF0)).page_offsets, [0, 14])
```

The `TTI:TAG:` entry (id 9) is there to show the original ignores it: the only tag found is 7, from the bytecode.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: FAIL with `ImportError: cannot import name 'TtmIndex'`.

- [x] **Action 5: Add the loader to the harness**

Append to `scripts/re/unicorn/original_loaders.py`:

```python
LOAD_TTM = "1050:0177"
INDEX_TTM_PAGES = "1050:04d6"
TTM_GLOBALS = 0x2634
TTM_GLOBALS_SIZE = 12
CURRENT_TTM = 0x2638
TTM_TAG_LIST = 0x263C
TAG_NEXT = 0x3B


@dataclass
class TtmIndex:
    status: int
    page_count: int
    page_offsets: list[int]
    tags: list[tuple[int, int]]


def load_ttm_original(image: NeImage, name: str, payload: bytes, ttm_id: int = 1) -> TtmIndex:
    emu = new_loader_emulator(image, {name: payload})
    data = emu.data_segment
    emu.write(data, TTM_GLOBALS, bytes(TTM_GLOBALS_SIZE))
    loaded = emu.call_far(LOAD_TTM, stack_words=[put_string(emu, name)])["ax"]
    if loaded != 1:
        raise RuntimeError(f"{name}: TTM load returned {loaded:#x}")
    record_offset, record_segment = read_word(emu, data, CURRENT_TTM), read_word(emu, data, CURRENT_TTM + 2)
    emu.write(record_segment, record_offset, struct.pack("<H", ttm_id))
    status = emu.call_far(INDEX_TTM_PAGES, stack_words=[ttm_id])["ax"]

    def field(index: int) -> int:
        return read_word(emu, record_segment, record_offset + 2 * index)

    page_count = field(1)
    bytecode = field(3) * 16 + field(2)
    table_offset, table_segment = field(0x68), field(0x69)
    page_offsets = []
    for page in range(page_count):
        offset = read_word(emu, table_segment, table_offset + 4 * page)
        segment = read_word(emu, table_segment, table_offset + 4 * page + 2)
        if offset == 0 and segment == 0:
            break
        page_offsets.append(segment * 16 + offset - bytecode)
    tags = []
    node = read_word(emu, data, TTM_TAG_LIST)
    while node:
        tags.append((read_word(emu, data, node + 2), read_word(emu, data, node + 4)))
        node = read_word(emu, data, node + TAG_NEXT)
    return TtmIndex(status, page_count, page_offsets, tags)
```

This does what `1048:0044` does (load, store the id, index) but keeps the index's return value. The record field positions come from the overview; if Action 1 found others, change them.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: all pass. If the original disagrees with an expectation on purpose, it wins: change the expectation and write the finding. Harness errors (`UnstubbedImport`, unknown handle) mean a handler is missing or an argument index is off.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_loaders.py scripts/re/unicorn/test_original_loaders.py`
Expected: no output.

- [x] **Action 6: Dump the fixture**

In `scripts/re/unicorn/dump_loaders.py`, add `load_ttm_original` to the `from original_loaders import ...` line, add before `COMMANDS`:

```python
def dump_ttm(image: NeImage, resources: list[Resource]):
    rows = []
    for resource in chunked(resources, ".TTM"):
        index = load_ttm_original(image, resource.name, resource.payload)
        offsets = ",".join(map(str, index.page_offsets))
        tags = ",".join(f"{tag}@{page}" for tag, page in index.tags)
        rows.append([resource.name, index.status, index.page_count, offsets, tags])
    write_tsv("ttm.tsv", ["resource", "status", "pageCount", "pageOffsets", "tags"], rows)
```

and add `"ttm": dump_ttm,` to the `COMMANDS` dict.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_loaders.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py ttm`
Expected: `ttm.tsv: 41 rows`, every row with status `1`.

- [x] **Action 7: Commit**

```bash
git add scripts/re/unicorn/original_loaders.py scripts/re/unicorn/dump_loaders.py scripts/re/unicorn/test_original_loaders.py
git commit -m "feat(re): run the original TTM loader and page index on every TTM"
```

## Part C: Our TTM instruction reader

- [x] **Action 8: Write the failing tests**

Create `src/decode/ttm-bytecode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ascii, concat, words } from '../testing/build-chunks.js';
import { readTtmInstruction } from './ttm-bytecode.js';

describe('readTtmInstruction', () => {
  // SCRANTIC 1050:04d6
  it('reads as many word args as the low nibble says, up to 7', () => {
    expect(readTtmInstruction(words(0x2002, 1, 0xffff), 0)).toEqual({ offset: 0, opcode: 0x2002, args: [1, 0xffff], next: 6 });
    expect(readTtmInstruction(words(0, 0x0ff0), 2)).toEqual({ offset: 2, opcode: 0x0ff0, args: [], next: 4 });
  });

  // SCRANTIC 1050:04a8
  it('reads a string arg and pads its field to an even length', () => {
    expect(readTtmInstruction(concat(words(0xf01f), ascii('AB\0\0'), words(0)), 0)).toEqual({
      offset: 0,
      opcode: 0xf01f,
      args: [],
      text: 'AB',
      next: 6,
    });
    expect(readTtmInstruction(concat(words(0xf02f), ascii('ABC\0'), words(0)), 0)).toMatchObject({ text: 'ABC', next: 6 });
  });

  // SCRANTIC 1050:04d6
  it('reads a pair count and that many word pairs for 0xAF1F and 0xAF2F', () => {
    expect(readTtmInstruction(words(0xaf1f, 2, 1, 2, 3, 4, 0x0ff0), 0)).toMatchObject({ args: [2, 1, 2, 3, 4], next: 12 });
    expect(readTtmInstruction(words(0xaf2f, 0, 0x0ff0), 0)).toMatchObject({ args: [0], next: 4 });
  });

  // SCRANTIC 1050:04d6
  it('refuses arg codes 8 to 14', () => {
    expect(() => readTtmInstruction(words(0x0018), 0)).toThrow(/arg code 8/);
    expect(() => readTtmInstruction(words(0x001e), 0)).toThrow(/arg code 14/);
  });

  it('refuses a string that runs past the end', () => {
    expect(() => readTtmInstruction(concat(words(0xf01f), ascii('AB')), 0)).toThrow(/past the end/);
  });
});
```

Run: `pnpm exec vitest run src/decode/ttm-bytecode.test.ts`
Expected: FAIL (`./ttm-bytecode.js` does not exist).

- [x] **Action 9: Implement `src/decode/ttm-bytecode.ts`**

```ts
const MAX_WORD_ARGS = 7;
const STRING_ARG = 0x0f;
const WORD_PAIR_LIST_OPCODES = new Set([0xaf1f, 0xaf2f]);

export interface TtmInstruction {
  offset: number;
  opcode: number;
  args: number[];
  text?: string;
  next: number;
}

export function readTtmInstruction(bytecode: Uint8Array, offset: number): TtmInstruction {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const opcode = view.getUint16(offset, true);
  const argCode = opcode & 0x0f;
  let next = offset + 2;
  const readWords = (count: number): number[] => {
    const values = Array.from({ length: count }, (_, i) => view.getUint16(next + 2 * i, true));
    next += 2 * count;
    return values;
  };
  if (argCode <= MAX_WORD_ARGS) return { offset, opcode, args: readWords(argCode), next };
  const where = `TTM opcode 0x${opcode.toString(16).padStart(4, '0')} at ${offset}`;
  if (argCode !== STRING_ARG) throw new Error(`${where}: arg code ${argCode} is invalid`);
  if (WORD_PAIR_LIST_OPCODES.has(opcode)) {
    const [pairs] = readWords(1);
    return { offset, opcode, args: [pairs!, ...readWords(pairs! * 2)], next };
  }
  const end = bytecode.indexOf(0, next);
  if (end < 0) throw new Error(`${where}: string runs past the end`);
  const text = String.fromCharCode(...bytecode.subarray(next, end));
  const field = end + 1 - next;
  return { offset, opcode, args: [], text, next: next + field + (field & 1) };
}
```

Replace the whole of `src/decode/ttm-disasm.ts` with (same output format as before: signed args, quoted text):

```ts
import { readTtmInstruction } from './ttm-bytecode.js';

export function disasmTtm(bytecode: Uint8Array, opcodeNames?: Record<number, string>): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytecode.length; ) {
    const { opcode, args, text, next } = readTtmInstruction(bytecode, offset);
    let line = `${offset.toString(16).padStart(6, '0')}  ${opcode.toString(16).padStart(4, '0')} ${opcodeNames?.[opcode] ?? '???'}`;
    if (args.length) line += ` ${args.map((arg) => (arg << 16) >> 16).join(' ')}`;
    if (text !== undefined) line += ` "${text}"`;
    lines.push(line);
    offset = next;
  }
  return lines.join('\n');
}
```

Run: `pnpm exec vitest run src/decode/ttm-bytecode.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 10: Commit**

```bash
git add src/decode/ttm-bytecode.ts src/decode/ttm-bytecode.test.ts src/decode/ttm-disasm.ts
git commit -m "feat(decode): TTM instruction reader with the original framing rules"
```

## Part D: Our TTM loader

- [x] **Action 11: Write the failing tests**

Create `src/decode/ttm-loader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeTtm } from './ttm-loader.js';

const TWO_PAGES = words(0x1111, 7, 0x0ff0, 0x2002, 1, 2, 0x0ff0);

function ttmPayload(pageCount: number | null, bytecode: Uint8Array): Uint8Array {
  const pag = pageCount === null ? [] : [chunk('PAG:', words(pageCount))];
  const tti = chunk('TTI:', chunk('TAG:', concat(words(1, 9), ascii('x\0'))), true);
  return concat(chunk('VER:', ascii('4.09\0')), ...pag, chunk('TT3:', storedBody(bytecode)), tti);
}

describe('decodeTtm', () => {
  // SCRANTIC 1050:0177 1050:04d6 1050:042a
  it('indexes where each page starts and which page each bytecode tag is on', () => {
    expect(decodeTtm(ttmPayload(2, TWO_PAGES))).toEqual({
      pageCount: 2,
      bytecode: TWO_PAGES,
      pageOffsets: [0, 6],
      tags: [{ id: 7, page: 0 }],
    });
  });

  // SCRANTIC 1050:0177 1050:04d6
  it('uses 330 pages when PAG: is missing and stops indexing at the end of the bytecode', () => {
    expect(decodeTtm(ttmPayload(null, TWO_PAGES))).toMatchObject({ pageCount: 330, pageOffsets: [0, 6, 14] });
  });

  it('refuses a TTM without TT3:', () => {
    expect(() => decodeTtm(chunk('PAG:', words(1)))).toThrow(/TT3: missing/);
  });
});
```

Run: `pnpm exec vitest run src/decode/ttm-loader.test.ts`
Expected: FAIL (`pageCount` and `pageOffsets` are missing; `tags` holds the `TTI:TAG:` entry).

- [x] **Action 12: Implement**

Replace the whole of `src/decode/ttm-loader.ts` with:

```ts
import { unpackChunk } from '../resource/uncompress.js';
import { OP } from '../ttm/opcodes.js';
import { chunkBody } from './chunks.js';
import { readTtmInstruction } from './ttm-bytecode.js';

const DEFAULT_PAGE_COUNT = 330;

export interface TtmTag { id: number; page: number; }
export interface TtmResource {
  pageCount: number;
  bytecode: Uint8Array;
  pageOffsets: number[];
  tags: TtmTag[];
}

export function decodeTtm(payload: Uint8Array): TtmResource {
  const pag = chunkBody(payload, 'PAG:');
  const pageCount = pag ? new DataView(pag.buffer, pag.byteOffset, pag.byteLength).getUint16(0, true) : DEFAULT_PAGE_COUNT;
  const tt3 = chunkBody(payload, 'TT3:');
  if (!tt3) throw new Error('TT3: missing');
  const bytecode = unpackChunk(tt3);
  return { pageCount, bytecode, ...indexPages(bytecode, pageCount) };
}

function indexPages(bytecode: Uint8Array, pageCount: number): Pick<TtmResource, 'pageOffsets' | 'tags'> {
  const pageOffsets: number[] = [];
  const tags: TtmTag[] = [];
  let offset = 0;
  for (let page = 0; page < pageCount; page++) {
    pageOffsets.push(offset);
    for (;;) {
      if (offset >= bytecode.length - 1) return { pageOffsets, tags };
      const instruction = readTtmInstruction(bytecode, offset);
      offset = instruction.next;
      if (instruction.opcode === OP.UPDATE) break;
      if (instruction.opcode === OP.TAG) tags.push({ id: instruction.args[0]!, page });
    }
  }
  return { pageOffsets, tags };
}
```

In `src/ttm/interpreter.test.ts`, update the two literals:

- line 30: `t.slot.ttm = { version: 'x', numPages: 1, bytecode: makeBytecode(), tags: [{ id: 1, description: '', offset: 0 }] };` → `t.slot.ttm = { pageCount: 1, bytecode: makeBytecode(), pageOffsets: [0], tags: [{ id: 1, page: 0 }] };`
- line 48: `t.slot.ttm = { version: 'x', numPages: 1, bytecode: bc, tags: [] };` → `t.slot.ttm = { pageCount: 1, bytecode: bc, pageOffsets: [0], tags: [] };`

Run: `rg -n "numPages|description: ''|version: 'x'" src`
Expected: no matches.

Run: `pnpm exec vitest run src/decode/ttm-loader.test.ts src/ttm/interpreter.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [x] **Action 13: Write the TTM corpus tests**

Create `src/decode/ttm-loader.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { OP, TTM_OPCODE_NAMES } from '../ttm/opcodes.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { readTtmInstruction, type TtmInstruction } from './ttm-bytecode.js';
import { decodeTtm } from './ttm-loader.js';

const scripts = () => loadArchive().list.filter((resource) => resource.type === '.TTM');

function instructions(bytecode: Uint8Array): TtmInstruction[] {
  const list: TtmInstruction[] = [];
  for (let offset = 0; offset < bytecode.length; ) {
    const instruction = readTtmInstruction(bytecode, offset);
    list.push(instruction);
    offset = instruction.next;
  }
  return list;
}

const hex = (opcode: number) => `0x${opcode.toString(16).padStart(4, '0')}`;

describe.skipIf(!hasCorpus)('every TTM resource', () => {
  it('frames every script from its first byte exactly to its last', () => {
    // SCRANTIC 1050:04d6
    const wrong = scripts().flatMap(({ name, payload }) => {
      const { bytecode } = decodeTtm(payload);
      try {
        const end = instructions(bytecode).at(-1)?.next ?? 0;
        return end === bytecode.length ? [] : [`${name}: framing ends at ${end} of ${bytecode.length}`];
      } catch (error) {
        return [`${name}: ${(error as Error).message}`];
      }
    });
    expect(scripts()).toHaveLength(41);
    expect(wrong).toEqual([]);
  });

  it('finds every page PAG: announces, one per 0x0FF0', () => {
    // SCRANTIC 1050:0177 1050:04d6
    const wrong = scripts().flatMap(({ name, payload }) => {
      const ttm = decodeTtm(payload);
      const updates = instructions(ttm.bytecode).filter(({ opcode }) => opcode === OP.UPDATE).length;
      return ttm.pageOffsets.length === ttm.pageCount && updates === ttm.pageCount ? [] : [`${name}: PAG ${ttm.pageCount}, ${ttm.pageOffsets.length} pages, ${updates} updates`];
    });
    expect(wrong).toEqual([]);
  });

  it('uses only opcodes our TTM opcode table names', () => {
    const unnamed = new Set(scripts().flatMap(({ payload }) => instructions(decodeTtm(payload).bytecode).map(({ opcode }) => opcode)).filter((opcode) => !(opcode in TTM_OPCODE_NAMES)));
    expect([...unnamed].map(hex)).toEqual([]);
  });

  it('keeps its opcode counts', () => {
    const counts: Record<string, number> = {};
    for (const { payload } of scripts()) for (const { opcode } of instructions(decodeTtm(payload).bytecode)) counts[hex(opcode)] = (counts[hex(opcode)] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  it('keeps its page index', () => {
    const hashes = Object.fromEntries(
      scripts().map(({ name, payload }) => {
        const { pageCount, pageOffsets, tags } = decodeTtm(payload);
        return [name, createHash('sha256').update(JSON.stringify({ pageCount, pageOffsets, tags })).digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/ttm.tsv'))('TTM loading matches the original SCRANTIC.SCR', () => {
  it('builds the same page count, page offsets, and tags as the original loader', () => {
    // SCRANTIC 1050:0177 1050:04d6 1050:042a
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/ttm.tsv');
    const wrong = rows.flatMap(([name, status, pageCount, pageOffsets, tags]) => {
      const ttm = decodeTtm(archive.byName.get(name!)!.payload);
      const ours = [ttm.pageCount, ttm.pageOffsets.join(','), ttm.tags.map(({ id, page }) => `${id}@${page}`).join(',')].join(' ');
      const original = [pageCount, pageOffsets, tags ?? ''].join(' ');
      return status === '1' && ours === original ? [] : [`${name}: status ${status}; ours ${ours}; original ${original}`];
    });
    expect(rows).toHaveLength(41);
    expect(wrong).toEqual([]);
  });
});
```

`tags ?? ''`: `readFixtureRows` trims the file end, which drops an empty last column on the last row.

Run: `pnpm exec vitest run src/decode/ttm-loader.data.test.ts`
Expected: 6 tests pass; snapshots are written.

- [x] **Action 14: Commit**

```bash
git add src/decode/ttm-loader.ts src/decode/ttm-loader.test.ts src/decode/ttm-loader.data.test.ts src/decode/__snapshots__ src/ttm/interpreter.test.ts
git commit -m "fix(decode): TTM loader reads the PAG: count and indexes pages and tags like the original"
```

## Part E: Coverage, open question, checklist

- [x] **Action 15: Write the TTM opcode coverage table**

Under `TTM opcode coverage` in `docs/re/decoders.md`, add one row per opcode the data uses. Counts come from the snapshot written in Action 13 (`src/decode/__snapshots__/ttm-loader.data.test.ts.snap`, the `keeps its opcode counts` entry). The name comes from `src/ttm/opcodes.ts`. The handler column says how `src/ttm/interpreter.ts` treats it: find the `case OP.<NAME>:` lines with `rg -n "case OP\." src/ttm/interpreter.ts`; an opcode with no `case` is "no case (ignored)".

```markdown
| Opcode | Our name | Uses in the data | Our handler |
| --- | --- | --- | --- |
| `0x0080` | `DRAW_BACKGROUND` | 190 | `src/ttm/interpreter.ts:<line>` |
```

Below the table, one line: whether the meaning of each opcode is checked against the original is chunk 5's job; this table only proves the data needs nothing we lack a name for. List every "no case (ignored)" opcode in a sentence so chunk 5 sees the gaps.

- [x] **Action 16: Log the interpreter's framing for chunk 5**

Add to `docs/re/open-questions.md` under "Workarounds without a known root cause" (next free `OQ-` number):

```markdown
### OQ-<n>: TTM interpreter frames bytecode and finds tags on its own

- **Where:** `src/ttm/interpreter.ts` (`step`, `findTagOffset`, `findPreviousTagOffset`), `src/ads/scheduler.ts` (`findTtmTag`)
- **What it does:** re-reads instructions with its own framer (signed args, no `0xAF1F`/`0xAF2F` case, no arg code check) and finds a tag by scanning the bytecode for `0x1111 <id>` each time, starting right after it.
- **Old guess behind it:** a tag is a jump label inside the bytecode.
- **Original:** the loader indexes the bytecode once (`1050:04d6`): pages split after each `0x0FF0`, and each `0x1111` is recorded with the page it sits on (`1050:042a`). `decodeTtm` now returns `pageOffsets` and `tags` built the same way, and `readTtmInstruction` (`src/decode/ttm-bytecode.ts`) frames exactly like the original.
- **Resolve in:** chunk 5 (TTM interpreter): find how the original interpreter uses the page table and tag records, then switch `src/ttm/` and `findTtmTag` to `readTtmInstruction`, `pageOffsets`, and `tags`.
- **Status:** open
```

Use real line numbers in **Where** if you add them.

- [x] **Action 17: Fill the checklist rows**

In `docs/re/decoders.md` under `Side-by-side checklist`, add rows (real line numbers):

| Original | Ours | Status |
| --- | --- | --- |
| `1050:0177` `ttm_loadTtm` | `decodeTtm` in `src/decode/ttm-loader.ts` | fixed |
| `1048:0044` | `decodeTtm` (id lives in the scheduler's TTM slot table, `src/ads/scheduler.ts`) | match |
| `1050:04d6` `ttm_indexPages` | `indexPages` in `src/decode/ttm-loader.ts`, `readTtmInstruction` in `src/decode/ttm-bytecode.ts` | fixed |
| `1050:042a` `ttm_addTagRecord` | `indexPages` (`tags`) | fixed |
| `1050:04a8` `ttm_skipStringArg` | `readTtmInstruction` (string field) | match |
| `1050:013e` `ttm_readWord` | `readTtmInstruction` (`getUint16`) | match |
| `1050:03e2` `ttm_selectTtm` | none (each scheduler slot holds its decoded TTM directly) | match |

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 18: Run every check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): TTM opcode coverage, interpreter framing question, checklist"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
