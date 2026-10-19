# Step 2: Original Walk Trace

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-walk-findings.md`

**Files:**

- Create: `scripts/re/unicorn/original_walk.py`, `scripts/re/unicorn/dump_walk.py`, `scripts/re/unicorn/test_original_walk.py`
- Modify: `scripts/re/unicorn/README.md` (one section), `docs/re/walk.md` (section `Emulated`)
- Local only (gitignored): `re/fixtures/walk/walk-data.bin`, `re/fixtures/walk/traces.tsv`

**Interfaces:**

- Consumes: `IslandTracer` and its constants from `original_island.py`, `WALK_BITMAPS` from `original_ttm.py`, `set_word`, `set_byte`, `signed`, `CLIP_*` from `original_graphics.py`, `read_word` from `original_loaders.py`, `load_resources` from `corpus.py` (see the overview's `Shared pieces`). The trace format is the overview's `Trace format`.
- Produces:
  - `re/fixtures/walk/walk-data.bin`: the data segment bytes `1068:02e1` up to (not including) `1068:1660`, 4991 bytes. Step 3 generates and pins `src/walk/walk-tables.ts` from it.
  - `re/fixtures/walk/traces.tsv`: the trace of the overview's `Trace format`, 36 cases. Step 4 compares its port with it.
  - `original_walk.py`: `WalkTracer(image, resources)` with `trace_case(k) -> list[list[object]]`, `walk_data_bytes(image) -> bytes`, constants `CASES = 36`, `LEGS = 6`, `WALK_DATA = (0x02E1, 0x1660)`, `ROUTE_OF`, `SEGMENT_FRAMES`.

Everything runs as original code except the recorders `IslandTracer` already installs (`1030:124a`, `1030:16d8`, `1038:1bd8`, `1038:0ae4`, `1038:0ac2`, `1030:02ef`, `1038:06ce`, `1060:007e`, `1060:04b2`, `1020:081c`). The random generator (`1018:1e60`) is the original: `IslandTracer` does not hook it.

- [x] **Action 1: Write the tracer**

Create `scripts/re/unicorn/original_walk.py`:

```python
from emulator import Emulator
from ne_image import NeImage
from original_graphics import CLIP_ON, CLIP_X1, CLIP_X2, CLIP_Y1, CLIP_Y2, set_byte, set_word, signed
from original_island import (
    CLOCK_TICK,
    DISCARD_RANDOM,
    DRAW_ISLAND,
    HOLIDAY,
    HOLIDAY_SHOWN,
    LOW_TIDE,
    MODE,
    NO_RAFT,
    NUM_DAYS,
    PLACE,
    RANDOM_WRITE_INDEX,
    SETTING_BACKGROUND,
    SETTING_CLOUDS,
    SETTING_WAVES,
    SLOT,
    SPEED,
    STILL,
    IslandTracer,
)
from original_ttm import WALK_BITMAPS

LOAD_WALK = "1018:0000"
RESET_WALK = "1018:0074"
WALK_STEP = "1018:0094"
ROUTE_OF = "1018:03ac"
SEGMENT_FRAMES = "1018:03ea"
IS_AT_SPOT = "1018:0b46"

WALK_DATA = (0x02E1, 0x1660)
SEGMENT_COUNT = 34
SPOTS = 6
HEADINGS = 8
RECORD_BYTES = 6

SPOT = 0x30E2
HEADING = 0x30DE
TARGET_SPOT = 0x30E0
TARGET_HEADING = 0x30DC
WANTED_HEADING = 0x30C8
SEGMENT_HEADING = 0x30CC
SEGMENT_SPOT = 0x30CA
ROUTE = 0x30D0
SEGMENT = 0x30CE
FRAME = 0x30C6
DELAY = 0x30D4

CASES = 36
LEGS = 6
IDLE_BEATS = 8
LEG_BEATS = 1500
STEP_MS = 50
TICK_MS = 16
DISCARD_STEP = 1009


def walk_data_bytes(image: NeImage) -> bytes:
    data = next(segment for segment in image.segments if segment.index == image.auto_data_segment).data
    return data[WALK_DATA[0]:WALK_DATA[1]]


def beat_ticks(beat: int) -> int:
    return (STEP_MS * (beat + 1)) // TICK_MS - (STEP_MS * beat) // TICK_MS


def leg_target(k: int, leg: int) -> tuple[int, int]:
    spot = 1 + k % SPOTS if leg == 0 else (k + 3 * leg) % (SPOTS + 1)
    return spot, (3 * k + 5 * leg + 1) % HEADINGS


