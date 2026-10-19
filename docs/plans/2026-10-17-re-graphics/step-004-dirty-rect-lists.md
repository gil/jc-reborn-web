# Step 4: Dirty Rect Lists

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-colors-and-bitmap-masks.md` (harness), `step-002-surfaces-and-primitives.md` (`ClipRect` type)

**Files:**

- Create: `src/gfx/gdi/dirty.ts`, `src/gfx/gdi/dirty.test.ts`, `src/gfx/gdi/dirty.data.test.ts`
- Modify: `scripts/re/unicorn/original_graphics.py`, `scripts/re/unicorn/dump_graphics.py`, `scripts/re/unicorn/test_original_graphics.py`
- Modify: `docs/re/graphics.md` (`Dirty rects`, checklist), `scripts/re/names.json`, `docs/re/function-map.md` (regenerated)

**Interfaces:**

- Consumes: `interface ClipRect { x1: number; y1: number; x2: number; y2: number }` (inclusive) from `src/gfx/gdi/surface.ts`. Python: `new_graphics_emulator(image)` (heap and near malloc installed, color mode 2), `set_byte(emu, offset, value)`, `set_word(emu, offset, value)`, `pascal_args` from `scripts/re/unicorn/original_graphics.py`; `read_word(emu, segment, offset)` from `original_loaders.py`; `dump_graphics.py` with `write_tsv(name, header, rows)`, `OUT`, and the `COMMANDS` dict (commands take `(image, resources)`); `hasFixture`, `readFixtureRows` from `src/testing/corpus.ts`.
- Produces (`src/gfx/gdi/dirty.ts`): `COPY_RECT = 1`, `SAVED_BITS = 4`, `NO_SOURCE = -1`, `LIST_SLOTS = 20`, `interface DirtyRect { x; y; w; h; source; target; kind; age; area; saved }` (all `number`), `type ReplayEvent = { kind: 'copy'; source; target; x; y; w; h } | { kind: 'bits'; target; saved; x; y; w; h }`, `class DirtyLists` with `constructor(width: number, height: number)`, `add(x, y, w, h, kind, source, target, age, clip: ClipRect | null, saved = 0): void`, `overlaps(x, y, w, h, target, age): number`, `drop(source, target, age): void`, `clear(): void`, `replay(source, target, age): ReplayEvent[]`, `restorePass(pairs: ReadonlyArray<readonly [number, number]>, ageAfter: boolean): ReplayEvent[]`, `snapshot(): Array<[number, DirtyRect[]]>`. Copy events carry pixel units (`x * 8`, `w * 8`).
- Produces (fixtures): `re/fixtures/graphics/dirty.tsv` (random operation sequences run on the original), `re/fixtures/graphics/restore-table.tsv` (the pairs `1060:03d3` replays).

This step ports the whole `1060` list code literally, including `1060:05f9` (replay one list) and `1060:03d3` (restore pass), because all of them are pure list work once the two drawing calls (`1038:06ce`, `1030:0250`) are recorded instead of run. Step 5 executes the replay events on surfaces. The DC handles `A`, `B`, `C` (`1068:1eb4`, `1eb2`, `1eb0`) are plain numbers here; the harness gives them the values `0xA1`, `0xB2`, `0xC3`.

Words are 16 bits in the original. The port keeps two 16-bit effects that matter: node areas and the merge sum wrap around (`int16`), so a bounding box of 80 columns × 480 rows (38,400) reads as negative and always merges. The harness and the fixtures carry every word as a signed 16-bit value.

## Part A: Read and confirm

- [x] **Action 1: Read the list code**

Read `re/out/functions/` pseudo-C and assembly for `1060_0000`, `1060_007e`, `1060_03d3`, `1060_046e`, `1060_04b2`, `1060_0556`, `1060_0596`, `1060_05a7`, `1060_05f9`, `1060_06ac`, `1060_06f5`. Confirm or correct the overview's "Dirty rects" first reading, then check these details against the code below before writing it:

1. `1060:007e`: argument order `(x, y, w, h, kind, source, target, age, savedOffset, savedSegment)`; kind 4 forces source to `-1`; the screen cut (clip off) and the clip cut (clip on) exactly as `cutToScreen` and `cutToClip` below; the column conversion; the `w != 0 && h != 0` check; area `w * h`; the merge test `union area <= node area + new area + 20` as signed 16-bit; insertion at the head.
2. The merge loop's stop rule: after a merge it restarts from the head and stops when it reaches the node that preceded the merged one. `mergeInto` below is a literal port with the original's three pointers (`stopAt`, `resumeAt`, `previous`); keep it literal.
3. `1060:05a7`: a matching head (source, target, age of the **first** node) wins even after an empty slot; otherwise the first empty slot; otherwise none.
4. `1060:05f9`: sets `1068:1eb6`/`1068:1eb8` from the head node, replays head to tail (kind 1 → `1038:06ce(x * 8, y, w * 8, h)`, kind 4 → `1030:0250(savedOffset, savedSegment, x, y, w, h)`, other kinds nothing), then frees the whole list.
5. `1060:03d3`: the table walk and the age decrement; `1068:1eb6`/`1eb8` restored at the end.
6. `1060:04b2(x, y, w, h, target, age)`: which node fields it compares; returns the node kind (1) on the first kind-1 overlap, else 0.
7. `1060:06f5`: its loop never advances to the next node (an endless loop for a non-empty list), and nothing calls it. Confirm with `rg -n "1060:06f5" re/out/functions/*.asm re/out/relocations.tsv`.

If something differs, fix the code below to match the binary before writing it and say so in the commit message.

## Part B: Emulate the original lists

- [x] **Action 2: Add the dirty-list driver to the harness**

Append to `scripts/re/unicorn/original_graphics.py` (add `from original_loaders import read_word` to the imports at the top):

```python
DIRTY_ADD = "1060:007e"
DIRTY_OVERLAPS = "1060:04b2"
DIRTY_CLEAR = "1060:046e"
DIRTY_REPLAY = "1060:05f9"
DIRTY_DROP = "1060:06ac"
RESTORE_PASS = "1060:03d3"
COPY_RECT = "1038:06ce"
RESTORE_RECT_BITS = "1030:0250"
SCREEN_WIDTH = 0x2562
SCREEN_HEIGHT = 0x2564
CLIP_ON = 0x1EA3
CLIP_X1 = 0x1EA4
CLIP_X2 = 0x1EA6
CLIP_Y1 = 0x1EA8
CLIP_Y2 = 0x1EAA
SOURCE_DC = 0x1EB6
TARGET_DC = 0x1EB8
DC_A, DC_B, DC_C = 0xA1, 0xB2, 0xC3
DC_GLOBALS = {0x1EB4: DC_A, 0x1EB2: DC_B, 0x1EB0: DC_C}
LIST_HEADS = 0x46F0
LIST_SLOTS = 20
NODE_WORDS = 13
NODE_NEXT = 12
NODE_SAVED = 10
RESTORE_TABLE = {0: 0x287E, 1: 0x2882}


def signed(word: int) -> int:
    return word - 0x10000 if word & 0x8000 else word


class DirtyEmulator:
    def __init__(self, image: NeImage):
        self.emu = new_graphics_emulator(image)
        set_word(self.emu, SCREEN_WIDTH, 640)
        set_word(self.emu, SCREEN_HEIGHT, 480)
        for address, value in DC_GLOBALS.items():
            set_word(self.emu, address, value)
        self.events: list[list[object]] = []
        self.emu.replace_function(COPY_RECT, self._copy)
        self.emu.replace_function(RESTORE_RECT_BITS, self._bits)

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _copy(self, emu: Emulator):
        x, y, w, h = (signed(emu.arg(i)) for i in range(4))
        self.events.append(["copy", signed(self._word(SOURCE_DC)), signed(self._word(TARGET_DC)), x, y, w, h])
        return {"ax": 0}

    def _bits(self, emu: Emulator):
        saved, _segment, x, y, w, h = (signed(emu.arg(i)) for i in range(6))
        self.events.append(["bits", signed(self._word(TARGET_DC)), saved, x, y, w, h])
        return {"ax": 0}

    def run(self, op: list) -> object:
        name, args = op[0], op[1:]
        call = self.emu.call_far
        if name == "add":
            x, y, w, h, kind, source, target, age, clip, saved = args
            if clip is None:
                set_byte(self.emu, CLIP_ON, 0)
            else:
                set_byte(self.emu, CLIP_ON, 1)
                for address, value in zip((CLIP_X1, CLIP_Y1, CLIP_X2, CLIP_Y2), clip):
                    set_word(self.emu, address, value)
            call(DIRTY_ADD, stack_words=[0, saved, age, target, source, kind, h, w, y, x])
            return None
        if name == "overlaps":
            x, y, w, h, target, age = args
            return signed(call(DIRTY_OVERLAPS, stack_words=[age, target, h, w, y, x])["ax"])
        if name == "drop":
            source, target, age = args
            call(DIRTY_DROP, stack_words=[age, target, source])
            return None
        if name == "clear":
            call(DIRTY_CLEAR)
            return None
        self.events = []
        if name == "replay":
            source, target, age = args
            call(DIRTY_REPLAY, stack_words=[age, target, source])
        elif name == "restore":
            call(RESTORE_PASS, stack_words=[args[0]])
        else:
            raise ValueError(f"unknown dirty op {name}")
        return self.events

    def lists(self) -> list:
        out = []
        for slot in range(LIST_SLOTS):
            node = self._word(LIST_HEADS + 2 * slot)
            nodes = []
            while node:
                words = struct.unpack(f"<{NODE_WORDS}H", self.emu.read(self.emu.data_segment, node, 2 * NODE_WORDS))
                nodes.append([signed(word) for word in words[:9]] + [signed(words[NODE_SAVED])])
                node = words[NODE_NEXT]
            if nodes:
                out.append([slot, nodes])
        return out

    def restore_table(self, which: int) -> list[list[int]]:
        pairs = []
        entry = RESTORE_TABLE[which]
        while True:
            source_pointer, target_pointer = self._word(entry), self._word(entry + 2)
            if target_pointer == 0:
                break
            pairs.append([signed(self._word(source_pointer)), signed(self._word(target_pointer))])
            if which != 0:
                break
            entry += 4
        return pairs
```

Each node in `lists()` is `[x, y, w, h, source, target, kind, age, area, saved]`.

- [x] **Action 3: Write the Python tests**

Append to `scripts/re/unicorn/test_original_graphics.py` (add `DC_A, DC_B, DirtyEmulator` to the `original_graphics` import):

```python
@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class DirtyListTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)

    def test_kind_1_rects_become_8_pixel_columns(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 13, 5, 10, 4, 1, DC_B, DC_A, 0, None, 0])
        self.assertEqual(dirty.lists(), [[0, [[1, 5, 2, 4, DC_B, DC_A, 1, 0, 8, 0]]]])

    def test_neighbours_merge_when_the_union_wastes_at_most_20(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 0, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        dirty.run(["add", 8, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        self.assertEqual(dirty.lists(), [[0, [[0, 0, 2, 8, DC_B, DC_A, 1, 0, 16, 0]]]])

    def test_replay_copies_head_to_tail_in_pixels_and_empties_the_list(self):
        dirty = DirtyEmulator(self.image)
        dirty.run(["add", 0, 0, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        dirty.run(["add", 400, 400, 8, 8, 1, DC_B, DC_A, 0, None, 0])
        events = dirty.run(["replay", DC_B, DC_A, 0])
        self.assertEqual(events, [["copy", DC_B, DC_A, 400, 400, 8, 8], ["copy", DC_B, DC_A, 0, 0, 8, 8]])
        self.assertEqual(dirty.lists(), [])
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_graphics.py' -v`
Expected: all pass. If the first fails on the argument layout (a `RuntimeError` or nonsense values), check the `stack_words` order against Action 1 item 1.

- [x] **Action 4: Dump random sequences**

Append to `scripts/re/unicorn/dump_graphics.py` (add `import json`, `import random`, and `DC_A, DC_B, DC_C, DirtyEmulator` from `original_graphics`):

```python
DIRTY_SEQUENCES = 300
DIRTY_STEPS = 40
DIRTY_PAIRS = [(DC_B, DC_A), (DC_C, DC_B), (DC_A, DC_C)]


def random_rect(rng: random.Random) -> list[int]:
    size = (lambda: rng.randint(0, 120)) if rng.random() < 0.85 else (lambda: rng.randint(200, 700))
    return [rng.randint(-60, 680), rng.randint(-60, 520), size(), size()]


def random_clip(rng: random.Random) -> list[int] | None:
    if rng.random() < 0.6:
        return None
    x1, y1 = rng.randint(-20, 500), rng.randint(-20, 400)
    return [x1, y1, x1 + rng.randint(0, 300), y1 + rng.randint(0, 200)]


def random_op(rng: random.Random) -> list:
    source, target = rng.choice(DIRTY_PAIRS)
    age = rng.choice([0, 0, 1])
    roll = rng.random()
    if roll < 0.68:
        kind = 1 if rng.random() < 0.85 else 4
        return ["add", *random_rect(rng), kind, source, target, age, random_clip(rng), rng.randint(1, 999)]
    if roll < 0.78:
        return ["overlaps", *random_rect(rng), target, age]
    if roll < 0.86:
        return ["replay", source, target, age]
    if roll < 0.95:
        return ["restore", rng.choice([0, 0, 1])]
    if roll < 0.98:
        return ["drop", source, target, age]
    return ["clear"]


def dump_dirty(image: NeImage, resources):
    rng = random.Random(4)
    rows = []
    for sequence in range(DIRTY_SEQUENCES):
        dirty = DirtyEmulator(image)
        for step in range(DIRTY_STEPS):
            op = random_op(rng)
            result = dirty.run(op)
            rows.append([sequence, step, json.dumps(op, separators=(",", ":")), json.dumps(result, separators=(",", ":")), json.dumps(dirty.lists(), separators=(",", ":"))])
    write_tsv("dirty.tsv", ["sequence", "step", "op", "result", "lists"], rows)
    table = DirtyEmulator(image)
    write_tsv("restore-table.tsv", ["which", "source", "target"], [[which, *pair] for which in (0, 1) for pair in table.restore_table(which)])
```

Register it: `"dirty": dump_dirty,` in `COMMANDS`.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_graphics.py dirty`
Expected: exits 0 in a few minutes at most; `re/fixtures/graphics/dirty.tsv` has 12,000 rows; `re/fixtures/graphics/restore-table.tsv` lists the `which = 0` pairs (first reading: `(-1, A)`, `(B, A)`, `(-1, B)`, `(C, B)`, `(-1, C)`, `(A, C)`, then until a zero target pointer) and one `which = 1` pair (`(B, A)`). If the `which = 0` walk runs past the table into unrelated words (more than about 8 pairs, or values that are not `-1`, `0xA1`, `0xB2`, `0xC3`), stop: read where `1060:03d3`'s loop really ends in the assembly and fix `restore_table`.

If an operation hangs (`EmulationLimit`), the original looped forever on that input: catch it in `dump_dirty`, record `"hang"` as the result, keep going, and write a finding about the input that caused it.

- [x] **Action 5: Commit**

```bash
git add scripts/re/unicorn/original_graphics.py scripts/re/unicorn/test_original_graphics.py scripts/re/unicorn/dump_graphics.py
git commit -m "test(re): emulate the original dirty-rect lists on random sequences"
```

## Part C: TypeScript port

- [x] **Action 6: Write the failing unit test**

Create `src/gfx/gdi/dirty.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { COPY_RECT, DirtyLists, LIST_SLOTS, NO_SOURCE, SAVED_BITS, type DirtyRect } from './dirty.js';

const A = 0xa1;
const B = 0xb2;

function rect(x: number, y: number, w: number, h: number, changes: Partial<DirtyRect> = {}): DirtyRect {
  return { x, y, w, h, source: B, target: A, kind: COPY_RECT, age: 0, area: w * h, saved: 0, ...changes };
}

describe('DirtyLists.add', () => {
  it('turns kind 1 rects into 8-pixel columns', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(13, 5, 10, 4, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(1, 5, 2, 4)]]]);
  });

  it('cuts kind 1 rects to the screen while the clip is off and drops rects fully outside', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(640, 0, 5, 5, COPY_RECT, B, A, 0, null);
    lists.add(-10, 0, 9, 5, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([]);
    lists.add(630, 470, 20, 20, COPY_RECT, B, A, 0, null);
    lists.add(-5, -3, 20, 10, COPY_RECT, B, A, 1, null);
    expect(lists.snapshot()).toEqual([
      [0, [rect(78, 470, 2, 10)]],
      [1, [rect(0, 0, 2, 7, { age: 1 })]],
    ]);
  });

  it('cuts kind 1 rects to the clip rect while the clip is on', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(90, 140, 30, 30, COPY_RECT, B, A, 0, { x1: 100, y1: 100, x2: 199, y2: 149 });
    expect(lists.snapshot()).toEqual([[0, [rect(12, 140, 3, 10)]]]);
  });

  it('merges when the union wastes at most 20 cells and keeps far rects apart', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(8, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(400, 400, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(50, 400, 1, 8), rect(0, 0, 2, 8)]]]);
  });

  it('merges a union whose 16-bit area wraps negative', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(632, 472, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.snapshot()).toEqual([[0, [rect(0, 0, 80, 480, { area: 38400 - 65536 })]]]);
  });

  it('stores kind 4 rects in pixels with no source and never merges them', () => {
    // SCRANTIC 1060:007e
    const lists = new DirtyLists(640, 480);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 99);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 98);
    const saved = (value: number) => rect(5, 6, 7, 8, { source: NO_SOURCE, kind: SAVED_BITS, saved: value });
    expect(lists.snapshot()).toEqual([[0, [saved(98), saved(99)]]]);
  });

  it('ignores a new key once all 20 slots are taken', () => {
    // SCRANTIC 1060:05a7
    const lists = new DirtyLists(640, 480);
    for (let age = 0; age <= LIST_SLOTS; age++) lists.add(0, 0, 8, 8, COPY_RECT, B, A, age, null);
    expect(lists.snapshot()).toHaveLength(LIST_SLOTS);
  });
});

describe('DirtyLists.replay and restorePass', () => {
  it('replays head to tail in pixels and empties the list', () => {
    // SCRANTIC 1060:05f9
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 0, null);
    lists.add(400, 400, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.replay(B, A, 0)).toEqual([
      { kind: 'copy', source: B, target: A, x: 400, y: 400, w: 8, h: 8 },
      { kind: 'copy', source: B, target: A, x: 0, y: 0, w: 8, h: 8 },
    ]);
    expect(lists.snapshot()).toEqual([]);
  });

  it('replays saved bits with their buffer', () => {
    // SCRANTIC 1060:05f9
    const lists = new DirtyLists(640, 480);
    lists.add(5, 6, 7, 8, SAVED_BITS, B, A, 0, null, 99);
    expect(lists.replay(NO_SOURCE, A, 0)).toEqual([{ kind: 'bits', target: A, saved: 99, x: 5, y: 6, w: 7, h: 8 }]);
  });

  it('ages every rect left after the pass, so age 1 rects replay one pass later', () => {
    // SCRANTIC 1060:03d3
    const lists = new DirtyLists(640, 480);
    lists.add(0, 0, 8, 8, COPY_RECT, B, A, 1, null);
    expect(lists.restorePass([[B, A]], true)).toEqual([]);
    expect(lists.restorePass([[B, A]], true)).toEqual([{ kind: 'copy', source: B, target: A, x: 0, y: 0, w: 8, h: 8 }]);
  });
});

describe('DirtyLists.overlaps', () => {
  it('reports a kind 1 rect of that target and age overlapping in columns', () => {
    // SCRANTIC 1060:04b2
    const lists = new DirtyLists(640, 480);
    lists.add(16, 10, 8, 8, COPY_RECT, B, A, 0, null);
    expect(lists.overlaps(20, 12, 4, 4, A, 0)).toBe(COPY_RECT);
    expect(lists.overlaps(40, 12, 4, 4, A, 0)).toBe(0);
    expect(lists.overlaps(20, 12, 4, 4, A, 1)).toBe(0);
  });
});
```

- [x] **Action 7: Run it to make sure it fails**

Run: `pnpm exec vitest run src/gfx/gdi/dirty.test.ts`
Expected: FAIL, cannot resolve `./dirty.js`.

- [x] **Action 8: Implement `dirty.ts`**

Create `src/gfx/gdi/dirty.ts`:

```ts
import type { ClipRect } from './surface.js';

export const COPY_RECT = 1;
export const SAVED_BITS = 4;
export const NO_SOURCE = -1;
export const LIST_SLOTS = 20;
const MERGE_SLACK = 20;

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
  source: number;
  target: number;
  kind: number;
  age: number;
  area: number;
  saved: number;
}

export type ReplayEvent =
  | { kind: 'copy'; source: number; target: number; x: number; y: number; w: number; h: number }
  | { kind: 'bits'; target: number; saved: number; x: number; y: number; w: number; h: number };

interface Node extends DirtyRect {
  next: Node | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const int16 = (value: number) => (value << 16) >> 16;

export class DirtyLists {
  private readonly heads: (Node | null)[] = new Array<Node | null>(LIST_SLOTS).fill(null);

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  add(x: number, y: number, w: number, h: number, kind: number, source: number, target: number, age: number, clip: ClipRect | null, saved = 0): void {
    if (kind === SAVED_BITS) source = NO_SOURCE;
    const slot = this.find(source, target, age);
    if (slot < 0) return;
    let box: Box | null = { x, y, w, h };
    if (kind === COPY_RECT) {
      box = clip ? cutToClip(box, clip) : cutToScreen(box, this.width, this.height);
      if (!box) return;
      box = { x: Math.trunc(box.x / 8), y: box.y, w: Math.trunc((box.w + (box.x % 8) + 7) / 8), h: box.h };
    }
    if (box.w === 0 || box.h === 0) return;
    const node: Node = { ...box, source, target, kind, age, area: int16(box.w * box.h), saved, next: null };
    if (kind === COPY_RECT) this.mergeInto(slot, node);
    node.next = this.heads[slot] ?? null;
    this.heads[slot] = node;
  }

  overlaps(x: number, y: number, w: number, h: number, target: number, age: number): number {
    const left = Math.trunc(x / 8);
    const columns = Math.trunc((w + (x % 8) + 7) / 8);
    for (const head of this.heads) {
      if (!head || head.target !== target || head.age !== age) continue;
      for (let node: Node | null = head; node; node = node.next) {
        if (node.kind === COPY_RECT && node.x < left + columns && left < node.x + node.w && node.y < y + h && y < node.y + node.h) return node.kind;
      }
    }
    return 0;
  }

  drop(source: number, target: number, age: number): void {
    const slot = this.find(source, target, age);
    if (slot >= 0) this.heads[slot] = null;
  }

  clear(): void {
    this.heads.fill(null);
  }

  replay(source: number, target: number, age: number): ReplayEvent[] {
    const slot = this.find(source, target, age);
    const head = slot >= 0 ? this.heads[slot] : null;
    if (!head) return [];
    const events: ReplayEvent[] = [];
    for (let node: Node | null = head; node; node = node.next) {
      if (node.kind === COPY_RECT) {
        events.push({ kind: 'copy', source: head.source, target: head.target, x: node.x * 8, y: node.y, w: node.w * 8, h: node.h });
      } else if (node.kind === SAVED_BITS) {
        events.push({ kind: 'bits', target: head.target, saved: node.saved, x: node.x, y: node.y, w: node.w, h: node.h });
      }
    }
    this.heads[slot] = null;
    return events;
  }

  restorePass(pairs: ReadonlyArray<readonly [number, number]>, ageAfter: boolean): ReplayEvent[] {
    const events = pairs.flatMap(([source, target]) => this.replay(source, target, 0));
    if (ageAfter) {
      for (const head of this.heads) {
        for (let node: Node | null = head; node; node = node.next) node.age -= 1;
      }
    }
    return events;
  }

  snapshot(): Array<[number, DirtyRect[]]> {
    return this.heads.flatMap((head, slot): Array<[number, DirtyRect[]]> => {
      const rects: DirtyRect[] = [];
      for (let node: Node | null = head; node; node = node.next) {
        const { x, y, w, h, source, target, kind, age, area, saved } = node;
        rects.push({ x, y, w, h, source, target, kind, age, area, saved });
      }
      return rects.length ? [[slot, rects]] : [];
    });
  }

  private find(source: number, target: number, age: number): number {
    let empty = -1;
    for (let slot = 0; slot < LIST_SLOTS; slot++) {
      const head = this.heads[slot];
      if (!head) {
        if (empty < 0) empty = slot;
      } else if (head.age === age && head.source === source && head.target === target) {
        return slot;
      }
    }
    return empty;
  }

  private mergeInto(slot: number, added: Node): void {
    let current = this.heads[slot]!;
    let stopAt: Node | null = null;
    let resumeAt: Node | null = null;
    for (;;) {
      let previous: Node | null = null;
      let next: Node | null;
      do {
        if (current === stopAt) return;
        stopAt = resumeAt;
        next = current!.next;
        const left = Math.min(current!.x, added.x);
        const right = Math.max(current!.x + current!.w, added.x + added.w);
        const top = Math.min(current!.y, added.y);
        const bottom = Math.max(current!.y + current!.h, added.y + added.h);
        const area = int16((right - left) * (bottom - top));
        let newPrevious: Node | null = current;
        if (area <= int16(current!.area + added.area + MERGE_SLACK)) {
          Object.assign(added, { x: left, y: top, w: right - left, h: bottom - top, area });
          if (previous) previous.next = next;
          else this.heads[slot] = next;
          stopAt = previous;
          newPrevious = previous;
          resumeAt = next;
        }
        current = next!;
        previous = newPrevious;
      } while (next !== null || stopAt === null);
      current = this.heads[slot]!;
    }
  }
}

function cutToScreen({ x, y, w, h }: Box, width: number, height: number): Box | null {
  if (x > width - 1 || x + w < 0 || y > height - 1 || y + h < 0) return null;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w - 1 > width - 1) w = width - x;
  if (y + h - 1 > height - 1) h = height - y;
  return { x, y, w, h };
}

function cutToClip({ x, y, w, h }: Box, clip: ClipRect): Box | null {
  if (clip.x2 < x || x + w < clip.x1 || clip.y2 < y || y + h < clip.y1) return null;
  if (x < clip.x1) {
    w -= clip.x1 - x;
    x = clip.x1;
  }
  if (y < clip.y1) {
    h -= clip.y1 - y;
    y = clip.y1;
  }
  if (x + w - 1 > clip.x2) w = clip.x2 - x + 1;
  if (y + h - 1 > clip.y2) h = clip.y2 - y + 1;
  return { x, y, w, h };
}
```

Notes for the executor:

- `mergeInto` treats `null` the way the original treats pointer 0: the first check `current === stopAt` is true right away for an empty list (`null === null`) and whenever the scan runs off the end while `stopAt` is still `null`. It returns instead of inserting; `add` inserts at the head afterwards, as the original's shared exit does.
- The `current!` and `next!` assertions are safe only because of that first check; do not restructure the loop.

- [x] **Action 9: Run the unit test**

Run: `pnpm exec vitest run src/gfx/gdi/dirty.test.ts`
Expected: PASS, 11 tests. Where one fails, check the expectation against the Python run of the same input before changing the port (add the case to `DirtyListTest` if needed); the original decides.

- [x] **Action 10: Write the data test**

Create `src/gfx/gdi/dirty.data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../../testing/corpus.js';
import { DirtyLists, type ReplayEvent } from './dirty.js';

type Op = [string, ...unknown[]];

function eventRow(event: ReplayEvent): unknown[] {
  return event.kind === 'copy'
    ? ['copy', event.source, event.target, event.x, event.y, event.w, event.h]
    : ['bits', event.target, event.saved, event.x, event.y, event.w, event.h];
}

describe.skipIf(!hasFixture('graphics/dirty.tsv'))('dirty-rect lists match the original SCRANTIC.SCR', () => {
  it('ends every random operation with the same result and the same lists', () => {
    // SCRANTIC 1060:007e 1060:03d3 1060:046e 1060:04b2 1060:05a7 1060:05f9 1060:06ac
    const pairs = new Map<number, Array<[number, number]>>();
    for (const [which, source, target] of readFixtureRows('graphics/restore-table.tsv')) {
      pairs.set(Number(which), [...(pairs.get(Number(which)) ?? []), [Number(source), Number(target)]]);
    }
    let lists = new DirtyLists(640, 480);
    let sequence = '';
    const wrong: string[] = [];
    for (const [sequenceId, step, opText, resultText, listsText] of readFixtureRows('graphics/dirty.tsv')) {
      if (sequenceId !== sequence) {
        sequence = sequenceId!;
        lists = new DirtyLists(640, 480);
      }
      const [name, ...args] = JSON.parse(opText!) as Op;
      const n = args as number[];
      let result: unknown = null;
      if (name === 'add') {
        const clip = args[8] as number[] | null;
        lists.add(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!, n[6]!, n[7]!, clip && { x1: clip[0]!, y1: clip[1]!, x2: clip[2]!, y2: clip[3]! }, n[9]!);
      } else if (name === 'overlaps') {
        result = lists.overlaps(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!);
      } else if (name === 'drop') {
        lists.drop(n[0]!, n[1]!, n[2]!);
      } else if (name === 'clear') {
        lists.clear();
      } else if (name === 'replay') {
        result = lists.replay(n[0]!, n[1]!, n[2]!).map(eventRow);
      } else if (name === 'restore') {
        result = lists.restorePass(pairs.get(n[0]!)!, n[0] === 0).map(eventRow);
      }
      const snapshot = lists.snapshot().map(([slot, rects]) => [slot, rects.map((r) => [r.x, r.y, r.w, r.h, r.source, r.target, r.kind, r.age, r.area, r.saved])]);
      if (JSON.stringify(result) !== resultText || JSON.stringify(snapshot) !== listsText) wrong.push(`${sequenceId}/${step} ${opText}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
```

- [x] **Action 11: Run the data test**

Run: `pnpm exec vitest run src/gfx/gdi/dirty.data.test.ts`
Expected: PASS. A failure lists up to 10 operations as `sequence/step op`. Take the first one, replay its sequence up to that step in Python (`DirtyEmulator`) and in a scratch Vitest test, compare `lists()` with `snapshot()` step by step, and fix the port where it strays from the original. Do not change the fixture.

- [x] **Action 12: Commit**

```bash
git add src/gfx/gdi/dirty.ts src/gfx/gdi/dirty.test.ts src/gfx/gdi/dirty.data.test.ts
git commit -m "feat(gfx): dirty-rect lists ported from the original and checked in Unicorn"
```

## Part D: Findings

- [x] **Action 13: Write the findings**

In `docs/re/graphics.md`, replace `None yet.` under `Dirty rects` with one bullet per claim, each starting with its address: the node layout and pool (`1060:0000`, 26-byte nodes, 5 at a time, `1068:46ec` count), the 20 heads at `1068:46f0`, the list key (source, target, age of the head node), every rule of `1060:007e` (kind 4 source, screen and clip cuts, column conversion, zero check, 16-bit area, merge rule and its stop rule, head insertion), `1060:05f9`, `1060:03d3` (the table at `1068:287e` from `restore-table.tsv`, the single pair at `1068:2882`, aging), `1060:04b2`, `1060:046e`, `1060:0556`, `1060:0596`, `1060:06ac`, and `1060:06f5` (never advances; no callers). Add: "Emulated: 300 random sequences of 40 operations (`re/fixtures/graphics/dirty.tsv`) end with the same results and lists in `src/gfx/gdi/dirty.ts`."

Checklist rows (real line numbers): `1060:007e` → `DirtyLists.add`, `1060:05a7` → `find`, `1060:05f9` → `replay`, `1060:03d3` → `restorePass` (the table lives in step 5's `display.ts`; write `src/gfx/gdi/dirty.ts` here), `1060:04b2` → `overlaps`, `1060:06ac` → `drop`, `1060:046e` → `clear`, all `fixed`; `1060:0000`, `1060:0556`, `1060:0596` → `none (no node pool)`, `match`; `1060:06f5` → `none (dead code, endless loop, no callers)`, `match`.

- [x] **Action 14: Names and status**

In `scripts/re/names.json`: `1060:0000` `gfx_growDirtyPool`, `1060:007e` `gfx_addDirtyRect`, `1060:03d3` `gfx_restoreDirtyRects`, `1060:046e` `gfx_clearDirtyLists`, `1060:04b2` `gfx_dirtyOverlaps`, `1060:0556` `gfx_freeDirtyPool`, `1060:0596` `gfx_dirtyPoolSize`, `1060:05a7` `gfx_findDirtyList`, `1060:05f9` `gfx_replayDirtyList`, `1060:06ac` `gfx_dropDirtyList`, `1060:06f5` `gfx_copyDirtyList`; all `verified`; notes in our words.

Run: `node scripts/re/function-map.mjs`
Expected: no errors.

- [x] **Action 15: Check and commit**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

Run: `pnpm test`
Expected: all pass.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add docs/re/graphics.md scripts/re/names.json docs/re/function-map.md
git commit -m "docs(re): chunk 4 dirty-rect lists verified"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [x] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
