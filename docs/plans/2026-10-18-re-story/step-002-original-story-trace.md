# Step 2: Original Story Trace

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-001-story-findings.md`

**Files:**

- Create: `scripts/re/unicorn/original_story.py`, `scripts/re/unicorn/dump_story.py`, `scripts/re/unicorn/test_original_story.py`
- Modify: `scripts/re/unicorn/README.md` (new section), `docs/re/story.md` (new section `Emulated`)
- Local only (gitignored): `re/fixtures/story/sequences.tsv`, `re/fixtures/story/random.tsv`, `re/fixtures/story/scene-table.bin`, `re/fixtures/story/random-table.bin`

**Interfaces:**

- Consumes: `docs/re/story.md` (step 1), the overview's `Trace formats` (`Sequences`, `Random`), `Emulator` (`call_far`, `replace_function`, `arg`, `read`, `write`, `data_segment`), `NeImage`, `set_word`, `set_byte`, `signed` (`original_graphics.py`), `read_word` (`original_loaders.py`).
- Produces:
  - `original_story.py`: `StoryTracer(image)` with `trace_case(k) -> list[list[object]]`; `random_rows(image) -> list[list[object]]`; `table_bytes(image) -> tuple[bytes, bytes]`; constants `CASES = 16`, `BUILDS = 30`, `DISCARDS`, `START_TIMES`, `FIRST_DATES`, `PERCENT_LISTS`, `build_clock(k, b) -> datetime`.
  - Fixtures (gitignored) read by step 3: `re/fixtures/story/sequences.tsv`, `random.tsv` (formats in the overview), `scene-table.bin` (the 80 entries plus the 0 terminator word, 1362 bytes from `1068:1756`), `random-table.bin` (116 bytes from `1068:1ce4`: the two indices, then the 56 words).

The original sequence builder runs as original code with the original random generator. Only drawing, the wipe, the ADS unload, the debug log, and the DOS date and time calls are replaced. If `docs/re/story.md` names a call inside `1018:0540` that this list misses and that touches memory outside the data segment, replace it too and say so in `Emulated`.

- [ ] **Action 1: Write the failing harness test**

Create `scripts/re/unicorn/test_original_story.py`:

```python
import struct
import unittest
from pathlib import Path

from ne_image import NeImage
from original_story import (
    BUILDS,
    DISCARDS,
    PERCENT_LISTS,
    SCENE_COUNT,
    SCENE_SIZE,
    START_TIMES,
    StoryTracer,
    build_clock,
    random_rows,
    table_bytes,
)

REPO = Path(__file__).resolve().parents[3]
BINARY = REPO / "public/data/SCRANTIC.SCR"


def python_generator(table_bytes_: bytes):
    read, write = struct.unpack_from("<HH", table_bytes_, 0)
    table = list(struct.unpack_from("<56H", table_bytes_, 4))

    def draw() -> int:
        nonlocal read, write
        at = write
        table[at] = (table[at] + table[read]) & 0xFFFF
        write = (write + 1) % 56
        read = (read + 1) % 56
        return table[at]

    return draw


