# Step 3: Original Page Trace

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-002-ttm-findings.md`

**Files:**

- Create: `scripts/re/unicorn/original_ttm.py`, `scripts/re/unicorn/test_original_ttm.py`, `scripts/re/unicorn/dump_ttm.py`
- Modify: `scripts/re/unicorn/README.md`, `docs/re/ttm.md` (`Emulated`)
- Writes (gitignored): `re/fixtures/ttm/traces.tsv`

**Interfaces:**

- Consumes: the overview's `Trace format` (the contract with step 4), `Shared pieces` (Python helpers and constants). `1050:0177` loads a TTM and makes it current at `1068:2638`; `1050:04d6(id)` builds its page table (record word `[0x68..0x69]` = far pointer, `count + 1` far pointers, unused ones 0). `1048:0b3e(node)` resets a thread node. `1050:074a(page)` runs a page and returns 1 or 0.
- Produces: `class TtmTracer(image: NeImage, resources: dict[str, bytes], name: str)` with `.pages: list[int]` and `.trace() -> list[list[object]]` (rows `[ttm, page, pass, event, values]`, `values` already joined with spaces); `traceRandom` equivalent `RANDOM_MULTIPLIER = 25173`, `RANDOM_INCREMENT = 13849`; CLI `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py` writing `re/fixtures/ttm/traces.tsv` (header `ttm	page	pass	event	values`).

The tracer runs the original page runner with every drawing, loading, sound, and random callee replaced by a Python handler that writes one trace row and returns a harmless value. Everything else (offsets, dispatch, dirty-rect arithmetic, the zone effects' bookkeeping, `rtl_stricmp`, `1058:13a9`) runs as original code.

## Part A: The tracer

- [x] **Action 1: Write the failing test**

Create `scripts/re/unicorn/test_original_ttm.py`:

```python
import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_ttm import TtmTracer

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"
CONTAINER_FLAG = 0x80000000
CLIP = [1, 0, 0, 639, 479]


def chunk(tag: str, body: bytes, container: bool = False) -> bytes:
    return tag.encode("latin1") + struct.pack("<I", len(body) | (CONTAINER_FLAG if container else 0)) + body


def words(*values: int) -> bytes:
    return struct.pack(f"<{len(values)}H", *values)


def stored(data: bytes) -> bytes:
    return bytes([0]) + struct.pack("<I", len(data)) + data


BYTECODE = words(
    0x1111, 1, 0x1021, 7, 0x2002, 5, 12, 0xA0A4, 1, 2, 3, 4, 0x0FF0,
    0x1201, 1, 0x0110, 0x0FF0,
)
TEST_TTM = chunk("VER:", b"4.09\0") + chunk("PAG:", words(2)) + chunk("TT3:", stored(BYTECODE))


def rows_for(rows: list[list[object]], page: int, run: str) -> list[list[object]]:
    return [[row[3], *str(row[4]).split(" ")] if row[4] != "" else [row[3]] for row in rows if row[1] == page and row[2] == run]


def text(*values: object) -> list[str]:
    return [str(value) for value in values]


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class TtmTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tracer = TtmTracer(NeImage.load(BINARY), {"TEST.TTM": TEST_TTM}, "TEST.TTM")
        cls.pages = tracer.pages
        cls.rows = tracer.trace()

    def test_finds_both_pages(self):
        self.assertEqual(self.pages, [0, 1])

    def test_draws_a_line_with_the_island_offset_and_marks_it_dirty(self):
        # SCRANTIC 1058:0608 1058:0179 1058:119e 1050:0a85
        dirty = ["8", "7", "10", "4", *text(*CLIP)]
        self.assertEqual(rows_for(self.rows, 0, "first"), [
            text("line", 1, 8, 7, 10, 9, 5, *CLIP),
            ["dirty", "1", "0", "0", *dirty],
            ["dirty", "1", "0", "1", *dirty],
            ["dirty", "2", "1", "0", *dirty],
            text("result", 1, 7, -1, 0, "-", 0, 0),
            text("thread", 5, 12, 1, 0, 0, 639, 479, 0, 0, 0),
        ])

    def test_redraws_on_replay(self):
        # SCRANTIC 1058:040c
        self.assertEqual(rows_for(self.rows, 0, "replay")[0], text("line", 1, 8, 7, 10, 9, 5, *CLIP))

    def test_goto_and_purge(self):
        # SCRANTIC 1058:0fc3 1058:13a9 1058:0f73
        self.assertEqual(rows_for(self.rows, 1, "first"), [
            text("result", 1, -1, 0, 1, "-", 0, 0),
            text("thread", 5, 12, 1, 0, 0, 639, 479, 0, 0, 0),
        ])


