# Step 2: Original ADS Trace

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-ads-findings.md` (names and `docs/re/ads.md`; the harness itself only uses addresses)

**Files:**

- Modify: `scripts/re/unicorn/original_ttm.py` (one line: give the loader every payload)
- Create: `scripts/re/unicorn/original_ads.py`, `scripts/re/unicorn/test_original_ads.py`, `scripts/re/unicorn/dump_ads.py`
- Modify: `scripts/re/unicorn/README.md` (one paragraph), `docs/re/ads.md` (`Emulated` section)
- Local only (gitignored): `re/fixtures/ads/traces.tsv`

**Interfaces:**

- Consumes: `TtmTracer(image, resources, name)` from `scripts/re/unicorn/original_ttm.py`. Its `__init__` sets `self.name` (upper case), `self.resources` (upper-case keys), `self.emu`, `self.events = []`, `self.random_calls = 0`, `self.images`, `self.palettes`, then `self.pages = self._load()`, `self._set_globals()`, `self.node = self._new_thread()`, `self._install_hooks()`. Its hooks replace every drawing, loading, sound, and random callee of the page runner; `_random` appends `["random"]` to `self.events`; `_bitmap_list(name)` near-allocates a bitmap table for a BMP name. Also `put_string`, `read_word`, `ADS_SLOTS` (`original_loaders.py`), `set_word`, `signed` (`original_graphics.py`), `load_resources` (`corpus.py`), `NeImage.load`.
- Produces: `AdsTracer(image, resources, name)` with `slot`, `section_tags() -> list[int]`, `trace_section(tag) -> list[list[object]]` (rows `[ads, tag, tick, event, values]`); `re/fixtures/ads/traces.tsv` in the overview's `Trace format`. Step 4's data test reads that file.

The trace format, clock, tick limit, and random source are defined in the overview (`Trace format`). Read that section before writing code.

- [ ] **Action 1: Let the TTM tracer's loader see every resource**

An ADS load opens each TTM it lists by name, so the loader needs all payloads. In `scripts/re/unicorn/original_ttm.py`, `TtmTracer.__init__`, change

```python
        self.emu: Emulator = new_loader_emulator(image, {self.name: self.resources[self.name]})
```

to

```python
        self.emu: Emulator = new_loader_emulator(image, self.resources)
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_ttm.py' -v`
Expected: PASS (it passes a single-entry dict, so nothing changes for it).

- [ ] **Action 2: Write the failing test**

Create `scripts/re/unicorn/test_original_ads.py`:

```python
import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_ads import AdsTracer

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


TTM = chunk("VER:", b"4.09\0") + chunk("PAG:", words(2)) + chunk("TT3:", stored(words(0x1111, 1, 0x0FF0, 0x0110, 0x0FF0)))
SCRIPT = words(
    1,
    0x1330, 1, 1, 0x2005, 1, 1, 0, 1, 0x1510,
    0x1350, 1, 1, 0xF010, 0xFFFF, 0x1510,
    0xFFFF,
)
ADS = chunk("VER:", b"4.09\0") + chunk("ADS:", chunk("RES:", words(1, 1) + b"A.TTM\0") + chunk("SCR:", stored(SCRIPT)), True)


def rows_of(rows: list[list[object]], tick: int) -> list[list[str]]:
    return [[str(row[3]), *str(row[4]).split(" ")] for row in rows if row[2] == tick]


def text(*values: object) -> list[str]:
    return [str(value) for value in values]


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class AdsTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = NeImage.load(BINARY)
        resources = {"TEST.ADS": ADS, "A.TTM": TTM}
        cls.tags = AdsTracer(image, resources, "TEST.ADS").section_tags()
        cls.rows = AdsTracer(image, resources, "TEST.ADS").trace_section(1)

    def test_lists_the_section_tags(self):
        # SCRANTIC 1048:04fc
        self.assertEqual(self.tags, [1])

    def test_first_tick_starts_the_scene_and_runs_its_tag_page(self):
        # SCRANTIC 1048:0874 1048:1acb 1048:1223 1048:0db6 1048:196e
        self.assertEqual(rows_of(self.rows, 0), [
            text("tick", 1, 1, 0),
            text("order", "1:1"),
            text("section", 0, 1, 0, -1),
            text("node", 1, 1, 1, 1, -1, 0, 0, 0, 1, 0, 0, 0, 0, 0),
        ])

    def test_a_purge_finishes_a_scene_played_once(self):
        # SCRANTIC 1048:1acb 1048:196e
        self.assertEqual(rows_of(self.rows, 1), [
            text("tick", 1, 1, 0),
            text("node", 1, 1, 4, 0, -1, 1, 0, 0, 1, 0, 1, 0, 0, 0),
        ])

    def test_the_done_scene_stops_the_section_and_ends_the_run(self):
        # SCRANTIC 1048:1758 1048:1669 1048:0766
        self.assertEqual(rows_of(self.rows, 2), [
            text("tick", 0, 0, 0),
            text("section", 0, 2, 0, -1),
            text("node", 1, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, 0, 0, 0),
        ])
        self.assertEqual(max(row[2] for row in self.rows), 2)


if __name__ == "__main__":
    unittest.main()
```