def half_hour_slot(hhmm: int) -> int:
    return (hhmm // 50 + (hhmm % 100) // 30 + 14) % 16


@unittest.skipUnless(BINARY.exists(), "needs public/data/SCRANTIC.SCR")
class StoryTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.image = NeImage.load(BINARY)
        cls.scenes, cls.random_table = table_bytes(cls.image)
        cls.random = random_rows(cls.image)
        cls.case0 = StoryTracer(cls.image).trace_case(0)

    def test_table_dumps_have_the_expected_sizes(self):
        self.assertEqual(len(self.scenes), SCENE_COUNT * SCENE_SIZE + 2)
        self.assertEqual(self.scenes[-2:], b"\0\0")
        self.assertEqual(len(self.random_table), 4 + 56 * 2)

    def test_the_generator_is_an_additive_lagged_fibonacci(self):
        # SCRANTIC 1018:1e60
        draw = python_generator(self.random_table)
        expected = [draw() for _ in range(300)]
        self.assertEqual([row[3] for row in self.random if row[0] == "next" and row[1] == 0], expected)

    def test_discarding_skips_values(self):
        # SCRANTIC 1018:1eb6
        draw = python_generator(self.random_table)
        for _ in range(55):
            draw()
        self.assertEqual([row[3] for row in self.random if row[0] == "next" and row[1] == 55][:20], [draw() for _ in range(20)])

    def test_percent_pick_walks_the_weights(self):
        # SCRANTIC 1018:1ef5
        draw = python_generator(self.random_table)
        for weights in PERCENT_LISTS:
            kind = "percent:" + ",".join(map(str, weights))
            for row in (row for row in self.random if row[0] == kind):
                value, result = draw(), 0
                for i, weight in enumerate(weights, start=1):
                    t = (weight * 0x28F) & 0xFFFF
                    if t > value:
                        result = i
                        break
                    value -= t
                self.assertEqual(row[3], result, f"{kind} call {row[2]}")

    def test_every_build_writes_a_queue_and_a_state_row(self):
        # SCRANTIC 1018:0540
        self.assertEqual([(row[1], row[2]) for row in self.case0], [(b, event) for b in range(BUILDS) for event in ("queue", "state")])

    def test_queue_entries_are_table_indices_and_johnny_starts_at_the_first(self):
        # SCRANTIC 1018:089b 1018:0540
        for queue, state in zip(self.case0[0::2], self.case0[1::2]):
            indices = [int(value) for value in queue[3].split(" ")]
            self.assertTrue(all(1 <= index < SCENE_COUNT for index in indices), queue)
            first = self.scenes[SCENE_SIZE * indices[0]:SCENE_SIZE * (indices[0] + 1)]
            values = [int(value) for value in state[3].split(" ")]
            self.assertEqual(values[13:15], [struct.unpack_from("b", first, 3)[0], struct.unpack_from("b", first, 4)[0]])

    def test_slot_follows_the_wall_clock_and_start_time(self):
        # SCRANTIC 1018:0540 1018:0c21
        for state in self.case0[1::2]:
            clock = build_clock(0, state[1])
            hhmm = clock.hour * 100 + (30 if clock.minute >= 30 else 0)
            expected = (half_hour_slot(hhmm) - half_hour_slot(START_TIMES[0]) + 16) % 16
            self.assertEqual(int(state[3].split(" ")[0]), expected, state)

    def test_a_fresh_install_starts_on_day_one(self):
        # SCRANTIC 1018:0b87
        values = [int(value) for value in self.case0[1][3].split(" ")]
        self.assertEqual(values[2:4], [1, 1])
        self.assertEqual(DISCARDS[0], 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Action 2: Run it to make sure it fails**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_story.py' -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'original_story'`.

- [ ] **Action 3: Write the harness**

Create `scripts/re/unicorn/original_story.py`:

```python
import struct
from datetime import datetime, timedelta

from emulator import Emulator
from ne_image import NeImage
from original_graphics import set_byte, set_word, signed
from original_loaders import read_word

NEW_SEQUENCE = "1018:0540"
NEXT_RANDOM = "1018:1e60"
DISCARD_RANDOM = "1018:1eb6"
RANDOM_PERCENT = "1018:1ef5"
GET_DATE = "1000:01f4"
GET_TIME = "1000:020f"
QUIET = ("1010:0136", "1020:0364", "1018:0d11", "1020:081c")

SCENE_TABLE = 0x1756
SCENE_SIZE = 17
SCENE_COUNT = 80
QUEUE = 0x30F2
RANDOM_TABLE = 0x1CE4
RANDOM_TABLE_BYTES = 4 + 56 * 2
RANDOM_WRITE_INDEX = 0x1CE6
START_TIME = 0x00BE
NUM_DAYS = 0x2D9B
INTRODUCTION = 0x2D9A
YEAR = 0x2D98
MONTH = 0x2D96
DAY = 0x2D94
NEW_SEQUENCE_FLAG = 0x30EE
ENTRY_POINTERS = (0x30E6, 0x30E8, 0x30EA)

CASES = 16
BUILDS = 30
DISCARDS = [0, 1, 55, 56, 1000, 4096, 31337, 65535]
START_TIMES = [900, 0, 1230, 2330]
FIRST_DATES = [(1992, 10, 29), (1992, 12, 24), (1992, 12, 31), (1993, 1, 1), (1993, 3, 16), (1992, 6, 1)]
RANDOM_SEEDS = (0, 1, 55, 1000, 65535)
RANDOM_CALLS = 300
PERCENT_LISTS = ([50], [5, 10, 15], [20, 30, 50], [10, 20, 30, 20, 10, 10], [35, 5, 5, 5], [30, 50], [35], [30])
PERCENT_CALLS = 200


def build_clock(k: int, b: int) -> datetime:
    year, month, day = FIRST_DATES[k % len(FIRST_DATES)]
    return datetime(year, month, day, (3 * k) % 24, (7 * k) % 60) + timedelta(days=b // 3, minutes=97 * b)


def table_bytes(image: NeImage) -> tuple[bytes, bytes]:
    data = next(segment for segment in image.segments if segment.index == image.auto_data_segment).data
    return (
        data[SCENE_TABLE:SCENE_TABLE + SCENE_SIZE * SCENE_COUNT + 2],
        data[RANDOM_TABLE:RANDOM_TABLE + RANDOM_TABLE_BYTES],
    )


def random_rows(image: NeImage) -> list[list[object]]:
    rows: list[list[object]] = []
    for seed in RANDOM_SEEDS:
        emu = Emulator(image)
        emu.call_far(DISCARD_RANDOM, stack_words=[seed])
        rows.extend(["next", seed, i, emu.call_far(NEXT_RANDOM)["ax"]] for i in range(RANDOM_CALLS))
    emu = Emulator(image)
    for weights in PERCENT_LISTS:
        kind = "percent:" + ",".join(str(weight) for weight in weights)
        for i in range(PERCENT_CALLS):
            rows.append([kind, 0, i, emu.call_far(RANDOM_PERCENT, stack_words=[0, *reversed(weights)])["ax"]])
    return rows


class StoryTracer:
    def __init__(self, image: NeImage):
        self.emu = Emulator(image)
        self.clock = datetime(1992, 1, 1)
        for address in QUIET:
            self.emu.replace_function(address, lambda emu: {"ax": 0})
        self.emu.replace_function(GET_TIME, self._time)
        self.emu.replace_function(GET_DATE, self._date)

    def _word(self, offset: int) -> int:
        return read_word(self.emu, self.emu.data_segment, offset)

    def _byte(self, offset: int) -> int:
        value = self.emu.read(self.emu.data_segment, offset, 1)[0]
        return value - 0x100 if value >= 0x80 else value

    def _time(self, emu: Emulator):
        emu.write(emu.data_segment, emu.arg(0), bytes([self.clock.hour, self.clock.minute, 0, 0]))
        return {"ax": 0}

    def _date(self, emu: Emulator):
        clock = self.clock
        emu.write(emu.data_segment, emu.arg(0), struct.pack("<BBHB", clock.day, clock.month, clock.year, clock.isoweekday() % 7))
        return {"ax": 0}

    def _entry_index(self, pointer: int) -> int:
        return (pointer - SCENE_TABLE) // SCENE_SIZE if pointer else -1

    def _queue(self) -> list[int]:
        indices, at = [], QUEUE
        while (pointer := self._word(at)) != 0:
            indices.append(self._entry_index(pointer))
            at += 2
        return indices

    def _state(self) -> list[int]:
        word = self._word
        return [
            signed(word(0x30B8)),
            signed(word(0x30BA)),
            self._byte(NUM_DAYS),
            self._byte(INTRODUCTION),
            signed(word(YEAR)),
            signed(word(MONTH)),
            signed(word(DAY)),
            word(0x30BE),
            word(0x30C0),
            signed(word(0x30B2)),
            signed(word(0x30B0)),
            signed(word(0x30AE)),
            signed(word(0x30B4)),
            signed(word(0x30E2)),
            signed(word(0x30DE)),
            *(self._entry_index(word(pointer)) for pointer in ENTRY_POINTERS),
            signed(word(0x30EC)),
            signed(word(NEW_SEQUENCE_FLAG)),
            word(RANDOM_WRITE_INDEX),
        ]

    def trace_case(self, k: int) -> list[list[object]]:
        emu = self.emu
        set_byte(emu, NUM_DAYS, k % 13)
        set_byte(emu, INTRODUCTION, (5 * k) % 13)
        year, month, day = (1992, 6, 1) if k % 2 else (0, 0, 0)
        set_word(emu, YEAR, year)
        set_word(emu, MONTH, month)
        set_word(emu, DAY, day)
        set_word(emu, START_TIME, START_TIMES[k % len(START_TIMES)])
        emu.call_far(DISCARD_RANDOM, stack_words=[DISCARDS[k % len(DISCARDS)]])
        rows: list[list[object]] = []
        for b in range(BUILDS):
            self.clock = build_clock(k, b)
            set_word(emu, NEW_SEQUENCE_FLAG, 1)
            emu.call_far(NEW_SEQUENCE)
            rows.append([k, b, "queue", " ".join(str(index) for index in self._queue())])
            rows.append([k, b, "state", " ".join(str(value) for value in self._state())])
        return rows
```

Check `set_byte`/`set_word`'s argument order in `original_graphics.py` (`set_word(emu, address, value)`) before relying on it.

- [ ] **Action 4: Run the test**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_story.py' -v`
Expected: all pass. If `trace_case` raises `UnstubbedImport` or `EmulationLimit`, read which call it stopped in, check `docs/re/story.md`, and replace that call with a quiet handler only if it is drawing, sound, or file work; note it for `Emulated`. If a test fails, the harness or the test is wrong, not the original: compare with `story.md` and fix whichever disagrees with the assembly.

- [ ] **Action 5: Write the dump script**

Create `scripts/re/unicorn/dump_story.py`:

```python
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from ne_image import NeImage  # noqa: E402
from original_story import CASES, StoryTracer, random_rows, table_bytes  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/story"


def write_tsv(path: Path, header: str, rows: list[list[object]]):
    path.write_text("\n".join([header, *("\t".join(str(cell) for cell in row) for row in rows)]) + "\n")


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    OUT.mkdir(parents=True, exist_ok=True)
    scenes, random_table = table_bytes(image)
    (OUT / "scene-table.bin").write_bytes(scenes)
    (OUT / "random-table.bin").write_bytes(random_table)
    write_tsv(OUT / "random.tsv", "kind\tseed\tcall\tvalue", random_rows(image))
    rows: list[list[object]] = []
    for k in range(CASES):
        started = time.monotonic()
        rows.extend(StoryTracer(image).trace_case(k))
        print(f"case {k}: {time.monotonic() - started:.1f}s", file=sys.stderr)
    write_tsv(OUT / "sequences.tsv", "case\tbuild\tevent\tvalues", rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_story.py scripts/re/unicorn/dump_story.py scripts/re/unicorn/test_original_story.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_story.py`
Expected: 16 `case` lines on stderr, exit 0, and four files in `re/fixtures/story/`.

Run: `wc -l re/fixtures/story/sequences.tsv re/fixtures/story/random.tsv`
Expected: `961` lines (16 × 30 × 2 + header) and `3101` lines (5 × 300 + 8 × 200 + header).

- [ ] **Action 6: Look at the trace**

Read a few cases by eye and note for `Emulated`:

1. How many of the 480 queues hold a day scene (an entry with day ≠ 0), and which days.
2. The longest and shortest queue.
3. Whether NumDays and Introduction move as `story.md` (`Day counters`) predicts over the cases with date changes.
4. Whether any queue contains an index outside 1..79 (a null kind-1 pick shows as a queue cut short; see OQ-34). If the harness sees one, note the case and build.

- [ ] **Action 7: Document the harness**

Append to `scripts/re/unicorn/README.md`:

```markdown
## Original story sequences

    re/.venv/bin/python -I scripts/re/unicorn/dump_story.py

Runs the original random generator (`1018:1e60`, `1018:1eb6`, `1018:1ef5`) and the sequence builder (`1018:0540`) for 16 cases of 30 sequences each, with the wall clock, start time, and day counters set per case. Drawing, the wipe, the ADS unload, and the debug log are replaced by handlers that do nothing; the DOS date and time calls return the case's wall clock. Writes `re/fixtures/story/` (gitignored): `sequences.tsv`, `random.tsv`, and the raw scene and random tables. `src/story/sequence.data.test.ts` and `src/story/random.data.test.ts` compare them with the TypeScript port. Formats: `docs/plans/2026-10-18-re-story/step-000-overview.md`, `Trace formats`, and `docs/re/story.md`, `Emulated`.
```

In `docs/re/story.md`, add a section `Emulated` before `Side-by-side checklist`: what runs as original code, what is replaced and why, the case grid (point to the overview's `Trace formats` and copy the formulas), the row counts from Action 5, and the observations of Action 6.

- [ ] **Action 8: Commit**

```bash
git add scripts/re/unicorn/original_story.py scripts/re/unicorn/dump_story.py scripts/re/unicorn/test_original_story.py scripts/re/unicorn/README.md docs/re/story.md
git commit -m "test(re): trace the original story sequence builder and random generator"
```

## Wrap-Up

- [ ] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [ ] Commit the check-off (and any leftovers entry)
