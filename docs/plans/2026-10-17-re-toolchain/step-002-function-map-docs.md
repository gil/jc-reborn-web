# Step 2: Function Map Renderer and RE Docs

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ghidra-import-export.md` (needs `scripts/re/names.json` and the Vitest include for `scripts/**/*.test.ts`)

**Files:**

- Create: `scripts/re/function-map.mjs`
- Test: `scripts/re/function-map.test.ts`
- Create: `docs/re/function-map.md` (generated)
- Create: `docs/re/README.md`
- Create: `docs/re/open-questions.md`

**Interfaces:**

- Consumes:
  - `scripts/re/names.json` in the overview's schema.
  - Optional `re/out/index.tsv` (header row + one row per function). Used only for the total function count.
- Produces:
  - `node scripts/re/function-map.mjs`: validates `names.json`, exits 1 with one error per line if invalid, otherwise writes `docs/re/function-map.md`.
  - Exports from `scripts/re/function-map.mjs`:
    - `SUBSYSTEMS: string[]`, `STATUSES: string[]`, `CALLING_CONVENTIONS: string[]`
    - `validateNames(names: { functions: Record<string, Entry> }): string[]` (empty when valid)
    - `renderFunctionMap(names, totalFunctions: number | null): string`
    - `readTotalFunctions(indexPath: string): number | null`
    - `NAMES_PATH`, `MAP_PATH`, `INDEX_PATH`: absolute paths

- [ ] **Action 1: Write the failing tests**

Create `scripts/re/function-map.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INDEX_PATH,
  MAP_PATH,
  NAMES_PATH,
  readTotalFunctions,
  renderFunctionMap,
  validateNames,
} from './function-map.mjs';

const entry = (overrides: Record<string, unknown> = {}) => ({
  name: 'rtl_lxmul',
  subsystem: 'rtl',
  status: 'named',
  note: 'multiply',
  signature: null,
  callingConvention: null,
  ...overrides,
});

const realNames = () => JSON.parse(readFileSync(NAMES_PATH, 'utf8'));

describe('validateNames', () => {
  it('accepts the committed names.json', () => {
    expect(validateNames(realNames())).toEqual([]);
  });

  it.each([
    ['address format', { '1000:302': entry() }, 'address'],
    ['name format', { '1000:0302': entry({ name: 'LXMUL' }) }, 'name must match'],
    ['name prefix', { '1000:0302': entry({ name: 'gfx_lxmul' }) }, 'prefix'],
    ['subsystem', { '1000:0302': entry({ subsystem: 'math', name: 'math_lxmul' }) }, 'unknown subsystem'],
    ['status', { '1000:0302': entry({ status: 'unknown' }) }, 'status'],
    ['note', { '1000:0302': entry({ note: ' ' }) }, 'note'],
    ['calling convention', { '1000:0302': entry({ callingConvention: '__pascal' }) }, 'calling convention'],
    ['signature type', { '1000:0302': entry({ signature: 42 }) }, 'signature'],
  ])('rejects a bad %s', (_label, functions, message) => {
    expect(validateNames({ functions }).join('\n')).toContain(message);
  });

  it('rejects duplicate names', () => {
    const functions = { '1000:0302': entry(), '1000:0488': entry() };
    expect(validateNames({ functions }).join('\n')).toContain('already used');
  });

  it('rejects entries out of address order', () => {
    const functions = { '1008:0000': entry({ name: 'rtl_b' }), '1000:0302': entry({ name: 'rtl_a' }) };
    expect(validateNames({ functions }).join('\n')).toContain('sorted');
  });
});