The expected rows follow the overview's `Binary facts`. If `docs/re/ads.md` (step 1) corrected one of those facts, fix the expected rows to match `ads.md` before going on, and say so in the commit message.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_ads.py' -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'original_ads'`.

- [ ] **Action 3: Write the tracer**

Create `scripts/re/unicorn/original_ads.py`:

```python
from ne_image import NeImage
from original_graphics import set_word, signed
from original_loaders import ADS_SLOTS, put_string, read_word
from original_ttm import TtmTracer

LOAD_ADS = "1048:0079"
INDEX_SECTIONS = "1048:04fc"
START_SECTION = "1048:0874"
ADS_TICK = "1048:1acb"
SECTION_BUSY = "1048:0766"
CLOCK = 0x2E70
CLOCK_START = 1
TICK_LIMIT = 2000
RECORD_SECTION_COUNT = 0x02
RECORD_BYTECODE = 0x04
RECORD_NODES = 0x10
RECORD_STATES = 0x12
RECORD_COUNTERS = 0xB2
RECORD_STARTS = 0x152
RECORD_RESUME = 0x292
NODE_NEXT_PAGE = 0x06
NODE_PAGE = 0x08
NODE_RUN_PAGE = 0x0A
NODE_SELF_GOTO = 0x0C
NODE_RAN = 0x0E
NODE_DELAY = 0x29
NODE_SECTION_STATE = 0x2B
NODE_PLAY_COUNT = 0x2D
NODE_MODE = 0x2F
NODE_PLAYS_LEFT = 0x31
NODE_END_TIME = 0x33
NODE_DUE_TIME = 0x37
NODE_NEXT = 0x3B


