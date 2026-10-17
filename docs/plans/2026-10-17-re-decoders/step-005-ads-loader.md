# Step 5: ADS Loader and Opcode Sizes

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-chunk-lookup.md` (steps 2 to 4 should be done first because they extend the same files, but this step uses none of their code)

**Files:**

- Modify: `scripts/re/unicorn/original_loaders.py`, `scripts/re/unicorn/dump_loaders.py`, `scripts/re/unicorn/test_original_loaders.py`
- Create: `src/decode/ads-bytecode.ts`, `src/decode/ads-bytecode.test.ts`
- Modify: `src/decode/ads-loader.ts`
- Create: `src/decode/ads-loader.test.ts`, `src/decode/ads-loader.data.test.ts`
- Modify: `docs/re/decoders.md`, `docs/re/open-questions.md`, `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- **Do not modify** `src/ads/opcodes.ts` or `src/ads/scheduler.ts`. The user decided the scheduler keeps its own table in this chunk; every difference goes to `docs/re/open-questions.md` for chunk 6.

**Interfaces:**

- Consumes:
  - `src/decode/chunks.ts`: `chunkBody(payload, path): Uint8Array | undefined`.
  - `src/testing/build-chunks.ts`: `ascii(text)`, `chunk(tag, body, container = false)`, `concat(...parts)`, `words(...values)`, `storedBody(data)`.
  - `src/testing/corpus.ts`: `hasCorpus`, `hasFixture(path)`, `loadArchive()`, `readFixtureRows(path)`.
  - `src/ads/opcodes.ts` (read only): `ADS` (name → opcode value, for example `END: 0xffff`, `ADD_SCENE: 0x2005`, `FADE_OUT: 0xf010`), `ADS_ARG_COUNTS: Record<number, number>` (the scheduler's own table).
  - Existing: `unpackChunk(body)` in `src/resource/uncompress.ts`.
  - Today: `decodeAds(payload): AdsResource` with `AdsResource { version: string; subResources: AdsSubResource[]; bytecode: Uint8Array; tags: AdsTag[] }`, `AdsSubResource { slot: number; name: string }`, `AdsTag { id: number; description: string }`, parsed in fixed order. Consumers: `src/ads/scheduler.ts` (`subResources`, `bytecode`), `src/main.ts`, `src/story/story.ts`, `src/debug-main.ts` (`subResources`, `tags`), `src/resource/resource-archive.data.test.ts` (`subResources`). Nothing reads `version`.
  - Python, from earlier steps: `original_loaders.py` imports `struct`, `dataclass`, `Emulator`, `NeImage`. `dump_loaders.py` has `write_tsv(name, header, rows)`, `Resource`, `NeImage`, and the `COMMANDS` dict. `test_original_loaders.py` has `BINARY`, imports `NeImage`, `unittest`.
- Produces:
  - `src/decode/ads-bytecode.ts`: `adsArgCount(opcode: number): number` (original table, 0 for anything outside it), `interface AdsSection { tag: number; offset: number }`, `indexAdsSections(bytecode: Uint8Array): AdsSection[]`.
  - `src/decode/ads-loader.ts`: `AdsResource { subResources: AdsSubResource[]; bytecode: Uint8Array; sections: AdsSection[]; tags: AdsTag[] }` (`version` removed, `sections` added; `tags` kept for the debug page only), `decodeAds(payload: Uint8Array): AdsResource`.
  - Python: `class AdsFraming(image)` with `arg_count(opcode) -> int`. Fixture `re/fixtures/loaders/ads-arg-counts.tsv`.
  - Open questions for chunk 6: the scheduler's framing table and section scan, the per-section scene lists, and ADS load failure.

## Part A: Read the original

- [ ] **Action 1: Read the ADS loader**

Read `1048:0079` (`ads_loadAds`), `1048:04fc`, `1048:040f`, `1048:0303` (its pseudo-C is incomplete: the jump table and handlers are in the assembly and in raw bytes), and the table at `1068:260a`. Dump the size table and the handler bytes from the code segment:

Run: `re/.venv/bin/python -I -c "import sys, struct; sys.path.insert(0, 'scripts/re/unicorn'); from ne_image import NeImage; code = NeImage.load('public/data/SCRANTIC.SCR').segments[9].data; print([hex(v) for v in struct.unpack_from('<35H', code, 0x383)]); print([hex(v) for v in struct.unpack_from('<35H', code, 0x383 + 0x46)]); print(code[0x354:0x383].hex(' '))"`
Expected: 35 opcodes (`0xf000` first, `0x4010` last), 35 handler offsets (`0x358`, `0x35e`, `0x364`, `0x36a`, `0x370`), and the handler bytes (`83 46 06 0a` = add 10 to the pointer argument, and so on).

Write under `ADS loader` in `docs/re/decoders.md`, one claim per bullet:

- `1048:0079`: the 10 slots at `1068:460c` and the `0x472`-byte record; `ADS:RES:` layout (u16 count; per entry u16 id and a NUL-terminated name); the name read byte by byte into a 20-byte stack buffer with no length check; each entry loads its TTM at once through `1048:0044` with that id, and one failure fails the whole ADS; the TTM list head saved into the record; `ADS:SCR:` decompressed whole, read count must equal the stream size; the record's bytecode start and end pointers; `1048:04fc(0)` at the end; cleanup through `1048:001b` on failure; return value.
- No `VER:` or `ADS:TAG:` read (no such strings in the binary). Our debug page shows `ADS:TAG:` names; nothing else uses them.
- `1048:0303`: the lookup in the code-segment table at `1048:0383`, the five handlers and the arg count each one means, the default of 0 args for any other word, the null result past the bytecode end (record word `[4]`).
- The table itself (from the dump), as a list `opcode: args`.
- `1048:04fc`: with a slot number, how it builds the section list: section 0 starts after the first word (its tag), every `0xFFFF` ends a section and the next one starts at the following word (its tag word, so later sections start 2 bytes earlier relative to their tag than section 0), the end test (`offset >= length - 1`), a trailing `0xFFFF` at the very end adds no section, the count in record word `[1]`, up to 80 starts with no bounds check, and the per-section scene lists from `1048:040f` in record words `[0x1e9 + i]`. With 0, what it restores.
- `1048:040f`: collects, per section, the distinct ids that `1048:0bf4` (chunk 6) returns for each instruction whose opcode is in `1068:260a` (`0x2000`, `0x2005`), into a zero-terminated near list.

- [ ] **Action 2: Name the functions**

Add `scripts/re/names.json` entries (sorted, status `named`; `1048:0079` exists). Suggested: `1048:0303` `ads_nextInstruction`, `1048:04fc` `ads_indexSections`, `1048:040f` `ads_sectionSceneIds`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 3: Commit the findings**

```bash
git add docs/re/decoders.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): ADS loader, size table, and section index findings"
```

## Part B: Run the original size table

- [ ] **Action 4: Write the failing Python tests**

Append to `scripts/re/unicorn/test_original_loaders.py`, before the `if __name__ == "__main__":` block, and add `AdsFraming` to its `from original_loaders import ...` line:

```python
@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class AdsFramingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.framing = AdsFraming(NeImage.load(BINARY))

    def test_opcodes_in_the_table(self):
        for opcode, args in {0x2005: 4, 0x2010: 3, 0x4000: 3, 0x1350: 2, 0xF010: 1, 0xF200: 1, 0x3020: 1, 0xF000: 0}.items():
            with self.subTest(opcode=hex(opcode)):
                self.assertEqual(self.framing.arg_count(opcode), args)

    def test_opcodes_outside_the_table_take_no_args(self):
        for opcode in (0x1520, 0x1510, 0x2014, 0xFFFF, 0x0001):
            with self.subTest(opcode=hex(opcode)):
                self.assertEqual(self.framing.arg_count(opcode), 0)
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: FAIL with `ImportError: cannot import name 'AdsFraming'`.

- [ ] **Action 5: Add the framing probe to the harness**

`1048:0303` reads the current slot from `1068:2608`, the slot's record from `1068:460c`, and the record's end pointer from word `[4]` (byte `+8`); it compares only offsets. The probe sets up one slot whose end is `0xFFFF`, writes the opcode word at a fixed far address, and reads how far the function moves the pointer. Append to `scripts/re/unicorn/original_loaders.py`:

```python
ADS_NEXT_INSTRUCTION = "1048:0303"
CURRENT_ADS_SLOT = 0x2608
ADS_SLOTS = 0x460C
ADS_RECORD_SIZE = 0x472
ADS_RECORD_END = 8
OPCODE_OFFSET = 0x100


class AdsFraming:
    def __init__(self, image: NeImage):
        self.emu = Emulator(image)
        record, _ = self.emu.alloc(ADS_RECORD_SIZE)
        self.emu.write(record, 0, bytes(ADS_RECORD_SIZE))
        self.emu.write(record, ADS_RECORD_END, struct.pack("<H", 0xFFFF))
        data = self.emu.data_segment
        self.emu.write(data, CURRENT_ADS_SLOT, struct.pack("<H", 0))
        self.emu.write(data, ADS_SLOTS, struct.pack("<HH", 0, record))
        self.code, _ = self.emu.alloc(OPCODE_OFFSET + 2)

    def arg_count(self, opcode: int) -> int:
        self.emu.write(self.code, OPCODE_OFFSET, struct.pack("<H", opcode))
        regs = self.emu.call_far(ADS_NEXT_INSTRUCTION, stack_words=[self.code, OPCODE_OFFSET])
        if regs["dx"] != self.code:
            raise RuntimeError(f"opcode {opcode:#06x}: next instruction in segment {regs['dx']:#x}, expected {self.code:#x}")
        return (regs["ax"] - OPCODE_OFFSET - 2) // 2
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_loaders.py' -v`
Expected: all pass. If `arg_count` raises for every opcode, the record or slot layout is off: read the first lines of `1048_0303_*.asm` again (`LES BX,[BX + 0x460c]`, `ES:[BX + 0x8]`).

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_loaders.py scripts/re/unicorn/test_original_loaders.py`
Expected: no output.

- [ ] **Action 6: Dump every opcode**

In `scripts/re/unicorn/dump_loaders.py`, add `AdsFraming` to the `from original_loaders import ...` line, add before `COMMANDS`:

```python
def dump_ads_arg_counts(image: NeImage, resources: list[Resource]):
    framing = AdsFraming(image)
    rows = [[f"{opcode:04x}", args] for opcode in range(0x10000) if (args := framing.arg_count(opcode))]
    write_tsv("ads-arg-counts.tsv", ["opcode", "args"], rows)
```

and add `"ads-arg-counts": dump_ads_arg_counts,` to the `COMMANDS` dict.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_loaders.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_loaders.py ads-arg-counts`
Expected: `ads-arg-counts.tsv: 34 rows` (the 35 table entries minus `0xf000`, which takes 0 args). It runs 65,536 emulated calls; give it a minute.

- [ ] **Action 7: Commit**

```bash
git add scripts/re/unicorn/original_loaders.py scripts/re/unicorn/dump_loaders.py scripts/re/unicorn/test_original_loaders.py
git commit -m "feat(re): probe the original ADS instruction size for every opcode"
```

## Part C: Our ADS framing and section index

- [ ] **Action 8: Write the failing tests**

Create `src/decode/ads-bytecode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { words } from '../testing/build-chunks.js';
import { adsArgCount, indexAdsSections } from './ads-bytecode.js';

describe('adsArgCount', () => {
  // SCRANTIC 1048:0303 1048:0383
  it('gives the arg count the original size table gives', () => {
    expect([0x2005, 0x2010, 0x4000, 0x1350, 0xf010, 0xf200, 0x3020, 0xf000].map(adsArgCount)).toEqual([4, 3, 3, 2, 1, 1, 1, 0]);
  });

  // SCRANTIC 1048:0303
  it('gives 0 for every opcode outside the table', () => {
    expect([0x1520, 0x1510, 0x2014, 0xffff, 0x0001].map(adsArgCount)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('indexAdsSections', () => {
  // SCRANTIC 1048:04fc
  it('splits the bytecode after each 0xFFFF and takes each section tag from its first word', () => {
    const bytecode = words(1, 0x2005, 1, 2, 0, 1, 0xffff, 5, 0x1510, 0xffff);
    expect(indexAdsSections(bytecode)).toEqual([
      { tag: 1, offset: 2 },
      { tag: 5, offset: 14 },
    ]);
  });

  // SCRANTIC 1048:04fc 1048:0303
  it('reads a 0xFFFF as an arg when the opcode before it takes one', () => {
    expect(indexAdsSections(words(1, 0xf010, 0xffff, 0x1510, 0xffff))).toEqual([{ tag: 1, offset: 2 }]);
  });

  // SCRANTIC 1048:04fc
  it('starts a section after a 0xFFFF only when bytecode is left', () => {
    expect(indexAdsSections(words(1, 0xffff, 2))).toEqual([
      { tag: 1, offset: 2 },
      { tag: 2, offset: 4 },
    ]);
    expect(indexAdsSections(words(1, 0xffff))).toEqual([{ tag: 1, offset: 2 }]);
  });
});
```

Section offsets follow the original: section 0's offset is after its tag word (2), every later section's offset is at its tag word. In the first test the second tag word is at byte 14.

Run: `pnpm exec vitest run src/decode/ads-bytecode.test.ts`
Expected: FAIL (`./ads-bytecode.js` does not exist).

- [ ] **Action 9: Implement `src/decode/ads-bytecode.ts`**

Fill `ARG_COUNTS` from the table you dumped in Action 1 (it must match `re/fixtures/loaders/ads-arg-counts.tsv`; Action 13 checks every opcode). The planning read gave:

```ts
const SECTION_END = 0xffff;
const ARG_COUNTS = new Map<number, number>([
  [0xf000, 0], [0xf010, 1], [0xf200, 1], [0xf210, 1],
  [0x1010, 2], [0x1020, 2], [0x1030, 2], [0x1040, 2], [0x1050, 2], [0x1060, 2], [0x1070, 2], [0x1080, 1],
  [0x1310, 2], [0x1320, 2], [0x1330, 2], [0x1340, 2], [0x1350, 2], [0x1360, 2], [0x1370, 2],
  [0x1380, 1], [0x1390, 1], [0x13a0, 1], [0x13a1, 1], [0x13b0, 1], [0x13b1, 1], [0x13c0, 1], [0x13c1, 1],
  [0x2000, 4], [0x2005, 4], [0x2010, 3], [0x2015, 3], [0x2020, 3],
  [0x3020, 1],
  [0x4000, 3], [0x4010, 3],
]);

export function adsArgCount(opcode: number): number {
  return ARG_COUNTS.get(opcode) ?? 0;
}

export interface AdsSection { tag: number; offset: number; }

export function indexAdsSections(bytecode: Uint8Array): AdsSection[] {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const word = (offset: number) => view.getUint16(offset, true);
  // The original stores section 0 after its tag word and every later section at its tag word.
  const sections: AdsSection[] = [{ tag: word(0), offset: 2 }];
  let offset = 2;
  while (offset < bytecode.length - 1) {
    const opcode = word(offset);
    offset += 2;
    if (opcode !== SECTION_END) offset += 2 * adsArgCount(opcode);
    else if (offset < bytecode.length - 1) sections.push({ tag: word(offset), offset });
  }
  return sections;
}
```

A later section's tag word is then read as an instruction with no args, which is what `1048:0303` does with a word outside its table.

Run: `pnpm exec vitest run src/decode/ads-bytecode.test.ts`
Expected: all pass.

- [ ] **Action 10: Commit**

```bash
git add src/decode/ads-bytecode.ts src/decode/ads-bytecode.test.ts
git commit -m "feat(decode): original ADS size table and section index"
```

## Part D: Our ADS loader

- [ ] **Action 11: Write the failing tests**

Create `src/decode/ads-loader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeAds } from './ads-loader.js';

const BYTECODE = words(1, 0x1510, 0xffff);

function adsPayload(): Uint8Array {
  const res = concat(words(2, 1), ascii('A.TTM\0'), words(3), ascii('BB.TTM\0'));
  const tag = concat(words(1, 1), ascii('first\0'));
  const ads = concat(chunk('RES:', res), chunk('SCR:', storedBody(BYTECODE)), chunk('TAG:', tag));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('ADS:', ads, true));
}

describe('decodeAds', () => {
  // SCRANTIC 1048:0079
  it('reads the id and name of every resource in ADS:RES:', () => {
    expect(decodeAds(adsPayload()).subResources).toEqual([
      { slot: 1, name: 'A.TTM' },
      { slot: 3, name: 'BB.TTM' },
    ]);
  });

  // SCRANTIC 1048:0079 1048:04fc
  it('unpacks ADS:SCR: and indexes its sections', () => {
    const ads = decodeAds(adsPayload());
    expect(ads.bytecode).toEqual(BYTECODE);
    expect(ads.sections).toEqual([{ tag: 1, offset: 2 }]);
  });

  it('keeps ADS:TAG: names for the debug page', () => {
    expect(decodeAds(adsPayload()).tags).toEqual([{ id: 1, description: 'first' }]);
  });

  it('refuses an ADS without ADS:RES: or ADS:SCR:', () => {
    expect(() => decodeAds(chunk('ADS:', chunk('RES:', words(0)), true))).toThrow(/missing/);
  });
});
```

Run: `pnpm exec vitest run src/decode/ads-loader.test.ts`
Expected: FAIL (the old parser expects 4 "unknown bytes" after `ADS:` and has no `sections`).

- [ ] **Action 12: Implement**

Replace the whole of `src/decode/ads-loader.ts` with:

```ts
import { unpackChunk } from '../resource/uncompress.js';
import { indexAdsSections, type AdsSection } from './ads-bytecode.js';
import { chunkBody } from './chunks.js';

export interface AdsSubResource { slot: number; name: string; }
export interface AdsTag { id: number; description: string; }
export interface AdsResource {
  subResources: AdsSubResource[];
  bytecode: Uint8Array;
  sections: AdsSection[];
  tags: AdsTag[];
}

export function decodeAds(payload: Uint8Array): AdsResource {
  const res = chunkBody(payload, 'ADS:RES:');
  const scr = chunkBody(payload, 'ADS:SCR:');
  if (!res || !scr) throw new Error('ADS:RES: or ADS:SCR: missing');
  const bytecode = unpackChunk(scr);
  const tagList = chunkBody(payload, 'ADS:TAG:');
  return {
    subResources: readIdNameList(res).map(({ id, name }) => ({ slot: id, name })),
    bytecode,
    sections: indexAdsSections(bytecode),
    tags: tagList ? readIdNameList(tagList).map(({ id, name }) => ({ id, description: name })) : [],
  };
}

function readIdNameList(body: Uint8Array): { id: number; name: string }[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const count = view.getUint16(0, true);
  const list: { id: number; name: string }[] = [];
  let offset = 2;
  for (let i = 0; i < count; i++) {
    const id = view.getUint16(offset, true);
    const end = body.indexOf(0, offset + 2);
    if (end < 0) throw new Error(`id/name list entry ${i} has no end`);
    list.push({ id, name: String.fromCharCode(...body.subarray(offset + 2, end)) });
    offset = end + 1;
  }
  return list;
}
```

`tags` comes from `ADS:TAG:`, which the original never reads. Only `src/debug-main.ts` shows it.

Run: `rg -n "\.version\b" src`
Expected: no matches.

Run: `pnpm exec vitest run src/decode/ads-loader.test.ts src/resource/resource-archive.data.test.ts src/ads/scheduler.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 13: Write the ADS corpus tests**

Create `src/decode/ads-loader.data.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ADS } from '../ads/opcodes.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { adsArgCount } from './ads-bytecode.js';
import { decodeAds } from './ads-loader.js';