describe('renderFunctionMap', () => {
  const names = {
    functions: {
      '1000:0302': entry(),
      '1008:143c': entry({ name: 'decoders_loadPalette', subsystem: 'decoders', status: 'verified', note: 'a | b' }),
    },
  };

  it('groups entries by subsystem in pipeline order', () => {
    const map = renderFunctionMap(names, 590);
    expect(map.indexOf('## rtl')).toBeLessThan(map.indexOf('## decoders'));
    expect(map).not.toContain('## gfx');
  });

  it('reports verified, named, and unknown counts', () => {
    expect(renderFunctionMap(names, 590)).toContain('Functions found by Ghidra: 590. Verified: 1. Named: 1. Unknown: 588.');
  });

  it('works without a Ghidra export', () => {
    expect(renderFunctionMap(names, null)).toContain('Verified: 1. Named: 1.');
  });

  it('escapes pipes in notes', () => {
    expect(renderFunctionMap(names, null)).toContain('a \\| b');
  });

  it('matches the committed docs/re/function-map.md', () => {
    const expected = renderFunctionMap(realNames(), readTotalFunctions(INDEX_PATH));
    expect(readFileSync(MAP_PATH, 'utf8')).toBe(expected);
  });
});
```

- [ ] **Action 2: Run the tests, confirm they fail**

Run: `pnpm exec vitest run scripts/re/function-map.test.ts`
Expected: FAIL, cannot resolve `./function-map.mjs`.

- [ ] **Action 3: Write `scripts/re/function-map.mjs`**

```js
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SUBSYSTEMS = ['rtl', 'platform', 'resources', 'decoders', 'gfx', 'ttm', 'ads', 'story', 'walk', 'audio'];
export const STATUSES = ['named', 'verified'];
export const CALLING_CONVENTIONS = [
  '__cdecl16far',
  '__cdecl16near',
  '__stdcall16far',
  '__stdcall16near',
  '__regcall',
  '__thiscall',
];

export const NAMES_PATH = fileURLToPath(new URL('./names.json', import.meta.url));
export const MAP_PATH = fileURLToPath(new URL('../../docs/re/function-map.md', import.meta.url));
export const INDEX_PATH = fileURLToPath(new URL('../../re/out/index.tsv', import.meta.url));

const ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{4}$/;
const NAME = /^[a-z]+_[A-Za-z0-9]+$/;

export function validateNames(names) {
  const errors = [];
  const addresses = Object.keys(names.functions);
  if (addresses.join() !== [...addresses].sort().join()) errors.push('functions are not sorted by address');
  const usedAt = new Map();
  for (const [address, entry] of Object.entries(names.functions)) {
    if (!ADDRESS.test(address)) errors.push(`${address}: address must look like 1008:04a2`);
    if (!NAME.test(entry.name ?? '')) {
      errors.push(`${address}: name must match <subsystem>_<lowerCamelCase>`);
    } else if (!entry.name.startsWith(`${entry.subsystem}_`)) {
      errors.push(`${address}: name prefix must be the subsystem "${entry.subsystem}"`);
    }
    if (!SUBSYSTEMS.includes(entry.subsystem)) errors.push(`${address}: unknown subsystem "${entry.subsystem}"`);
    if (!STATUSES.includes(entry.status)) errors.push(`${address}: status must be one of ${STATUSES.join(', ')}`);
    if (typeof entry.note !== 'string' || entry.note.trim() === '') errors.push(`${address}: note is required`);
    if (entry.signature != null && typeof entry.signature !== 'string') {
      errors.push(`${address}: signature must be a string or null`);
    }
    if (entry.callingConvention != null && !CALLING_CONVENTIONS.includes(entry.callingConvention)) {
      errors.push(`${address}: unknown calling convention "${entry.callingConvention}"`);
    }
    if (usedAt.has(entry.name)) errors.push(`${address}: name "${entry.name}" already used at ${usedAt.get(entry.name)}`);
    usedAt.set(entry.name, address);
  }
  return errors;
}