class AdsTracer(TtmTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes], name: str):
        self.cached_lists: dict[str, int] = {}
        super().__init__(image, resources, name)
        self.slot = self.pages[0]
        self.emu.call_far(INDEX_SECTIONS, stack_words=[self.slot])

    def _load(self) -> list[int]:
        slot = self.emu.call_far(LOAD_ADS, stack_words=[put_string(self.emu, self.name)])["ax"]
        if slot == 0:
            raise RuntimeError(f"{self.name}: ADS load failed")
        return [slot]

    def _new_thread(self) -> int:
        return 0

    def _bitmap_list(self, name: str) -> int:
        key = name.upper()
        if key not in self.cached_lists:
            self.cached_lists[key] = super()._bitmap_list(name)
        return self.cached_lists[key]

    def _record(self) -> tuple[int, int]:
        pointer = ADS_SLOTS + 4 * (self.slot - 1)
        return self._word(pointer + 2), self._word(pointer)

    def _record_word(self, field: int) -> int:
        segment, offset = self._record()
        return read_word(self.emu, segment, offset + field)

    def _far(self, field: int) -> int:
        return self._record_word(field + 2) * 16 + self._record_word(field)

    def _dword(self, offset: int) -> int:
        return self._word(offset) | self._word(offset + 2) << 16

    def section_tags(self) -> list[int]:
        tags = []
        for index in range(self._record_word(RECORD_SECTION_COUNT)):
            start = self._far(RECORD_STARTS + 4 * index)
            tags.append(read_word(self.emu, 0, start - 2))
        return tags

    def _sections(self) -> list[list[int]]:
        bytecode = self._far(RECORD_BYTECODE)
        rows = []
        for index in range(self._record_word(RECORD_SECTION_COUNT)):
            resume = self._far(RECORD_RESUME + 4 * index)
            rows.append([
                self._record_word(RECORD_STATES + 2 * index),
                signed(self._record_word(RECORD_COUNTERS + 2 * index)),
                resume - bytecode if resume else -1,
            ])
        return rows

    def _node_list(self) -> list[int]:
        nodes = []
        node = self._record_word(RECORD_NODES)
        while node:
            nodes.append(node)
            node = self._word(node + NODE_NEXT)
        return nodes

    def _node(self, node: int) -> list[int]:
        word = self._word
        return [
            word(node),
            word(node + 2),
            word(node + NODE_MODE),
            signed(word(node + NODE_PAGE)),
            signed(word(node + NODE_NEXT_PAGE)),
            signed(word(node + NODE_RUN_PAGE)),
            1 if word(node + NODE_SELF_GOTO) else 0,
            1 if word(node + NODE_RAN) else 0,
            word(node + NODE_PLAY_COUNT),
            signed(word(node + NODE_PLAYS_LEFT)),
            word(node + NODE_SECTION_STATE),
            signed(word(node + NODE_DELAY)),
            self._dword(node + NODE_DUE_TIME),
            self._dword(node + NODE_END_TIME),
        ]

    def trace_section(self, tag: int) -> list[list[object]]:
        emu = self.emu
        emu.call_far(START_SECTION, stack_words=[tag])
        rows: list[list[object]] = []
        seen_order: list[str] | None = None
        seen_sections: dict[int, list[int]] = {}
        seen_nodes: dict[int, list[int]] = {}
        now = CLOCK_START
        for tick in range(TICK_LIMIT):
            self.events = []
            set_word(emu, CLOCK, now & 0xFFFF)
            set_word(emu, CLOCK + 2, now >> 16)
            emu.call_far(INDEX_SECTIONS, stack_words=[self.slot])
            ran = emu.call_far(ADS_TICK)["ax"]
            busy = emu.call_far(SECTION_BUSY, stack_words=[tag])["ax"]
            out: list[list[object]] = [["tick", ran, busy, sum(1 for event in self.events if event[0] == "random")]]
            nodes = self._node_list()
            order = [f"{self._word(node)}:{self._word(node + 2)}" for node in nodes]
            if order != seen_order:
                out.append(["order", *order])
                seen_order = order
            for index, values in enumerate(self._sections()):
                if seen_sections.get(index) != values:
                    out.append(["section", index, *values])
                    seen_sections[index] = values
            for node in nodes:
                values = self._node(node)
                if seen_nodes.get(node) != values:
                    out.append(["node", *values])
                    seen_nodes[node] = values
            rows.extend([self.name, tag, tick, event[0], " ".join(str(value) for value in event[1:])] for event in out)
            if busy == 0:
                break
            now += 1 + tick % 3
        return rows
```

Notes for debugging, not for the file:

- `self._word(offset)` (from `TtmTracer`) reads a word in the data segment; nodes are near pointers there. Record and bytecode pointers are far; `_far` turns one into a linear address (`segment * 16 + offset`), which is why `section_tags` reads with segment 0.
- `TtmTracer.__init__` stores `_load`'s return value in `self.pages`; here it holds the slot number.
- `1048:0079` takes a near pointer to the name and returns slot + 1 (0 on failure).
- The bitmap-table cache keeps the near heap from running out: a scene that loops reloads the same BMPs on every pass.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_ads.py`
Expected: no output.

- [ ] **Action 4: Run the test to make it pass**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_ads.py' -v`
Expected: 4 tests PASS.

When it fails, read the error first:

- `UnstubbedImport`: the ADS code reached a Windows import. Find the caller in `re/out/index.tsv` and replace the `1048`/`1050`/`1038` function that calls it with a handler in `AdsTracer._install_hooks` (call `super()._install_hooks()` first). `install_heap` (`original_decompress.py`) already covers `1038:06a8` (near calloc), `1038:063b` (near free), `1030:199a`, `1030:1b63` (far alloc and free).
- A row differs: compare with `docs/re/ads.md`. If the harness reads a field wrong, fix the harness. If the original does something the overview and `ads.md` did not say, correct `ads.md` (a new or fixed bullet with the address) and the expected rows, and note it in the commit message.

- [ ] **Action 5: Commit**

```bash
git add scripts/re/unicorn/original_ttm.py scripts/re/unicorn/original_ads.py scripts/re/unicorn/test_original_ads.py
git commit -m "test(re): run the original ADS loader and tick in Unicorn"
```

- [ ] **Action 6: Write the corpus dump**