def scene_end(k: int, leg: int) -> tuple[int, int]:
    return 1 + (k + leg) % SPOTS, (2 * k + leg) % HEADINGS


class WalkTracer(IslandTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes]):
        super().__init__(image, resources)
        self.beat = 0
        emu = self.emu
        self.routes: dict[int, tuple[int, int]] = {}
        for start in range(1, SPOTS + 1):
            for target in range(1, SPOTS + 1):
                pointer = emu.call_far(ROUTE_OF, stack_words=[target, start])["ax"]
                if pointer:
                    self.routes[pointer] = (start, target)
        self.segments: list[tuple[int, int, int]] = []
        for segment in range(1, SEGMENT_COUNT + 1):
            base = emu.call_far(SEGMENT_FRAMES, stack_words=[segment])["ax"]
            count = 0
            while any(self._word(base + RECORD_BYTES * count + 2 * i) for i in range(3)):
                count += 1
            self.segments.append((segment, base, count))

    def _pointer(self, address: int) -> str:
        if address == 0:
            return "0"
        for segment, base, count in self.segments:
            if base <= address < base + RECORD_BYTES * count and (address - base) % RECORD_BYTES == 0:
                return f"{segment}:{(address - base) // RECORD_BYTES}"
        raise RuntimeError(f"walk pointer {address:#x} is not a frame record")

    def _route(self) -> str:
        pointer = self._word(ROUTE)
        if pointer == 0:
            return "0"
        start, target = self.routes[pointer]
        return f"{start},{target}"

    def _walk_state(self) -> list[object]:
        def word(address: int) -> int:
            return signed(self._word(address))

        return [
            word(SPOT), word(HEADING), word(TARGET_SPOT), word(TARGET_HEADING), word(WANTED_HEADING),
            word(SEGMENT_HEADING), word(SEGMENT_SPOT), self._route(), self._pointer(self._word(SEGMENT)),
            self._pointer(self._word(FRAME)), word(DELAY), self._word(RANDOM_WRITE_INDEX),
        ]

    def _rows(self, k: int, beat: int) -> list[list[object]]:
        rows = [[k, beat, event[0], " ".join(str(value) for value in event[1:])] for event in self.events]
        rows.append([k, beat, "state", " ".join(str(value) for value in self._walk_state())])
        self.events.clear()
        return rows

    def _start_beat(self) -> int:
        for _ in range(beat_ticks(self.beat)):
            self.emu.call_far(CLOCK_TICK)
        self.beat += 1
        return self.beat - 1

    def _set_up(self, k: int):
        emu = self.emu
        words = {
            MODE: 0, PLACE: 0xFFFF, LOW_TIDE: k % 2, STILL: 0, NO_RAFT: 0, HOLIDAY_SHOWN: 1, HOLIDAY: 0, SLOT: 0,
            SETTING_BACKGROUND: 1, SETTING_CLOUDS: 1, SETTING_WAVES: 1, SPEED: 0,
        }
        for address, value in words.items():
            set_word(emu, address, value)
        set_byte(emu, NUM_DAYS, 1)
        set_byte(emu, CLIP_ON, 0)
        for address, value in ((CLIP_X1, 0), (CLIP_Y1, 0), (CLIP_X2, 639), (CLIP_Y2, 479)):
            set_word(emu, address, value)
        emu.call_far(DISCARD_RANDOM, stack_words=[DISCARD_STEP * k])
        self.overlap_calls = 0
        emu.call_far(DRAW_ISLAND)
        set_word(emu, WALK_BITMAPS, 0)
        emu.call_far(LOAD_WALK)
        set_word(emu, SPOT, 1 + k // SPOTS)
        set_word(emu, HEADING, k % HEADINGS)
        self.events.clear()

    def trace_case(self, k: int) -> list[list[object]]:
        emu: Emulator = self.emu
        self._set_up(k)
        rows = self._rows(k, -1)
        self.beat = 0
        for leg in range(LEGS):
            if leg % 2 == 1:
                spot, heading = scene_end(k, leg)
                set_word(emu, SPOT, spot)
                set_word(emu, HEADING, heading)
            elif leg > 0:
                for i in range(IDLE_BEATS):
                    beat = self._start_beat()
                    if i == 0:
                        self._event("reset", leg)
                        emu.call_far(RESET_WALK)
                    emu.call_far(WALK_STEP)
                    rows.extend(self._rows(k, beat))
            spot, heading = leg_target(k, leg)
            arrived = False
            for _ in range(LEG_BEATS):
                beat = self._start_beat()
                arrived = emu.call_far(IS_AT_SPOT, stack_words=[heading & 0xFFFF, spot])["ax"] == 1
                self._event("at", leg, spot, heading, 1 if arrived else 0)
                if not arrived:
                    emu.call_far(WALK_STEP)
                rows.extend(self._rows(k, beat))
                if arrived:
                    break
            if not arrived:
                rows.append([k, self.beat - 1, "stuck", leg])
        return rows
```

`self._word(address)` (unsigned data-segment word) and `self._event(*values)` (appends to `self.events`) come from `TtmTracer` in `original_ttm.py`.

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_walk.py`
Expected: no output.

- [x] **Action 2: Write the failing tests**

Create `scripts/re/unicorn/test_original_walk.py`:

```python
import unittest
from pathlib import Path

from corpus import load_resources
from ne_image import NeImage
from original_graphics import signed
from original_loaders import read_word
from original_walk import LEGS, ROUTE_OF, SEGMENT_FRAMES, WALK_DATA, WalkTracer, walk_data_bytes

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
TRACED = (0, 7, 23, 35)


def values(row: list[object]) -> list[str]:
    return str(row[3]).split(" ")


@unittest.skipUnless((DATA / "SCRANTIC.SCR").exists() and (DATA / "RESOURCE.MAP").exists(), "needs public/data")
class WalkTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(DATA / "SCRANTIC.SCR")
        cls.resources = {resource.name: resource.payload for resource in load_resources(DATA)}
        cls.tracer = WalkTracer(cls.image, cls.resources)
        cls.rows = [row for k in TRACED for row in WalkTracer(cls.image, cls.resources).trace_case(k)]

    def beats(self) -> dict[tuple[int, int], list[list[object]]]:
        grouped: dict[tuple[int, int], list[list[object]]] = {}
        for row in self.rows:
            grouped.setdefault((int(row[0]), int(row[1])), []).append(row)
        return grouped

    def test_the_walk_tables_are_one_block(self):
        # SCRANTIC 1068:02e1 1068:0355
        data = walk_data_bytes(self.image)
        self.assertEqual(len(data), WALK_DATA[1] - WALK_DATA[0])
        self.assertEqual(data[0x355 - WALK_DATA[0]:0x362 - WALK_DATA[0]], b"JOHNWALK.BMP\0")

    def test_frame_lists_follow_each_other_from_0aea(self):
        # SCRANTIC 1018:03ea
        emu = self.tracer.emu
        self.assertEqual(emu.call_far(SEGMENT_FRAMES, stack_words=[0])["ax"], 0)
        self.assertEqual(emu.call_far(SEGMENT_FRAMES, stack_words=[35])["ax"], 0)
        at = 0xAEA
        for segment, base, count in self.tracer.segments:
            self.assertEqual(base, at, f"segment {segment}")
            at = base + 6 * (count + 1)
        self.assertEqual(at, WALK_DATA[1])

    def test_routes_follow_each_other_from_0362(self):
        # SCRANTIC 1018:03ac
        emu = self.tracer.emu
        at = 0x362
        for start in range(7):
            for target in range(7):
                pointer = emu.call_far(ROUTE_OF, stack_words=[target, start])["ax"]
                if start == 0 or target == 0 or start == target:
                    self.assertEqual(pointer, 0, f"{start},{target}")
                    continue
                self.assertEqual(pointer, at, f"{start},{target}")
                while signed(read_word(emu, emu.data_segment, at)) != -7:
                    at += 2
                at += 2
        self.assertEqual(at, 0xAA2)

    def test_every_leg_ends_with_johnny_at_the_target(self):
        # SCRANTIC 1018:0094 1018:0b46
        self.assertEqual([row for row in self.rows if row[2] == "stuck"], [])
        for rows in self.beats().values():
            for row in rows:
                if row[2] == "at" and values(row)[3] == "1":
                    _, spot, heading, _ = values(row)
                    state = values(rows[-1])
                    if spot != "0":
                        self.assertEqual(state[0], spot)
                    self.assertEqual(state[1], heading)
        self.assertEqual(sum(1 for row in self.rows if row[2] == "at" and values(row)[3] == "1"), len(TRACED) * LEGS)

    def test_a_drawn_frame_adds_three_rects_of_its_size_and_sets_the_delay(self):
        # SCRANTIC 1018:0094
        drawn = 0
        for rows in self.beats().values():
            sprites = [values(row) for row in rows if row[2] == "sprite" and values(row)[1] == "JOHNWALK.BMP"]
            if not sprites:
                continue
            drawn += 1
            self.assertEqual(len(sprites), 1)
            x, y = sprites[0][3], sprites[0][4]
            dirty = [values(row) for row in rows if row[2] == "dirty"]
            self.assertEqual([d[:3] for d in dirty], [["1", "0", "0"], ["1", "0", "1"], ["2", "1", "0"]])
            self.assertTrue(all(d[3:5] == [x, y] for d in dirty))
            self.assertEqual(len({tuple(d[5:7]) for d in dirty}), 1)
            self.assertEqual(values(rows[-1])[10], "4")
        self.assertGreater(drawn, 100)
```

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_walk.py' -v`
Expected: all pass. Read every failure before changing anything: a failure is either a harness bug (fix the harness) or a finding (the original does something the overview or `walk.md` did not say: fix `walk.md` and note it for the commit). Do not weaken a test to make it pass. A `stuck` leg is a finding too: look at its rows, say in `walk.md` why it does not end, and keep it in the trace (the port must match it); then change only the stuck assertion to check that the stuck legs are the ones `walk.md` names.

- [x] **Action 3: Write the dump script**

Create `scripts/re/unicorn/dump_walk.py`:

```python
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_walk import CASES, WalkTracer, walk_data_bytes  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/walk"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "walk-data.bin").write_bytes(walk_data_bytes(image))
    rows: list[list[object]] = []
    for k in range(CASES):
        started = time.monotonic()
        traced = WalkTracer(image, resources).trace_case(k)
        rows.extend(traced)
        print(f"case {k}: {len(traced)} rows, {time.monotonic() - started:.1f}s", file=sys.stderr)
    lines = ["case\tbeat\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/dump_walk.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_walk.py`
Expected: exits 0, one line per case; `re/fixtures/walk/walk-data.bin` is 4991 bytes; `re/fixtures/walk/traces.tsv` exists.

- [x] **Action 4: Count the trace**

Run: `cut -f3 re/fixtures/walk/traces.tsv | sort | uniq -c`
Note the row count of each event and the total (for `walk.md`). `stuck` should not appear (see Action 2).

Run: `rg -c "BACKGRND.BMP 13 " re/fixtures/walk/traces.tsv`
Note the count: the palm trunk redrawn over Johnny (`1010:1551` mode 0). It should be above 0, on routes that pass behind the palm.

- [x] **Action 5: Document the harness**

Add to `scripts/re/unicorn/README.md`, after the `Original island` section:

```markdown
## Original walk

    re/.venv/bin/python -I scripts/re/unicorn/dump_walk.py

Runs the original walk step (`1018:0094`) with the original route choice, turns, and random generator for 36 cases (every start and target spot pair), each with six legs toward targets set through `1018:0b46`, idle stretches (`1018:0074`), and Johnny moved between legs as an ADS entry would. The island is drawn first with the original code so the island offset and the palm trunk redraw (`1010:1551`) are real. Drawing and dirty-list calls use the recorders of `original_island.py` (`WalkTracer` extends `IslandTracer`). Writes `re/fixtures/walk/` (gitignored): `walk-data.bin` (the walk tables, `1068:02e1`..`165f`) and `traces.tsv`, which `src/walk/walk-tables.data.test.ts` and `src/walk/walk.data.test.ts` compare with the TypeScript port. Format: `docs/plans/2026-10-18-re-walk/step-000-overview.md`, `Trace format`, and `docs/re/walk.md`, `Emulated`.
```

Add a section `Emulated` to `docs/re/walk.md`, before `Side-by-side checklist`, in the style of `docs/re/island.md`, `Emulated`: what runs as original code, what is recorded and replaced, the case and leg rules (copy them from the overview's `Trace format`, in our words), the `state` row, what `test_original_walk.py` pins, the row counts from Action 4, and anything observed (for example: how many beats the longest leg took, whether the trunk redraw shows up, how often a segment is picked versus a turn).

- [x] **Action 6: Run every Unicorn test and commit**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_*.py' -v`
Expected: all pass.

```bash
git add scripts/re/unicorn/original_walk.py scripts/re/unicorn/dump_walk.py scripts/re/unicorn/test_original_walk.py scripts/re/unicorn/README.md docs/re/walk.md
git commit -m "test(re): trace the original walk step in Unicorn"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