if __name__ == "__main__":
    unittest.main()
```

- [x] **Action 2: Run it to make sure it fails**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_ttm.py' -v`
Expected: `ModuleNotFoundError: No module named 'original_ttm'`.

- [x] **Action 3: Write the tracer**

Create `scripts/re/unicorn/original_ttm.py`:

```python
import struct

from corpus import walk_chunks
from emulator import Emulator
from ne_image import NeImage
from original_graphics import (
    CLIP_ON,
    CLIP_X1,
    CLIP_X2,
    CLIP_Y1,
    CLIP_Y2,
    COLOR_MODE,
    DC_A,
    DC_B,
    DC_C,
    DC_GLOBALS,
    RECORD_HEIGHT,
    RECORD_SIZE,
    RECORD_WIDTH,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    SIXTEEN_COLOR_MODE,
    SOURCE_DC,
    TARGET_DC,
    set_byte,
    set_word,
    signed,
)
from original_loaders import CURRENT_TTM, INDEX_TTM_PAGES, LOAD_TTM, TTM_GLOBALS, TTM_GLOBALS_SIZE, c_string, new_loader_emulator, put_string, read_word

RUN_PAGE = "1050:074a"
RESET_THREAD = "1048:0b3e"
TTM_ID = 1
RECORD_PAGE_COUNT = 2
RECORD_PAGE_TABLE = 0xD0
THREAD_SIZE = 0x3D
CURRENT_THREAD = 0x263E
NODE_RAN = 0x0E
NODE_PALETTE_SLOT = 0x12
NODE_BMP_SLOT = 0x14
NODE_ZONE_SLOT = 0x16
NODE_FOREGROUND = 0x1E
NODE_BACKGROUND = 0x1F
NODE_CLIP_ON = 0x20
NODE_CLIP_X1 = 0x21
NODE_CLIP_X2 = 0x23
NODE_CLIP_Y1 = 0x25
NODE_CLIP_Y2 = 0x27
TEXT_COLOR = 0x1EA0
FILL = 0x1EAC
BACKGROUND = 0x1EAD
FOREGROUND = 0x1EAE
PALETTE_EFFECTS = 0x1EBF
MATRIX_LOADED = 0x2640
BUFFER_COUNT = 0x2641
KEEP_DRAWINGS = 0x27C0
CALL_DEPTH = 0x27C2
BACKGROUND_AGE = 0x287A
WALK_BITMAPS = 0x30D2
MIRROR_FLAG = 0x4106
PURGE = 0x4642
GOTO = 0x4644
PENDING_PALETTE = 0x4646
MIRROR_NEXT_LOAD = 0x46D6
ISLAND_Y = 0x46E2
ISLAND_X = 0x46E4
DELAY = 0x46E6
TRACE_ISLAND_X = 7
TRACE_ISLAND_Y = 5
RANDOM_MULTIPLIER = 25173
RANDOM_INCREMENT = 13849
PALETTE_BYTES = 48
SURFACES = {DC_A: 0, DC_B: 1, DC_C: 2}


class TtmTracer:
    def __init__(self, image: NeImage, resources: dict[str, bytes], name: str):
        self.name = name.upper()
        self.resources = {key.upper(): value for key, value in resources.items()}
        self.emu: Emulator = new_loader_emulator(image, {self.name: self.resources[self.name]})
        self.events: list[list[object]] = []
        self.random_calls = 0
        self.images: dict[int, tuple[str, int]] = {}
        self.palettes: dict[int, str] = {}
        self.pages = self._load()
        self._set_globals()
        self.node = self._new_thread()
        self._install_hooks()

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _byte(self, offset: int) -> int:
        return self.emu.read(self.emu.data_segment, offset, 1)[0]

    def _load(self) -> list[int]:
        emu, data = self.emu, self.emu.data_segment
        emu.write(data, TTM_GLOBALS, bytes(TTM_GLOBALS_SIZE))
        loaded = emu.call_far(LOAD_TTM, stack_words=[put_string(emu, self.name)])["ax"]
        if loaded != 1:
            raise RuntimeError(f"{self.name}: TTM load returned {loaded:#x}")
        record, segment = self._word(CURRENT_TTM), self._word(CURRENT_TTM + 2)
        emu.write(segment, record, struct.pack("<H", TTM_ID))
        emu.call_far(INDEX_TTM_PAGES, stack_words=[TTM_ID])
        count = read_word(emu, segment, record + RECORD_PAGE_COUNT)
        table, table_segment = read_word(emu, segment, record + RECORD_PAGE_TABLE), read_word(emu, segment, record + RECORD_PAGE_TABLE + 2)
        return [page for page in range(count) if read_word(emu, table_segment, table + 4 * page) or read_word(emu, table_segment, table + 4 * page + 2)]

    def _set_globals(self):
        emu = self.emu
        set_byte(emu, COLOR_MODE, SIXTEEN_COLOR_MODE)
        set_byte(emu, MATRIX_LOADED, 0)
        set_byte(emu, PALETTE_EFFECTS, 0)
        set_byte(emu, FILL, 1)
        words = {
            SCREEN_WIDTH: 640,
            SCREEN_HEIGHT: 480,
            BUFFER_COUNT: 4,
            BACKGROUND_AGE: 0,
            KEEP_DRAWINGS: 0,
            CALL_DEPTH: 0,
            ISLAND_X: TRACE_ISLAND_X,
            ISLAND_Y: TRACE_ISLAND_Y,
            MIRROR_NEXT_LOAD: 0,
            MIRROR_FLAG: 0,
            PENDING_PALETTE: 0,
            PENDING_PALETTE + 2: 0,
            **DC_GLOBALS,
        }
        for address, value in words.items():
            set_word(emu, address, value)
        set_word(emu, WALK_BITMAPS, self._bitmap_list("JOHNWALK.BMP"))

    def _new_thread(self) -> int:
        emu = self.emu
        node = emu.near_alloc(THREAD_SIZE)
        emu.write(emu.data_segment, node, bytes(THREAD_SIZE))
        set_word(emu, CURRENT_THREAD, node)
        emu.call_far(RESET_THREAD, stack_words=[node])
        set_word(emu, node, TTM_ID)
        return node

    def _bitmap_list(self, name: str) -> int:
        payload = self.resources.get(name.upper())
        if payload is None:
            return 0
        info = next(found for found in walk_chunks(payload) if found.path == "BMP:INF:")
        (count,) = struct.unpack_from("<H", payload, info.body_offset)
        widths = struct.unpack_from(f"<{count}H", payload, info.body_offset + 2)
        heights = struct.unpack_from(f"<{count}H", payload, info.body_offset + 2 + 2 * count)
        emu, data = self.emu, self.emu.data_segment
        records = emu.near_alloc(RECORD_SIZE * count)
        emu.write(data, records, bytes(RECORD_SIZE * count))
        table = emu.near_alloc(2 * (count + 1))
        for index in range(count):
            record = records + RECORD_SIZE * index
            emu.write(data, record + RECORD_WIDTH, struct.pack("<H", widths[index]))
            emu.write(data, record + RECORD_HEIGHT, struct.pack("<H", heights[index]))
            emu.write(data, table + 2 * index, struct.pack("<H", record))
            self.images[record] = (name.upper(), index)
        emu.write(data, table + 2 * count, struct.pack("<H", 0))
        return table

    def _surface(self, value: int) -> int:
        return SURFACES.get(value, signed(value))

    def _target(self) -> int:
        return self._surface(self._word(TARGET_DC))

    def _source(self) -> int:
        return self._surface(self._word(SOURCE_DC))

    def _clip(self) -> list[int]:
        return [self._byte(CLIP_ON), *(signed(self._word(address)) for address in (CLIP_X1, CLIP_Y1, CLIP_X2, CLIP_Y2))]

    def _args(self, first: int, count: int) -> list[int]:
        return [signed(self.emu.arg(first + i)) for i in range(count)]

    def _event(self, *values: object):
        self.events.append(list(values))

    def _install_hooks(self):
        hooks = {
            "1040:0d54": self._pixel,
            "1030:02ef": self._line,
            "1038:1bd8": self._rect,
            "1040:0688": self._circle,
            "1028:17d8": self._sprite,
            "1030:03d7": self._stretch,
            "1038:06ce": self._copy,
            "1060:007e": self._dirty,
            "1060:06ac": self._drop,
            "1030:01c4": self._save,
            "1030:0250": self._restore,
            "1028:1813": self._screen,
            "1028:17fa": self._bitmaps,
            "1040:09eb": self._palette,
            "1020:00ba": self._sound,
            "1018:1e60": self._random,
            "1040:0b08": self._select_palette,
            "1028:1845": self._quiet,
            "1040:0bc7": self._quiet,
            "1020:081c": self._quiet,
        }
        for address, handler in hooks.items():
            self.emu.replace_function(address, handler)

    def _pixel(self, emu: Emulator):
        self._event("pixel", self._target(), *self._args(0, 3), *self._clip())
        return {"ax": 0}

    def _line(self, emu: Emulator):
        self._event("line", self._target(), *self._args(0, 4), self._byte(FOREGROUND), *self._clip())
        return {"ax": 0}

    def _rect(self, emu: Emulator):
        self._event("rect", self._target(), *self._args(0, 4), self._byte(FILL), self._byte(FOREGROUND), self._byte(BACKGROUND), *self._clip())
        return {"ax": 0}

    def _circle(self, emu: Emulator):
        self._event("circle", self._target(), *self._args(0, 3), self._byte(FILL), self._byte(FOREGROUND), self._byte(BACKGROUND), *self._clip())
        return {"ax": 0}

    def _sprite(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("sprite", self._target(), name, index, *self._args(1, 3), *self._clip())
        return {"ax": 0}

    def _stretch(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("stretch", self._target(), name, index, *self._args(1, 5), *self._clip())
        return {"ax": 0}

    def _copy(self, emu: Emulator):
        self._event("copy", self._source(), self._target(), *self._args(0, 4))
        return {"ax": 0}

    def _dirty(self, emu: Emulator):
        x, y, w, h, kind = self._args(0, 5)
        if kind != 1:
            raise RuntimeError(f"{self.name}: dirty rect of kind {kind}")
        self._event("dirty", self._surface(emu.arg(5)), self._surface(emu.arg(6)), signed(emu.arg(7)), x, y, w, h, *self._clip())
        return {"ax": 0}

    def _drop(self, emu: Emulator):
        self._event("drop", self._surface(emu.arg(0)), self._surface(emu.arg(1)), signed(emu.arg(2)))
        return {"ax": 0}

    def _save(self, emu: Emulator):
        self._event("save", self._source(), *self._args(2, 4))
        return {"ax": 0}

    def _restore(self, emu: Emulator):
        self._event("restore", self._target(), *self._args(2, 4))
        return {"ax": 0}

    def _screen(self, emu: Emulator):
        self._event("screen", self._target(), c_string(emu, emu.arg(0)))
        return {"ax": 1}

    def _bitmaps(self, emu: Emulator):
        name = c_string(emu, emu.arg(0))
        self._event("bitmaps", name, self._word(MIRROR_FLAG))
        return {"ax": self._bitmap_list(name)}

    def _palette(self, emu: Emulator):
        name = c_string(emu, emu.arg(0))
        self._event("palette", name)
        if name.upper() not in self.resources:
            return {"ax": 0}
        pointer = emu.near_alloc(PALETTE_BYTES)
        self.palettes[pointer] = name.upper()
        return {"ax": pointer}

    def _sound(self, emu: Emulator):
        self._event("sound", signed(emu.arg(0)))
        return {"ax": 0}

    def _random(self, emu: Emulator):
        value = (self.random_calls * RANDOM_MULTIPLIER + RANDOM_INCREMENT) & 0xFFFF
        self.random_calls += 1
        self._event("random")
        return {"ax": value}

    def _select_palette(self, emu: Emulator):
        self._event("selectPalette", self.palettes.get(emu.arg(0), "-"))
        return {"ax": emu.arg(0)}

    def _quiet(self, emu: Emulator):
        return {"ax": 0}

    def _enter(self, replay: int):
        emu, node = self.emu, self.node
        set_word(emu, node + NODE_RAN, replay)
        foreground = self._byte(node + NODE_FOREGROUND)
        set_byte(emu, TEXT_COLOR, foreground)
        set_byte(emu, FOREGROUND, foreground)
        set_byte(emu, BACKGROUND, self._byte(node + NODE_BACKGROUND))
        for address, field in ((CLIP_X1, NODE_CLIP_X1), (CLIP_Y1, NODE_CLIP_Y1), (CLIP_X2, NODE_CLIP_X2), (CLIP_Y2, NODE_CLIP_Y2)):
            set_word(emu, address, self._word(node + field))
        set_byte(emu, CLIP_ON, self._byte(node + NODE_CLIP_ON))
        set_word(emu, PURGE, 0)
        set_word(emu, DELAY, 0xFFFF)

    def _pending_palette(self) -> str:
        if self._word(PENDING_PALETTE) == 0 and self._word(PENDING_PALETTE + 2) == 0:
            return "-"
        return self.palettes.get(self._word(PENDING_PALETTE), "?")

    def _thread(self) -> list[int]:
        node = self.node
        clip = [signed(self._word(node + field)) for field in (NODE_CLIP_X1, NODE_CLIP_Y1, NODE_CLIP_X2, NODE_CLIP_Y2)]
        slots = [self._word(node + field) for field in (NODE_BMP_SLOT, NODE_PALETTE_SLOT, NODE_ZONE_SLOT)]
        return [self._byte(node + NODE_FOREGROUND), self._byte(node + NODE_BACKGROUND), self._byte(node + NODE_CLIP_ON), *clip, *slots]

    def trace(self) -> list[list[object]]:
        rows: list[list[object]] = []
        for page in self.pages:
            for replay, run in ((0, "first"), (1, "replay")):
                self.events = []
                self._enter(replay)
                ran = self.emu.call_far(RUN_PAGE, stack_words=[page])["ax"]
                self._event("result", ran, signed(self._word(DELAY)), signed(self._word(GOTO)), self._word(PURGE), self._pending_palette(), self._word(MIRROR_NEXT_LOAD), self._word(KEEP_DRAWINGS))
                self._event("thread", *self._thread())
                rows.extend([self.name, page, run, event[0], " ".join(str(value) for value in event[1:])] for event in self.events)
        return rows
```