Create `scripts/re/unicorn/dump_ads.py`:

```python
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_ads import TICK_LIMIT, AdsTracer  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/ads"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    rows: list[list[object]] = []
    for name in sorted(name for name in resources if name.upper().endswith(".ADS")):
        for tag in AdsTracer(image, resources, name).section_tags():
            started = time.monotonic()
            traced = AdsTracer(image, resources, name).trace_section(tag)
            rows.extend(traced)
            ticks = int(traced[-1][2]) + 1
            limit = " (tick limit)" if ticks == TICK_LIMIT else ""
            print(f"{name} {tag}: {ticks} ticks{limit}, {len(traced)} rows, {time.monotonic() - started:.1f}s", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["ads\ttag\ttick\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_ads.py`
Expected: no output.

- [ ] **Action 7: Time one ADS, then dump everything**

Before the full run, time the smallest file. Run:

`re/.venv/bin/python -I -c "import sys, time; sys.path.insert(0, 'scripts/re/unicorn'); from corpus import load_resources; from ne_image import NeImage; from original_ads import AdsTracer; from pathlib import Path; d = Path('public/data'); img = NeImage.load(d / 'SCRANTIC.SCR'); res = {r.name: r.payload for r in load_resources(d)}; t = time.monotonic(); rows = AdsTracer(img, res, 'WALKSTUF.ADS').trace_section(AdsTracer(img, res, 'WALKSTUF.ADS').section_tags()[0]); print(len(rows), round(time.monotonic() - t, 1))"`

Expected: a row count and a time in seconds. If one section takes over a minute, the full dump (every section of all 10 files) may take hours: lower `TICK_LIMIT` in `original_ads.py` (to 1000, then 500) until the estimate is under 30 minutes, and remember the value; step 4's TypeScript side must use the same limit.

Run (in the background if it is long): `re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py`
Expected: exits 0, one stderr line per section, and `re/fixtures/ads/traces.tsv` exists. Note the lines that say `(tick limit)`: those sections were still busy at the last tick.

Run: `rg -c "" re/fixtures/ads/traces.tsv`
Expected: a row count; note it.

- [ ] **Action 8: Write what the emulation showed**

Add a section `Emulated` to `docs/re/ads.md`, after `Unreferenced` and before `Side-by-side checklist`:

```markdown
## Emulated

- `scripts/re/unicorn/original_ads.py` (`AdsTracer`) loads each ADS with `1048:0079` and runs `1048:04fc`, `1048:0874`, then per tick `1048:04fc`, `1048:1acb`, `1048:0766` with the clock `1068:2e70` set before each tick. The page runner `1050:074a` is the original one, with the chunk 5 recorders in place of its drawing, loading, sound, and random callees. Rows: `re/fixtures/ads/traces.tsv` (format in `docs/plans/2026-10-18-re-ads/step-000-overview.md`, `Trace format`).
```

Then one bullet each, with the numbers from Action 7: how many sections in how many files, total rows, how many runs ended because `1048:0766` returned 0 and how many reached the tick limit (name them), the limit used, and how long the dump took. Add any surprise the run showed (a fault, a section that never starts its nodes, a node that loops on itself), each with its address.

- [ ] **Action 9: Document the harness**

In `scripts/re/unicorn/README.md`, after the `## Original TTM page runner` section, add the same kind of section:

```markdown
## Original ADS tick

    re/.venv/bin/python -I scripts/re/unicorn/dump_ads.py

Loads each ADS script with the original loader (`1048:0079`) and, for every section, starts it with `1048:0874` and runs ticks (`1048:04fc`, `1048:1acb`, `1048:0766`) with the clock set before each, until the section is no longer busy or the tick limit. The page runner is the original one with the TTM recorders of `original_ttm.py` (`AdsTracer` extends `TtmTracer`). Writes `re/fixtures/ads/traces.tsv` (gitignored), which `src/ads/tick.data.test.ts` compares with the TypeScript port. The row format is documented in `docs/plans/2026-10-18-re-ads/step-000-overview.md`, `Trace format`, and in `docs/re/ads.md`, `Emulated`. `test_original_ads.py` pins the harness on a synthetic ADS.
```

- [ ] **Action 10: Commit**

```bash
git add scripts/re/unicorn/dump_ads.py scripts/re/unicorn/README.md docs/re/ads.md
git commit -m "test(re): dump the original ADS trace for every section"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
