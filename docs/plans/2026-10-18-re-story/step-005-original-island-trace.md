# Step 5: Original Island Trace

> **Do not edit this document after it's generated, except to tick a progress
> checkbox (`- [ ]` → `- [x]`).** It was produced by a planning skill. Any other
> edit — to scope, steps, requirements, or wording — needs explicit user
> approval first. Once the described work is implemented, treat this document as
> possibly out of date: the code, tests, and non-planning docs are the source of
> truth, not this file.

> Read `step-000-overview.md` in this directory before starting. It has the
> goal, architecture, global constraints, and leftovers protocol that apply
> to every step. This file assumes you have read it.

**Depends on:** `step-004-island-findings.md`

**Files:**

- Create: `scripts/re/unicorn/original_island.py`, `scripts/re/unicorn/dump_island.py`, `scripts/re/unicorn/test_original_island.py`
- Modify: `scripts/re/unicorn/README.md` (new section), `docs/re/island.md` (new section `Emulated`)
- Local only (gitignored): `re/fixtures/island/traces.tsv`

**Interfaces:**

- Consumes: `docs/re/island.md` (step 4), the overview's `Trace formats`, `Island`; `TtmTracer` (`original_ttm.py`: constructor `(image, resources, name)`, overridable `_load`, `_new_thread`, `_install_hooks`, `_bitmap_list(name)`, `_sprite` handler, `_copy` handler, `_target()`, `_source()`, `_clip()`, `_args(first, count)`, `_word`, `_byte`, `events`, `images`); `AdsTracer` (`original_ads.py`) as the model of a `TtmTracer` subclass; `set_word`, `set_byte`, `signed`, `CLIP_ON`, `CLIP_X1`, `CLIP_Y1`, `CLIP_X2`, `CLIP_Y2` (`original_graphics.py`); `FOREGROUND`, `FILL`, `BACKGROUND` (`original_ttm.py`); `c_string` (`original_loaders.py`); `load_resources` (`corpus.py`).
- Produces: `original_island.py` with `IslandTracer(image, resources)`, `trace_case(k) -> list[list[object]]`, `load_events: list[list[object]]` (the first `1010:0136` call's rows), constants `CASES = 24`, `STEPS = 60`, `island_case(k) -> tuple[dict[int, int], int, int]` (word globals, NumDays byte, discard count). Fixture `re/fixtures/island/traces.tsv` read by step 6 (format in the overview).

The island code runs as original code with the original random generator and clock callback. Only the drawing, loading, dirty-list calls, and the debug log are replaced by recorders. `1060:04b2` answers by the overview's rule, so both sides see the same answers without modeling the dirty lists.

- [x] **Action 1: Write the failing harness test**

Create `scripts/re/unicorn/test_original_island.py`:

```python
import unittest
from pathlib import Path

from corpus import load_resources
from ne_image import NeImage
from original_island import CASES, STEPS, IslandTracer

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"


def of_step(rows: list[list[object]], step: int) -> list[list[str]]:
    return [[str(row[2]), *str(row[3]).split(" ")] for row in rows if row[1] == step]


@unittest.skipUnless((DATA / "SCRANTIC.SCR").exists() and (DATA / "RESOURCE.MAP").exists(), "needs public/data")
class IslandTracerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        image = NeImage.load(DATA / "SCRANTIC.SCR")
        resources = {resource.name: resource.payload for resource in load_resources(DATA)}
        cls.tracer = IslandTracer(image, resources)
        cls.case0 = cls.tracer.trace_case(0)
        cls.case4 = IslandTracer(image, resources).trace_case(4)

    def test_the_first_call_only_loads_the_island_bitmaps(self):
        # SCRANTIC 1010:0136 1008:143c
        self.assertEqual([row[0] for row in self.tracer.load_events], ["sheet", "sheet"])
        self.assertEqual([row[1] for row in self.tracer.load_events], ["BACKGRND.BMP", "MRAFT.BMP"])

    def test_the_island_is_drawn_into_c_and_shown_through_b(self):
        # SCRANTIC 1010:0136
        rows = of_step(self.case0, -1)
        self.assertEqual(rows[0][:2], ["screen", "2"])
        self.assertIn(rows[0][2], ("OCEAN00.SCR", "OCEAN01.SCR", "OCEAN02.SCR"))
        self.assertIn(["copy", "2", "1", "0", "0", "640", "480"], rows)
        self.assertIn(["dirty", "1", "0", "0", "0", "0", "640", "480"], rows)
        self.assertTrue(any(row[:4] == ["sprite", "2", "BACKGRND.BMP", "0"] for row in rows))

    def test_no_island_mode_fills_the_screen_with_color_5(self):
        # SCRANTIC 1010:0136
        rows = of_step(self.case4, -1)
        self.assertEqual(rows[0], ["fill", "2", "0", "0", "640", "480", "5"])
        self.assertFalse(any(row[0] == "sprite" and row[2] == "BACKGRND.BMP" and row[3] == "0" for row in rows))

    def test_overlap_answers_follow_the_rule(self):
        answers = [row[7] for step in range(-1, STEPS) for row in of_step(self.case0, step) if row[0] == "overlaps"]
        self.assertEqual(answers, ["1" if n % 3 == 1 else "0" for n in range(len(answers))])

    def test_every_step_ends_with_a_state_row(self):
        for step in range(-1, STEPS):
            self.assertEqual(of_step(self.case0, step)[-1][0], "state", step)

    def test_cases_cover_the_grid(self):
        self.assertEqual(CASES, 24)


if __name__ == "__main__":
    unittest.main()
```

- [x] **Action 2: Run it to make sure it fails**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_island.py' -v`
Expected: ERROR, `ModuleNotFoundError: No module named 'original_island'`.

- [x] **Action 3: Write the harness**

Create `scripts/re/unicorn/original_island.py`:

```python
from emulator import Emulator
from ne_image import NeImage
from original_graphics import CLIP_ON, CLIP_X1, CLIP_X2, CLIP_Y1, CLIP_Y2, set_byte, set_word, signed
from original_loaders import c_string
from original_ttm import BACKGROUND, FILL, FOREGROUND, TtmTracer

DRAW_ISLAND = "1010:0136"
ANIMATE_ISLAND = "1010:040e"
DRAW_HOLIDAY = "1010:1e50"
CLOCK_TICK = "1008:16c2"
DISCARD_RANDOM = "1018:1eb6"
LOAD_BMP = "1030:124a"
LOAD_SCREEN = "1030:16d8"
DRAW_RECT = "1038:1bd8"
DRAW_SPRITE = "1038:0ae4"
DRAW_SPRITE_PLAIN = "1038:0ac2"
DRAW_LINE = "1030:02ef"
COPY_RECT = "1038:06ce"
ADD_DIRTY = "1060:007e"
DIRTY_OVERLAPS = "1060:04b2"
DEBUG_LOG = "1020:081c"

MODE = 0x30B2
PLACE = 0x30BE
LOW_TIDE = 0x30C0
STILL = 0x30B0
NO_RAFT = 0x30AE
HOLIDAY_SHOWN = 0x30B4
HOLIDAY = 0x30BA
SLOT = 0x30B8
SPEED = 0x30BC
SETTING_BACKGROUND = 0x00B6
SETTING_CLOUDS = 0x00B8
SETTING_WAVES = 0x00BA
NUM_DAYS = 0x2D9B
RANDOM_WRITE_INDEX = 0x1CE6
CLOUD_RECORDS = (0x2E80, 15)
WAVE_RECORDS = (0x2F40, 30)
RECORD_WORDS = 6
STATE_WORDS = (0x30C4, 0x30C2, 0x30C0, 0x30BE, 0x30B6, 0x0282, 0x0284, 0x0286, 0x0280, 0x0288, 0x028A,
               0x2E7A, 0x2E7C, 0x2E7E, 0x2F36, 0x2F38, 0x2F3A, 0x2F3C)
UNSIGNED_STATE = {0x30C0, 0x30BE}

CASES = 24
STEPS = 60
PLACES = [0xFFFF, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0C, 0x30]


def island_case(k: int) -> tuple[dict[int, int], int, int]:
    words = {
        MODE: [0, 0, 0, 1, 2][k % 5],
        PLACE: PLACES[k % len(PLACES)],
        LOW_TIDE: [0xFFFF, 0, 1][k % 3],
        STILL: 1 if k % 7 == 3 else 0,
        NO_RAFT: 1 if k % 6 == 5 else 0,
        HOLIDAY_SHOWN: 0 if k % 4 == 2 else 1,
        HOLIDAY: k % 5,
        SLOT: 13 if k % 2 else 0,
        SETTING_BACKGROUND: 0 if k % 8 == 7 else 1,
        SETTING_CLOUDS: 0 if k % 9 == 8 else 1,
        SETTING_WAVES: 0 if k % 10 == 9 else 1,
        SPEED: 200 if k % 2 == 0 else 0,
    }
    return words, [1, 3, 9][k % 3], 997 * k


class IslandTracer(TtmTracer):
    def __init__(self, image: NeImage, resources: dict[str, bytes]):
        self.cached_lists: dict[str, int] = {}
        self.overlap_calls = 0
        super().__init__(image, resources, "ISLAND")
        self.emu.call_far(DRAW_ISLAND)
        self.load_events = list(self.events)
        self.events.clear()

    def _load(self) -> list[int]:
        return []

    def _new_thread(self) -> int:
        return 0

    def _bitmap_list(self, name: str) -> int:
        key = name.upper()
        if key not in self.cached_lists:
            self.cached_lists[key] = super()._bitmap_list(name)
        return self.cached_lists[key]

    def _install_hooks(self):
        hooks = {
            LOAD_BMP: self._sheet,
            LOAD_SCREEN: self._load_screen,
            DRAW_RECT: self._fill,
            DRAW_SPRITE: self._sprite,
            DRAW_SPRITE_PLAIN: self._sprite_plain,
            DRAW_LINE: self._island_line,
            COPY_RECT: self._copy,
            ADD_DIRTY: self._island_dirty,
            DIRTY_OVERLAPS: self._overlaps,
            DEBUG_LOG: self._quiet,
        }
        for address, handler in hooks.items():
            self.emu.replace_function(address, handler)

    def _sheet(self, emu: Emulator):
        name = c_string(emu, emu.arg(0)).upper()
        self._event("sheet", name)
        return {"ax": self._bitmap_list(name)}

    def _load_screen(self, emu: Emulator):
        self._event("screen", self._target(), c_string(emu, emu.arg(0)).upper())
        return {"ax": 1}

    def _fill(self, emu: Emulator):
        if self._byte(FILL) != 1 or self._byte(FOREGROUND) != self._byte(BACKGROUND):
            raise RuntimeError("island rect that is not a solid fill")
        self._event("fill", self._target(), *self._args(0, 4), self._byte(FOREGROUND))
        return {"ax": 0}

    def _sprite_plain(self, emu: Emulator):
        name, index = self.images[emu.arg(0)]
        self._event("sprite", self._target(), name, index, *self._args(1, 2), 0, *self._clip())
        return {"ax": 0}

    def _island_line(self, emu: Emulator):
        self._event("line", self._target(), *self._args(0, 4), self._byte(FOREGROUND))
        return {"ax": 0}

    def _island_dirty(self, emu: Emulator):
        x, y, w, h, kind = self._args(0, 5)
        if kind != 1:
            raise RuntimeError(f"island dirty rect of kind {kind}")
        self._event("dirty", self._surface(emu.arg(5)), self._surface(emu.arg(6)), signed(emu.arg(7)), x, y, w, h)
        return {"ax": 0}

    def _overlaps(self, emu: Emulator):
        answer = 1 if self.overlap_calls % 3 == 1 else 0
        self.overlap_calls += 1
        self._event("overlaps", self._surface(emu.arg(4)), signed(emu.arg(5)), *self._args(0, 4), answer)
        return {"ax": answer}

    def _records(self, start: int, count: int) -> list[str]:
        return [
            ",".join(str(signed(self._word(start + 2 * (RECORD_WORDS * i + j)))) for j in range(RECORD_WORDS))
            for i in range(count)
        ]

    def _state(self) -> list[object]:
        values: list[object] = [self._word(at) if at in UNSIGNED_STATE else signed(self._word(at)) for at in STATE_WORDS]
        values.append(self._word(RANDOM_WRITE_INDEX))
        values.extend(self._records(*CLOUD_RECORDS))
        values.extend(self._records(*WAVE_RECORDS))
        return values

    def _flush(self, k: int, step: int) -> list[list[object]]:
        rows = [[k, step, event[0], " ".join(str(value) for value in event[1:])] for event in self.events]
        rows.append([k, step, "state", " ".join(str(value) for value in self._state())])
        self.events.clear()
        return rows

    def trace_case(self, k: int) -> list[list[object]]:
        emu = self.emu
        words, num_days, discard = island_case(k)
        for address, value in words.items():
            set_word(emu, address, value)
        set_byte(emu, NUM_DAYS, num_days)
        set_byte(emu, CLIP_ON, 0)
        for address, value in ((CLIP_X1, 0), (CLIP_Y1, 0), (CLIP_X2, 639), (CLIP_Y2, 479)):
            set_word(emu, address, value)
        emu.call_far(DISCARD_RANDOM, stack_words=[discard])
        self.overlap_calls = 0
        self.events.clear()
        emu.call_far(DRAW_ISLAND)
        rows = self._flush(k, -1)
        for step in range(STEPS):
            for _ in range(1 + step % 4):
                emu.call_far(CLOCK_TICK)
            emu.call_far(ANIMATE_ISLAND, stack_words=[0])
            emu.call_far(DRAW_HOLIDAY, stack_words=[0])
            rows.extend(self._flush(k, step))
        return rows
```

Check before running: `original_ttm.py` defines `FILL`, `FOREGROUND`, `BACKGROUND`, and `TtmTracer._sprite` records `("sprite", target, name, index, x, y, flags, *clip)` from args `(record, x, y, flags)`, which is the argument order of `1038:0ae4` (`docs/re/graphics.md`); and `_copy` records `("copy", source, target, x, y, w, h)`. If `TtmTracer.__init__` needs a TTM resource named `ISLAND`, it does not: `_load` is overridden. If `docs/re/island.md` shows a call these hooks miss (for example a palette or present call), add a recorder or quiet handler for it and name it in `Emulated`.

- [x] **Action 4: Run the test**

Run: `re/.venv/bin/python -I -m unittest discover -s scripts/re/unicorn -p 'test_original_island.py' -v`
Expected: all pass. An `UnstubbedImport` or `EmulationLimit` names the call it stopped in: read it in `re/out/functions/`, and add a recorder (if it draws) or a quiet handler (if it only logs). A `KeyError` in `self.images` means a sprite record that no `_bitmap_list` made: print the record pointer and the call site; it is a finding (a null or out-of-range sprite index, see `island.md`, `Bitmaps`).

- [x] **Action 5: Write the dump script**

Create `scripts/re/unicorn/dump_island.py`:

```python
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus import load_resources  # noqa: E402
from ne_image import NeImage  # noqa: E402
from original_island import CASES, IslandTracer  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "public/data"
OUT = REPO / "re/fixtures/island"


def main() -> int:
    image = NeImage.load(DATA / "SCRANTIC.SCR")
    resources = {resource.name: resource.payload for resource in load_resources(DATA)}
    rows: list[list[object]] = []
    for k in range(CASES):
        started = time.monotonic()
        traced = IslandTracer(image, resources).trace_case(k)
        rows.extend(traced)
        print(f"case {k}: {len(traced)} rows, {time.monotonic() - started:.1f}s", file=sys.stderr)
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["case\tstep\tevent\tvalues", *("\t".join(str(cell) for cell in row) for row in rows)]
    (OUT / "traces.tsv").write_text("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Run: `re/.venv/bin/python -I -m py_compile scripts/re/unicorn/original_island.py scripts/re/unicorn/dump_island.py scripts/re/unicorn/test_original_island.py`
Expected: no output.

Run: `re/.venv/bin/python -I scripts/re/unicorn/dump_island.py`
Expected: 24 `case` lines on stderr, exit 0, `re/fixtures/island/traces.tsv` written. Note the total row count for `Emulated`.

- [x] **Action 6: Look at the trace**

Note for `Emulated`:

1. How many `line` events (glints) and wave sprites (BACKGRND 18..29) appear in cases with speed 200, and that none appear with speed 0.
2. That clouds (BACKGRND 15..17) are drawn only in step `-1`.
3. That surf sprites appear in about every other step (the 4-tick timer against 1 to 4 ticks per step).
4. Any sprite index past a sheet's end.

- [x] **Action 7: Document the harness**

Append to `scripts/re/unicorn/README.md`:

```markdown
## Original island

    re/.venv/bin/python -I scripts/re/unicorn/dump_island.py

Runs the original island code (`1010:0136`, then 60 steps of `1008:16c2` ticks, `1010:040e(0)`, and `1010:1e50(0)`) for 24 cases of island flags, settings, holiday, slot, and day count, with the original random generator. Loading, drawing, copying, and dirty-list calls are replaced by recorders (`original_island.py`, `IslandTracer` extends `TtmTracer`); `1060:04b2` answers 1 on every third call. Writes `re/fixtures/island/traces.tsv` (gitignored), which `src/island/island.data.test.ts` compares with the TypeScript port. Format: `docs/plans/2026-10-18-re-story/step-000-overview.md`, `Trace formats`, and `docs/re/island.md`, `Emulated`.
```

In `docs/re/island.md`, add a section `Emulated` before `Side-by-side checklist`: what runs as original code, what is recorded, the overlap rule, the case grid (copy the formulas from the overview), the row count, and the observations of Action 6.

- [x] **Action 8: Commit**

```bash
git add scripts/re/unicorn/original_island.py scripts/re/unicorn/dump_island.py scripts/re/unicorn/test_original_island.py scripts/re/unicorn/README.md docs/re/island.md
git commit -m "test(re): trace the original island drawing and animation"
```

## Wrap-Up

- [x] Check this step off in the Steps list of `step-000-overview.md`
- [ ] Only if something could not be finished: record it in
      `step-999-leftovers.md` per the overview's Leftovers Protocol
- [x] Commit the check-off (and any leftovers entry)