If an address in `_install_hooks` turns out (from step 2) to take its arguments in another order, fix the handler, not the trace format: the format describes the callee's meaning, not its stack layout.

- [x] **Action 4: Run the test**

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_ttm.py`
Expected: no output.

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_ttm.py' -v`
Expected: 4 tests pass. If `test_draws_a_line...` differs, compare the row with the overview's facts and step 2's findings before touching the expectation: the expectation was derived by hand from `1058:0608` (island offset on both corners), `1058:119e` (dirty `min x, min y, abs(dx) + 8, abs(dy) + 2`), and `1050:0a85`.

- [x] **Action 5: Commit**

```bash
git add scripts/re/unicorn/original_ttm.py scripts/re/unicorn/test_original_ttm.py
git commit -m "test(re): trace the original TTM page runner"
```

## Part B: The corpus trace

- [x] **Action 6: Write the dump script**

Create `scripts/re/unicorn/dump_ttm.py`:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_ttm import TtmTracer  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/ttm"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    rows: list[list[object]] = []
    for name in sorted(name for name in resources if name.upper().endswith(".TTM")):
        tracer = TtmTracer(image, resources, name)
        traced = tracer.trace()
        rows.extend(traced)
        print(f"{name}: {len(tracer.pages)} pages, {len(traced)} rows", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["ttm\tpage\tpass\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [x] **Action 7: Run it**

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_ttm.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py`
Expected: 41 lines on stderr, one per TTM, and `re/fixtures/ttm/traces.tsv` exists. The page counts match the `PAG:` counts (the `finds every page PAG: announces` test in `src/decode/ttm-loader.data.test.ts` already pins that every page is indexed).

If a TTM raises: an `UnstubbedImport` names a Windows call a used opcode reaches that step 2 missed (add a hook, with a trace event only if the call matters for the picture, and add the event to `docs/re/ttm.md`); an `EmulationLimit` means a page loops (read the case and tell the user, do not raise the limit blindly); `RuntimeError: dirty rect of kind N` means a used opcode adds a kind other than 1 (extend the format in `docs/re/ttm.md` and in `step-004`'s recorder via a leftovers entry if you cannot fix it here).

Sanity checks on the fixture:

Run: `rg -c "\tsprite\t" re/fixtures/ttm/traces.tsv`
Expected: a large number (at least 2 × 15,368, the `0xa504` + `0xa524` uses, minus those whose BMP slot is empty at that point).

Run: `rg "\tsound\t" re/fixtures/ttm/traces.tsv`
Expected: only `first` rows, never `replay`.

- [x] **Action 8: Write the findings and docs**

In `docs/re/ttm.md`, replace the `Emulated` placeholder line with bullets:

- What runs as original code and what is replaced (the hook list, in words).
- The fixture: `re/fixtures/ttm/traces.tsv`, every page of the 41 TTM scripts, first run and replay, with island offset `(7, 5)` and the fixed random sequence.
- Any surprise Action 7 turned up (with addresses).
- `Step 4 compares our runner with this trace (src/ttm/page-runner.data.test.ts).`

In `scripts/re/unicorn/README.md`, add a section:

```markdown
## Original TTM page runner

    re/.venv/bin/python -I scripts/re/unicorn/dump_ttm.py

Loads each TTM script with the original loader, resets one thread node with `1048:0b3e`, and runs every page twice through `1050:074a` (first run, then replay with the thread's ran flag set). Drawing, copying, dirty-rect, zone, loading, sound, and random calls are replaced by handlers that write one trace row each (`original_ttm.py`); everything else runs as original code. Writes `re/fixtures/ttm/traces.tsv` (gitignored). The row format is documented in `docs/plans/2026-10-17-re-ttm/step-000-overview.md`, `Trace format`, and in `docs/re/ttm.md`, `Emulated`.
```

Also add the row format table from the overview's `Trace format` to `docs/re/ttm.md`, `Emulated`, so the committed docs carry it.

- [x] **Action 9: Run all Unicorn tests**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

- [x] **Action 10: Commit**

```bash
git add scripts/re/unicorn/dump_ttm.py scripts/re/unicorn/README.md docs/re/ttm.md
git commit -m "test(re): trace every page of every TTM script in the original"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