const SECTION_END = 0xffff;
const ORIGINAL_SECTION_SLOTS = 80;
const NAMED_OPCODES = new Set<number>(Object.values(ADS));

const scripts = () => loadArchive().list.filter((resource) => resource.type === '.ADS');
const hex = (opcode: number) => `0x${opcode.toString(16).padStart(4, '0')}`;

function frame(bytecode: Uint8Array): { opcodes: number[]; end: number } {
  const view = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength);
  const opcodes: number[] = [];
  let offset = 2;
  let atSectionTag = false;
  while (offset < bytecode.length - 1) {
    const opcode = view.getUint16(offset, true);
    offset += 2;
    if (atSectionTag) {
      atSectionTag = false;
      continue;
    }
    opcodes.push(opcode);
    if (opcode === SECTION_END) atSectionTag = true;
    else offset += 2 * adsArgCount(opcode);
  }
  return { opcodes, end: offset };
}

describe.skipIf(!hasCorpus)('every ADS resource', () => {
  it('splits into one section per ADS:TAG: entry, with the same tags in the same order', () => {
    // SCRANTIC 1048:04fc
    const wrong = scripts().flatMap(({ name, payload }) => {
      const ads = decodeAds(payload);
      const ours = ads.sections.map(({ tag }) => tag).join(',');
      const listed = ads.tags.map(({ id }) => id).join(',');
      return ours === listed ? [] : [`${name}: sections ${ours}, ADS:TAG: ${listed}`];
    });
    expect(scripts()).toHaveLength(10);
    expect(wrong).toEqual([]);
  });

  it('ends with 0xFFFF and frames exactly to its last byte with the original size table', () => {
    // SCRANTIC 1048:0303 1048:04fc
    const wrong = scripts().flatMap(({ name, payload }) => {
      const { bytecode } = decodeAds(payload);
      const last = new DataView(bytecode.buffer, bytecode.byteOffset, bytecode.byteLength).getUint16(bytecode.length - 2, true);
      const { end } = frame(bytecode);
      return last === SECTION_END && end === bytecode.length ? [] : [`${name}: last word ${hex(last)}, framing ends at ${end} of ${bytecode.length}`];
    });
    expect(wrong).toEqual([]);
  });

  it('fits in the 80 section slots of the original record', () => {
    // SCRANTIC 1048:04fc
    const counts = scripts().map(({ payload }) => decodeAds(payload).sections.length);
    expect(Math.max(...counts)).toBeLessThanOrEqual(ORIGINAL_SECTION_SLOTS);
  });

  it('uses only opcodes our ADS opcode table names', () => {
    const unnamed = new Set(scripts().flatMap(({ payload }) => frame(decodeAds(payload).bytecode).opcodes).filter((opcode) => !NAMED_OPCODES.has(opcode)));
    expect([...unnamed].map(hex)).toEqual([]);
  });

  it('keeps its opcode counts', () => {
    const counts: Record<string, number> = {};
    for (const { payload } of scripts()) for (const opcode of frame(decodeAds(payload).bytecode).opcodes) counts[hex(opcode)] = (counts[hex(opcode)] ?? 0) + 1;
    expect(Object.fromEntries(Object.entries(counts).sort())).toMatchSnapshot();
  });

  it('keeps its sections and resources', () => {
    const hashes = Object.fromEntries(
      scripts().map(({ name, payload }) => {
        const { subResources, sections, bytecode } = decodeAds(payload);
        return [name, createHash('sha256').update(JSON.stringify({ subResources, sections })).update(bytecode).digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/ads-arg-counts.tsv'))('ADS framing matches the original SCRANTIC.SCR', () => {
  it('gives every one of the 65,536 opcode words the arg count the original gives', () => {
    // SCRANTIC 1048:0303
    const original = new Map(readFixtureRows('loaders/ads-arg-counts.tsv').map(([opcode, args]) => [parseInt(opcode!, 16), Number(args)]));
    const wrong: string[] = [];
    for (let opcode = 0; opcode <= 0xffff; opcode++) {
      const expected = original.get(opcode) ?? 0;
      if (adsArgCount(opcode) !== expected) wrong.push(`${hex(opcode)}: ours ${adsArgCount(opcode)}, original ${expected}`);
    }
    expect(original.size).toBe(34);
    expect(wrong).toEqual([]);
  });
});
```

`frame` skips the tag word at the start of every section; the original reads it as a word outside its table, which moves 2 bytes the same way.

Run: `pnpm exec vitest run src/decode/ads-loader.data.test.ts`
Expected: 7 tests pass; snapshots are written. If `uses only opcodes our ADS opcode table names` fails, do not add names to `src/ads/opcodes.ts`: list the opcodes as gaps in the coverage table (Action 15) and in the chunk 6 open question (Action 16), and change the test to expect exactly that list.

- [ ] **Action 14: Commit**

```bash
git add src/decode/ads-loader.ts src/decode/ads-loader.test.ts src/decode/ads-loader.data.test.ts src/decode/__snapshots__
git commit -m "fix(decode): ADS loader uses chunk lookup and the original section index"
```

## Part E: Coverage, open questions for chunk 6, checklist

- [ ] **Action 15: Write the ADS opcode coverage table**

Under `ADS opcode coverage` in `docs/re/decoders.md`, add one row per opcode the data uses (counts from the `keeps its opcode counts` entry in `src/decode/__snapshots__/ads-loader.data.test.ts.snap`), plus one row per table opcode where the scheduler's count differs even if the data never uses it:

```markdown
| Opcode | Our name | Uses in the data | Original args (`1048:0383`) | Scheduler args (`ADS_ARG_COUNTS`) | Scheduler handler |
| --- | --- | --- | --- | --- | --- |
| `0xf010` | `FADE_OUT` | 67 | 1 | 0 | `src/ads/scheduler.ts:<line>` |
```

- Our name: the key in `ADS` (`src/ads/opcodes.ts`), or "none".
- Scheduler args: `ADS_ARG_COUNTS[opcode]` in `src/ads/opcodes.ts`, or "not listed".
- Scheduler handler: `rg -n "ADS\.<NAME>" src/ads/scheduler.ts`; "no case" when nothing handles it.

Below the table, list in one sentence every opcode where the original and scheduler arg counts differ. Chunk 6 starts from that list.

- [ ] **Action 16: Log the scheduler differences for chunk 6**

The user asked that what this chunk leaves in the scheduler be noted for chunk 6. Add these entries to `docs/re/open-questions.md` under "Workarounds without a known root cause" (next free `OQ-` numbers), filling the `<...>` parts from Action 15:

```markdown
### OQ-<n>: ADS scheduler frames bytecode with its own size table

- **Where:** `src/ads/opcodes.ts` (`ADS_ARG_COUNTS`), `src/ads/scheduler.ts` (`scanBytecode`, `findAdsTag`, and every place that steps over args)
- **What it does:** steps over ADS instructions with a hand-made table that disagrees with the original's (`1048:0383`, read by `1048:0303`): `0xF010` takes 0 args in ours and 1 in the original (in the data it is always followed by `0xFFFF`, which the original reads as its arg, not as a section end); `0x1520` takes 5 in ours and 0 in the original (not in its table); <every other difference from the coverage table>. It also finds sections and tags with its own scan instead of the section index.
- **Old guess behind it:** arg counts worked out by hand from the data and from jc_reborn.
- **Original:** `adsArgCount` and `indexAdsSections` (`src/decode/ads-bytecode.ts`) follow `1048:0303` and `1048:04fc`, checked on all 65,536 opcode words and every ADS file. `decodeAds(...).sections` holds the section index. The `ADS opcode coverage` table in `docs/re/decoders.md` lists every opcode where ours and the original differ.
- **Resolve in:** chunk 6 (ADS scheduler): read how the original interpreter steps over `0xF010` and the other differing opcodes, switch the scheduler to `adsArgCount` and `sections`, then delete `ADS_ARG_COUNTS`.
- **Status:** open

### OQ-<n+1>: Per-section scene lists are not built at load time

- **Where:** `src/ads/scheduler.ts` (`scanBytecode`, `chunks`)
- **What it does:** builds its list of scenes per tag while scanning at scene start.
- **Old guess behind it:** jc_reborn's bookmarking scan.
- **Original:** `1048:040f` builds, per section at load time, the distinct scene ids from `0x2000`/`0x2005` instructions through `1048:0bf4`, stored at record words `[0x1e9 + i]`.
- **Resolve in:** chunk 6 (ADS scheduler), together with `1048:0bf4`.
- **Status:** open

### OQ-<n+2>: A missing TTM does not fail the ADS load

- **Where:** `src/ads/scheduler.ts` (`makeAdsState`, the `ADS sub-resource not found` warning)
- **What it does:** warns and leaves the slot empty when an `ADS:RES:` name is not in the archive.
- **Old guess behind it:** a missing resource should not stop the show.
- **Original:** `1048:0079` loads every listed TTM at once and fails the whole ADS (unloading everything through `1048:001b`) if one fails. The data never triggers it: every listed name exists (`src/resource/resource-archive.data.test.ts`).
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open
```

- [ ] **Action 17: Fill the checklist rows**

In `docs/re/decoders.md` under `Side-by-side checklist`, add rows (real line numbers):

| Original | Ours | Status |
| --- | --- | --- |
| `1048:0079` `ads_loadAds` | `decodeAds` in `src/decode/ads-loader.ts`; failing on a missing TTM: OQ-<n+2> | fixed |
| `1048:0303` `ads_nextInstruction` | `adsArgCount` in `src/decode/ads-bytecode.ts`; the scheduler still uses `ADS_ARG_COUNTS`: OQ-<n> | fixed |
| `1048:04fc` `ads_indexSections` | `indexAdsSections` in `src/decode/ads-bytecode.ts`; the scheduler still scans on its own: OQ-<n> | fixed |
| `1048:040f` `ads_sectionSceneIds` | none yet (scheduler state): OQ-<n+1> | open |

Leave `1048:040f` as `named`; the wrap-up step marks the others `verified`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 18: Run every check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/decoders.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): ADS opcode coverage, chunk 6 open questions, checklist"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