export function renderFunctionMap(names, totalFunctions) {
  const entries = Object.entries(names.functions);
  const count = (status) => entries.filter(([, e]) => e.status === status).length;
  const totals =
    totalFunctions == null
      ? `Verified: ${count('verified')}. Named: ${count('named')}. Run \`scripts/re/ghidra-import.sh\` for the unknown count.`
      : `Functions found by Ghidra: ${totalFunctions}. Verified: ${count('verified')}. Named: ${count('named')}. Unknown: ${totalFunctions - entries.length}.`;
  const lines = [
    '# SCRANTIC.SCR Function Map',
    '',
    'Generated by `node scripts/re/function-map.mjs` from `scripts/re/names.json`. Do not edit by hand.',
    '',
    totals,
  ];
  for (const subsystem of SUBSYSTEMS) {
    const rows = entries.filter(([, e]) => e.subsystem === subsystem);
    if (rows.length === 0) continue;
    lines.push('', `## ${subsystem}`, '', '| Address | Name | Status | Note |', '| --- | --- | --- | --- |');
    for (const [address, e] of rows) {
      lines.push(`| \`${address}\` | \`${e.name}\` | ${e.status} | ${e.note.replaceAll('|', '\\|')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function readTotalFunctions(indexPath) {
  if (!existsSync(indexPath)) return null;
  return readFileSync(indexPath, 'utf8').trimEnd().split('\n').length - 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = JSON.parse(readFileSync(NAMES_PATH, 'utf8'));
  const errors = validateNames(names);
  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  writeFileSync(MAP_PATH, renderFunctionMap(names, readTotalFunctions(INDEX_PATH)));
  console.log(`wrote ${MAP_PATH}`);
}
```

- [ ] **Action 4: Generate the map**

Run: `mkdir -p docs/re`
Run: `node scripts/re/function-map.mjs`
Expected: `wrote .../docs/re/function-map.md`. The file has one `## rtl` section with the five runtime library entries. If `re/out/index.tsv` exists, the header line shows the unknown count.

- [ ] **Action 5: Run the tests, confirm they pass**

Run: `pnpm exec vitest run scripts/re/function-map.test.ts`
Expected: all tests pass.

- [ ] **Action 6: Commit**

```bash
git add scripts/re/function-map.mjs scripts/re/function-map.test.ts docs/re/function-map.md
git commit -m "feat(re): names.json validator and function map renderer"
```

- [ ] **Action 7: Write `docs/re/README.md`**

```markdown
# Reverse Engineering SCRANTIC.SCR

We decompile the original `SCRANTIC.SCR` (16-bit Windows 3.x NE, Borland C++ 1991) and use it to validate and fix the engine.

## Trust order

1. Decompiled `SCRANTIC.SCR` logic and byte-level facts from the data files.
2. Findings in this folder, each tied to an address.
3. Everything else: code comments in `src/`, `docs/Plan.md`, `~/dev/jc_reborn`, other ports. **Guidance only. May be wrong.**

When code or comments contradict level 1, fix the code and comments.

## Rebuild the decompile

Needs `public/data/SCRANTIC.SCR` and `$GHIDRA_INSTALL_DIR` (Ghidra 12.1.4, decompiler built with `buildNatives`).

    scripts/re/ghidra-import.sh

Output goes to `re/` (gitignored). Never commit anything under `re/`. It is derived from a copyrighted binary.

| File | Contents |
| --- | --- |
| `re/out/functions/<ssss>_<oooo>_<name>.c` / `.asm` | Pseudo-C and assembly per function |
| `re/out/index.tsv` | Every function: address, name, size, calling convention, signature, callers, callees |
| `re/out/strings.tsv` | Printable runs in the data segment, with instructions whose operand equals the string offset |
| `re/out/imports.tsv` | Windows imports and the functions that call them |
| `re/out/relocations.tsv` | NE relocation records |

Ghidra makes almost no string references in this binary. Use `strings.tsv` `scalarHits` to find who uses a string.

## Addresses

`ssss:oooo` in lowercase hex, as Ghidra prints them. NE segment `n` (1-based) is selector `0x1000 + (n - 1) * 8`: `Code1` = `1000`, `Code2` = `1008`, ..., `Data14` = `1068` (auto data segment).

## Naming

Names live in `scripts/re/names.json`. Ghidra state is rebuilt from it on every import, so nothing lives only in Ghidra. After editing, run:

    node scripts/re/function-map.mjs
    scripts/re/ghidra-import.sh

Rules: `<subsystem>_<lowerCamelCase>`. Subsystems: `rtl`, `platform`, `resources`, `decoders`, `gfx`, `ttm`, `ads`, `story`, `walk`, `audio`. Notes are one line in our words. Never paste decompiled code into committed files.

Status: `named` = we know roughly what it does. `verified` = fully read, findings written, our TS checked against it. Not in `names.json` = unknown.

## Findings and tests

- `function-map.md`: generated, do not edit.
- `<subsystem>.md`: findings per subsystem. One claim per address. Includes the side-by-side checklist: original function ↔ our `file:line`, status `match` / `fixed` / `open`.
- `open-questions.md`: unresolved behavior and workarounds kept without a root cause.

Tests that pin original behavior cite the address: `// SCRANTIC 1008:04a2`.

## Emulating single functions

`scripts/re/unicorn/` runs one original function in Unicorn (x86 real mode) with stubbed Windows imports. Setup and usage are in `scripts/re/unicorn/README.md`.
```

The last section points at a file step 3 creates. That's expected if step 3 hasn't run yet.

- [ ] **Action 8: Find all workaround sites**

Run: `rg -n -i "sweep|leak|orphan|watchdog|grace|workaround|hack|force" src --glob '!*.test.ts'`
Run: `git log --oneline --grep '^fix'`

Known sites as of 2026-10-17:
- `src/story/story.ts:332`: watchdog force-ends a scene after 8000 playing ticks.
- `src/ads/scheduler.ts:401`: pre-tick sweep frees threads whose TTM slot is nil or unloaded.
- `src/ads/scheduler.ts:45-49` and `:479-483`: `STOP_REQUEST_GRACE_TICKS = 100`, then orphan threads are force-stopped after ADS END.

Add any extra site the search finds.

- [ ] **Action 9: Write `docs/re/open-questions.md`**

Use the template below. Fill in one `OQ-n` per workaround site from action 8. For the "Past fixes" table, put every line from `git log --oneline --grep '^fix'` in it, and assign each one the chunk that will re-check it. Chunks: 2 resources, 3 decoders, 4 graphics, 5 TTM, 6 ADS, 7 story and main loop, 8 walk.

```markdown
# Open Questions

Behavior we haven't settled against the original, and workarounds kept without a known root cause. When one is resolved, write the finding in `<subsystem>.md`, fix or delete the code, and move the entry to "Resolved" with the address that settled it.

## Workarounds without a known root cause

### OQ-1: Story watchdog force-ends scenes after 8000 ticks

- **Where:** `src/story/story.ts:332`
- **What it does:** ends the current scene once `playingTicks > 8000`, whatever the threads are doing.
- **Old guess behind it:** some scenes cycle forever without reaching an end.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-2: ADS pre-tick sweep frees threads with a nil TTM slot

- **Where:** `src/ads/scheduler.ts:401`
- **What it does:** before each ADS tick, frees threads whose TTM slot is nil or unloaded.
- **Old guess behind it:** threads leak after walks and block the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open

### OQ-3: Orphan threads force-stopped 100 ticks after ADS END

- **Where:** `src/ads/scheduler.ts:45-49`, `src/ads/scheduler.ts:479-483`
- **What it does:** after END, waits `STOP_REQUEST_GRACE_TICKS = 100` ticks for threads to finish, then force-stops the rest.
- **Old guess behind it:** GOTO-loop threads never see the stop request and wedge the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open

## Past fixes to re-check against the original

Each fix below was made without the decompile. Treat it as a guess until a chunk confirms or replaces it.

| Commit | Summary | Chunk |
| --- | --- | --- |
| `85c05ad` | copyZoneToBg skips transparent pixels (colorkey) | 4 |

## Resolved

None yet.
```

The `85c05ad` row is an example. Replace the table body with the full `git log` list.

- [ ] **Action 10: Run the full suite and type check**

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Action 11: Commit**

```bash
git add docs/re/README.md docs/re/open-questions.md
git commit -m "docs(re): trust order, toolchain usage, and open questions"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
