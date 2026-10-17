# Step 3: Resource Map, Name Hash, and Archive

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-decompression-findings-and-fix.md` (for `src/testing/corpus.ts`)

**Files:**

- Modify: `src/resource/types.ts`
- Modify: `src/resource/resource-map.ts`
- Create: `src/resource/resource-map.test.ts`
- Create: `src/resource/resource-map.data.test.ts`
- Create: `src/resource/resource-archive.data.test.ts`
- Modify (only if findings require): `src/resource/resource-archive.ts`, `src/io/fetch-resources.ts`
- Modify: `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)
- Modify: `docs/re/resources.md`, `docs/re/open-questions.md`

**Interfaces:**

- Consumes:
  - `src/testing/corpus.ts` (from step 2): `hasCorpus: boolean`, `readDataFile(name: string): ArrayBuffer` (reads `public/data/<name>`), `loadArchive(): ParsedArchive`, `walkChunks(payload: Uint8Array): Chunk[]` (throws on a broken chunk tree), `CHUNKED_TYPES: Set<string>` (`.ADS .BMP .PAL .SCR .TTM`).
  - Existing: `BinaryReader` in `src/io/binary-reader.ts` (`u8()`, `u16()`, `u32()`, `bytes(n)`, `fixedString(n)`, little endian); `indexArchive(map: MapFile, archive: ArrayBuffer): ParsedArchive` in `src/resource/resource-archive.ts` (reads each entry's 13-byte name and u32 size at `entry.offset`, in map order, so `archive.list[i]` belongs to `map.entries[i]`); `decodeAds(payload: Uint8Array): AdsResource` in `src/decode/ads-loader.ts` (`subResources: { slot: number; name: string }[]`).
  - Today's types (to be changed): `MapEntry { name: string; length: number; offset: number }` (`name` is always `''`; `length` is really the name hash); `MapFile { resFileName: string; entries: MapEntry[] }`.
- Produces:
  - `MapEntry { nameHash: number; offset: number }`.
  - `MapFile { hashPositions: number[]; resFileName: string; entries: MapEntry[] }`.
  - `parseMap(buf: ArrayBuffer): MapFile` (throws when the archive count is not 1).
  - `resourceNameHash(path: string, positions: readonly number[]): number` (unsigned 32-bit).

## Part A: Read the original

- [x] **Action 1: Read the map, lookup, and file layer**

Read the pseudo-C and, where unclear, the assembly of every in-scope `1018` function: `1008 1019 1204 1287 1398 1475 14cc 14e9 15d2 1637 16b7 1720 1771 18d2 1947 195a 1a42 1bc3 1caf 1cfc`. Write the answers in `docs/re/resources.md`, one claim per bullet, each starting with its address, in our own words.

`Map and archive` section:

- `1018:1771`: header layout; the per-archive record at `1068:3365` (`0x1c` bytes: which offsets hold the name, the archive index, the open file handle, a position, the far pointer to the entry table); why the entry table gets `count + 1` slots.
- `1018:1a42`: how a name is looked up (by hash? linear or binary search? across all archives?) and what happens on a miss.
- `1018:1019`: the order of attempts. It seems to try a loose file with that name first (`1000:0cff` looks like `fopen`) and use the archive only when that fails. Confirm. Then: what it seeks to, what it reads at the entry offset (13-byte name, u32 size), what name comparison it does (`1000:197e`) and what happens on a mismatch, the 10 open-file slots at `1068:3499` (18 bytes each), and the retry loop around the open (flags `1068:335e`, `1068:1ebd`, call to `1018:1008`).
- `1018:1bc3`, `1018:1caf`, `1018:1cfc`, `1018:1204`, `1018:18d2`, `1018:1008`, `1018:1947`: one claim each.

`Name hash` section (`1018:195a`): confirm or correct the algorithm in the overview, step by step, including signedness and the 13-byte copy.

`File layer` section (`1018:1287`, `1018:1398`, `1018:1475`, `1018:14e9`, `1018:14cc`, `1018:15d2`, `1018:1637`, `1018:16b7`, `1018:1720`):

- Are positions relative to the resource start or to the archive?
- Do reads stop at the end of the resource, or can they run into the next one?
- What does each return on error and at end of file?
- Several call `1008:13cd` (`platform_pumpInputMessage`) on every read: note it. It has no counterpart here.

Lookup semantics in our code: `archive.byName.get(name)` is an exact, case-sensitive match on the stored name. Write a finding that compares this with the original's lookup (uppercasing, path stripping, hash). If they differ in a way that matters only for names coming from TTM bytecode, add an open question for chunk 5 (Action 3).

- [x] **Action 2: Name the functions**

Add `names.json` entries for every function in Action 1 not named yet, and for the runtime library helpers they call: `1000:0cff`, `1000:0df7`, `1000:0a3e`, `1000:0ea1`, `1000:0f0b`, `1000:0f5a`, `1000:1041`, `1000:144d`, `1000:06fc`, `1000:197e`, `1000:19dc`, `1000:22e1` (subsystem `rtl`, names like `rtl_fopen`, `rtl_fread`, `rtl_fclose`, `rtl_fseek`, `rtl_ftell`, `rtl_fwrite`, `rtl_strcmp`, `rtl_strncpy`, `rtl_calloc`; check each against its code before naming, a few minutes each, skip any you can't tell). Suggested names for the `1018` functions: `resources_hashName` (`195a`), `resources_findMapEntry` (`1a42`), `resources_openFile` (`1019`), `resources_closeFile` (`1204`), `resources_fileSlotFor` (`1cfc`). Keep the file sorted, status `named`.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

Run: `scripts/re/ghidra-import.sh`
Expected: ends with `export written to .../re/out`.

- [x] **Action 3: Open questions, only if needed**

Add an entry to `docs/re/open-questions.md` (next free `OQ-` number, under a fitting section) for every behavior you could not settle, and for a lookup difference that chunk 5 must check. Format:

```markdown
### OQ-8: Resource lookup is case-sensitive in our code

- **Where:** `src/resource/resource-archive.ts`, callers of `archive.byName.get`
- **What it does:** exact match on the stored name; the original uppercases and strips the path first (`1018:195a`).
- **Old guess behind it:** every name in the data is already uppercase with no path.
- **Resolve in:** chunk 5 (TTM interpreter), by checking every resource name TTM bytecode loads
- **Status:** open
```

- [x] **Action 4: Commit the findings**

```bash
git add docs/re/resources.md docs/re/open-questions.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): resource map, name hash, and file layer findings"
```

## Part B: Pin and fix the map

- [x] **Action 5: Write the failing unit tests**

Create `src/resource/resource-map.test.ts`. Expected hashes were computed from the algorithm in the overview; `JOHNWALK.BMP` and `JOHNCAST.PAL` are also the values stored in the real `RESOURCE.MAP`.

```ts
import { describe, expect, it } from 'vitest';
import { parseMap, resourceNameHash } from './resource-map.js';

const POSITIONS = [0, 1, 5, 7];
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function mapBytes(archiveCount = 1): ArrayBuffer {
  const bytes = new Uint8Array(21 + 2 * 8);
  const view = new DataView(bytes.buffer);
  bytes.set(POSITIONS, 0);
  view.setUint16(4, archiveCount, true);
  bytes.set(ascii('RESOURCE.001'), 6);
  view.setUint16(19, 2, true);
  view.setUint32(21, 0x4a4f93ac, true);
  view.setUint32(25, 0, true);
  view.setUint32(29, 0x4a4ece7d, true);
  view.setUint32(33, 350, true);
  return bytes.buffer;
}

describe('parseMap', () => {
  // SCRANTIC 1018:1771
  it('reads hash positions, the archive name, and (name hash, offset) entries', () => {
    expect(parseMap(mapBytes())).toEqual({
      hashPositions: POSITIONS,
      resFileName: 'RESOURCE.001',
      entries: [
        { nameHash: 0x4a4f93ac, offset: 0 },
        { nameHash: 0x4a4ece7d, offset: 350 },
      ],
    });
  });

  it('refuses a map that lists more than one archive', () => {
    expect(() => parseMap(mapBytes(2))).toThrow(/2 archives/);
  });
});

describe('resourceNameHash', () => {
  // SCRANTIC 1018:195a
  it('matches the hashes stored in RESOURCE.MAP', () => {
    expect(resourceNameHash('JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
    expect(resourceNameHash('JOHNCAST.PAL', POSITIONS)).toBe(0x4a4ece7d);
    expect(resourceNameHash('ACTIVITY.ADS', POSITIONS)).toBe(0x4142dce8);
    expect(resourceNameHash('OCEAN00.SCR', POSITIONS)).toBe(0x4f43a846);
  });

  it('uppercases a to z first', () => {
    expect(resourceNameHash('johnwalk.bmp', POSITIONS)).toBe(0x4a4f93ac);
  });

  it('ignores everything up to the last backslash or colon', () => {
    expect(resourceNameHash('C:\\JC\\JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
    expect(resourceNameHash('A:JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
  });

  it('reads zero for positions past the end of a short name', () => {
    expect(resourceNameHash('A.B', POSITIONS)).toBe(0x412e1f1d);
  });
});
```

If your `Name hash` findings differ from the overview's algorithm, change the expected values to what the original computes and say why in the finding. The four real hashes cannot change: they are in the data file.

Run: `pnpm exec vitest run src/resource/resource-map.test.ts`
Expected: FAIL (`resourceNameHash` is not exported; `parseMap` returns the old shape).

- [x] **Action 6: Implement**

Replace `src/resource/types.ts` line 1 (`export interface MapEntry { name: string; length: number; offset: number; }`) with:

```ts
export interface MapEntry { nameHash: number; offset: number; }
```

Replace the whole of `src/resource/resource-map.ts` with:

```ts
import { BinaryReader } from '../io/binary-reader.js';
import type { MapEntry } from './types.js';

const NAME_FIELD = 13;
const PATH_SEPARATORS = new Set([0x5c, 0x3a]);

export interface MapFile {
  hashPositions: number[];
  resFileName: string;
  entries: MapEntry[];
}

export function parseMap(buf: ArrayBuffer): MapFile {
  const r = new BinaryReader(buf);
  const hashPositions = Array.from(r.bytes(4), (b) => (b << 24) >> 24);
  const archiveCount = r.u16();
  if (archiveCount !== 1) throw new Error(`RESOURCE.MAP lists ${archiveCount} archives, expected 1`);
  const resFileName = r.fixedString(NAME_FIELD);
  const count = r.u16();
  const entries: MapEntry[] = [];
  for (let i = 0; i < count; i++) entries.push({ nameHash: r.u32(), offset: r.u32() });
  return { hashPositions, resFileName, entries };
}

export function resourceNameHash(path: string, positions: readonly number[]): number {
  const chars = Array.from(path, (c) => {
    const code = c.charCodeAt(0);
    return code >= 0x61 && code <= 0x7a ? code ^ 0x20 : code;
  });
  let sum = 0;
  let xor = 0;
  let nameStart = 0;
  chars.forEach((code, i) => {
    const signed = (code << 24) >> 24;
    sum = ((sum + signed) << 16) >> 16;
    xor = ((xor ^ signed) << 16) >> 16;
    if (PATH_SEPARATORS.has(code)) {
      sum = 0;
      xor = 0;
      nameStart = i + 1;
    }
  });
  const name = chars.slice(nameStart, nameStart + NAME_FIELD);
  let hash = 0;
  for (const p of positions) hash = ((hash << 8) + (((name[p] ?? 0) << 24) >> 24)) >>> 0;
  return (hash + ((Math.imul(sum, xor) << 16) >> 16)) >>> 0;
}
```

The JS integer tricks mirror the original's widths: `<< 24 >> 24` is a signed byte, `<< 16 >> 16` a signed 16-bit value, `>>> 0` an unsigned 32-bit result. Adjust the code if your findings changed the algorithm.

Run: `pnpm exec vitest run src/resource/resource-map.test.ts`
Expected: all pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors. Nothing outside `src/resource/` reads `MapEntry.name`, `MapEntry.length`, or `MapFile` fields other than `entries[].offset` (checked with `rg -n "\.entries|MapEntry|resFileName" src`; re-run it to be sure).

- [x] **Action 7: Commit**

```bash
git add src/resource/types.ts src/resource/resource-map.ts src/resource/resource-map.test.ts
git commit -m "fix(resources): RESOURCE.MAP entries hold a name hash, not a length"
```

## Part C: Corpus tests for map and archive

- [ ] **Action 8: Write the map corpus test**

Create `src/resource/resource-map.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasCorpus, readDataFile } from '../testing/corpus.js';
import { parseMap, resourceNameHash } from './resource-map.js';

const ENTRIES_START = 21;
const ENTRY_SIZE = 8;

function storedName(archive: Uint8Array, offset: number): string {
  return String.fromCharCode(...archive.subarray(offset, offset + 13)).replace(/\0.*$/s, '');
}

describe.skipIf(!hasCorpus)('the real RESOURCE.MAP', () => {
  it('has one archive, 180 entries, and nothing after them', () => {
    // SCRANTIC 1018:1771
    const buf = readDataFile('RESOURCE.MAP');
    const map = parseMap(buf);
    expect(map.hashPositions).toEqual([0, 1, 5, 7]);
    expect(map.resFileName).toBe('RESOURCE.001');
    expect(map.entries).toHaveLength(180);
    expect(buf.byteLength).toBe(ENTRIES_START + ENTRY_SIZE * map.entries.length);
  });

  it('stores the hash of the name found at each entry offset', () => {
    // SCRANTIC 1018:195a 1018:1019
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    const archive = new Uint8Array(readDataFile('RESOURCE.001'));
    const wrong = map.entries
      .map(({ nameHash, offset }) => ({ name: storedName(archive, offset), nameHash }))
      .filter(({ name, nameHash }) => resourceNameHash(name, map.hashPositions) !== nameHash);
    expect(wrong).toEqual([]);
  });

  it('has no two entries with the same hash', () => {
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    expect(new Set(map.entries.map((entry) => entry.nameHash)).size).toBe(map.entries.length);
  });
});
```

Run: `pnpm exec vitest run src/resource/resource-map.data.test.ts`
Expected: 3 tests pass (Part B already fixed the parser). If the hash test fails, the TS hash differs from the original; fix `resourceNameHash` against your `Name hash` findings.

- [ ] **Action 9: Write the archive corpus test**

Create `src/resource/resource-archive.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { CHUNKED_TYPES, hasCorpus, loadArchive, readDataFile, walkChunks } from '../testing/corpus.js';
import { parseMap } from './resource-map.js';

const RESOURCE_HEADER_SIZE = 13 + 4;

describe.skipIf(!hasCorpus)('the real RESOURCE.001', () => {
  it('holds every resource back to back, from offset 0 to the end of the file', () => {
    // SCRANTIC 1018:1019
    const map = parseMap(readDataFile('RESOURCE.MAP'));
    const archive = loadArchive();
    const spans = map.entries
      .map((entry, i) => ({ start: entry.offset, end: entry.offset + RESOURCE_HEADER_SIZE + archive.list[i]!.payload.length }))
      .sort((a, b) => a.start - b.start);
    expect(spans[0]!.start).toBe(0);
    expect(spans.slice(1).filter((span, i) => span.start !== spans[i]!.end)).toEqual([]);
    expect(spans.at(-1)!.end).toBe(readDataFile('RESOURCE.001').byteLength);
  });

  it('has 180 resources of six types', () => {
    const counts: Record<string, number> = {};
    for (const resource of loadArchive().list) counts[resource.type] = (counts[resource.type] ?? 0) + 1;
    expect(counts).toEqual({ '.BMP': 117, '.TTM': 41, '.SCR': 10, '.ADS': 10, '.PAL': 1, '.VIN': 1 });
  });

  it('stores every chunked payload as one complete chunk tree', () => {
    const broken = loadArchive()
      .list.filter((resource) => CHUNKED_TYPES.has(resource.type))
      .flatMap((resource) => {
        try {
          walkChunks(resource.payload);
          return [];
        } catch (error) {
          return [`${resource.name}: ${(error as Error).message}`];
        }
      });
    expect(broken).toEqual([]);
  });

  it('finds every resource an ADS file asks for by its exact stored name', () => {
    // SCRANTIC 1048:0079 1018:1019
    const archive = loadArchive();
    const missing = archive.list
      .filter((resource) => resource.type === '.ADS')
      .flatMap((resource) => decodeAds(resource.payload).subResources.map((sub) => sub.name))
      .filter((name) => !archive.byName.has(name));
    expect(missing).toEqual([]);
  });
});
```

Run: `pnpm exec vitest run src/resource/resource-archive.data.test.ts`
Expected: 4 tests pass.

If your findings showed that the original reads or checks something `indexArchive` does not (for example it rejects an entry whose stored name doesn't match), decide with this rule: if the corpus never triggers the difference, write a finding saying so and leave the code; if it does, change `src/resource/resource-archive.ts` to the original's behavior and add a unit test citing the address.

- [ ] **Action 10: Commit**

```bash
git add src/resource/resource-map.data.test.ts src/resource/resource-archive.data.test.ts
git commit -m "test(resources): RESOURCE.MAP and RESOURCE.001 corpus checks"
```

## Part D: Side-by-side checklist

- [ ] **Action 11: Fill the checklist rows**

In `docs/re/resources.md` under `Side-by-side checklist`, add one row per in-scope `1018` function. Expected mapping, adjust to your findings:

| Original | Ours |
| --- | --- |
| `1018:1771` | `parseMap` in `src/resource/resource-map.ts` |
| `1018:195a` | `resourceNameHash` in `src/resource/resource-map.ts` |
| `1018:1a42` | `indexArchive` (`byName`) in `src/resource/resource-archive.ts` |
| `1018:1019` | `indexArchive` in `src/resource/resource-archive.ts`, `fetchData` in `src/io/fetch-resources.ts`; loose-file override is `none (the web build has no loose files next to the archive)` if confirmed |
| file layer (`1287 1398 1475 14e9 14cc 15d2 1637 16b7 1720`) | `none (we fetch both files whole and slice payloads in memory)` |
| slots and archive switching (`1008 1204 1947 18d2 1bc3 1caf 1cfc`) | `none (...)` with the reason from your finding |

Use real line numbers (`file:line`). Status `fixed` for `1018:1771` (the hash field), `match` or `open` for the rest per your findings.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [ ] **Action 12: Run every check**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

- [ ] **Action 13: Commit**

```bash
git add docs/re/resources.md docs/re/function-map.md scripts/re/names.json
git commit -m "docs(re): side-by-side checklist for the resource map and file layer"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
