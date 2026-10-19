# Walk

How the original walks Johnny between spots: routes, segments, turn sets, the walk step, and how the story drives it. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 8. One claim per address. Our own words; no decompiled code.

## Globals

All of these are 0 in the data segment at load.

- `1068:30d2`: the `JOHNWALK.BMP` bitmap list (a near pointer to a table of near pointers to image records; record `+6` width, `+8` height). Written by `1018:0000` and `1018:004d`. The TTM reads it to share the list (`1058:0792`, `07bc`, `082f`, `1050:0888`; `docs/re/ttm.md`).
- `1068:30e2` / `30de`: Johnny's spot (1..6, 0 = any) and heading (0..7). Written by `1018:0000` (1, 0), `1018:0094` (on arrival and when turning), `1018:0540` (the first entry's start), and `1018:06bf` (an entry's end).
- `1068:30e0`: the target spot. Written by `1018:0000` (1) and `1018:0b46` (unless its spot argument is 0). Nothing else writes it.
- `1068:30dc`: the target heading, -1 = none wanted. Written by `1018:0b46` (unless its heading argument is -1) and `1018:0094` (-1 once Johnny stands at it). Starts at 0, not -1.
- `1068:30d0`: the route list being walked, 0 = none. Written by `1018:0094` (picks it, clears it on arrival at the target) and `1018:0074` (clears it).
- `1068:30ce`: the next frame record of the segment being walked, 0 = none. Written by `1018:0094` and `1018:0074`.
- `1068:30c6`: the frame record drawn on every call, 0 = none yet. Written only by `1018:0094`; nothing ever clears it.
- `1068:30c8`: the wanted heading. Written by `1018:0094` (a segment's start heading, or the target heading) and `1018:0074` (Johnny's heading).
- `1068:30cc` / `30ca`: the end heading / end spot of the segment being walked. Written only by `1018:0094` when it picks a segment.
- `1068:30d4`: the frame delay. Set to 4 by `1018:0094` after every draw, counted down to 0 by the clock `1008:16c2`.
- No other instruction names `30c6`..`30d4`, `30dc`, or `30e0`. `1018:0540` and `1018:06bf` write `30e2`/`30de` and nothing else of the walk.

## Tables

All in one block of the data segment, `1068:02e1`..`165f`. Every check below was run against `SCRANTIC.SCR` and `RESOURCE.001`.

- `1068:02de + 3 × s`: segment `s` (1..34) as three signed bytes: start heading, end heading, end spot. Segment 0 (`02de`..`02e0`, just before the block) is (0, 0, 0).
- `1068:02e1`: segments 5, 6, 9, 10, 16, 17, 21, 22, 27, 28, 33, 34 are (0, 0, 0). These are the turn sets, never picked by a route.
- `1068:0347 + spot` (spot 0..6): the standing turn set of each spot, `[0, 6, 10, 17, 22, 28, 34]`. `1068:034e + spot`: the walking turn set, `[0, 5, 9, 16, 21, 27, 33]`. Spot 0 has segment 0 in both.
- `1068:0355`: `JOHNWALK.BMP` and a 0 byte, the name `1018:0000` loads.
- `1068:0362`..`0aa1`: 30 route lists, one per (from, to) pair with from ≠ to, in from-major order (1, 2), (1, 3), ..., (6, 5), back to back. Each list has, for spot 1..6 in order, the marker word `-spot` and then (segment, percent) word pairs; the list ends with the word `-7`.
- `1068:0362`: in every route the group of the target spot is the single pair (0, 0). In routes (5, 6) and (6, 5) the group of spot 2 is also (0, 0): no walk of those routes passes spot 2.
- `1068:0362`: every other group's percents add up to exactly 100, except one that adds up to 150 (below).
- `1068:042c`: route (1, 5), group of spot 1: `(4, 16) (4, 17) (3, 34) (2, 33) (1, 25) (1, 25)`, 150 in all. The first four already add up to 100, so segment 1 (the direct walk from spot 1 to spot 5) is never picked. No other choice is unreachable.
- `1068:0aa2`..`0ae9`: the route table, 6 × 6 words; the word for (from, to) is at `0x0a94 + 12 × from + 2 × to`. It holds the near address of the route list, 0 when from = to.
- `1068:0aea`..`165f`: 34 frame lists in segment order, back to back (the first at `0aea`, the last ending at `1660`). Records of three words: sprite index (bit `0x8000` = mirrored), x, y. x and y are relative to the island offset `1068:30c4` / `30c2` (`docs/re/island.md`). Each list ends with a (0, 0, 0) record.
- `1068:0aea`: each turn set has 8 records; record `h` faces heading `h`. The walking segments have 5 to 32 records.
- `1068:0aea`: the highest sprite index used is 32; `JOHNWALK.BMP` has 36 sprites.
- Every walking segment is picked at exactly one spot: segments 1..4 at spot 1, 7, 8 at 2, 11..15 at 3, 18..20 at 4, 23, 25, 26 at 5, 29..32 at 6. Segment 24 (7, 6, 3) is in no route, so it is never walked.
- Every segment picked at a spot ends at another spot: no segment ends where it starts.
- Route (5, 6) can loop: spot 5 picks segment 25 (to spot 4) 25% of the time, and spot 4 picks segment 19 (back to spot 5) 50% of the time. No other route can come back to a spot it left.

## Loading and freeing

- `1018:0000` (called once by `1008:143c`, at startup): when `30d2` is 0, loads `JOHNWALK.BMP` (`1030:124a`) with the mirror flag `1068:4106` set to 1 around the load (so every image gets a pre-mirrored copy, `docs/re/graphics.md`), stores the list in `30d2`, then sets target spot `30e0 = 1`, spot `30e2 = 1`, heading `30de = 0`. Those three are set only when it loaded. Returns 1 when `30d2` is set, else 0.
- `1018:004d` (called by `1008:157b`, the cleanup): when `30d2` is set, frees the list (`1030:00fe`) and clears `30d2`.
- `1058:079f`: a TTM load of `JOHNWALK.BMP` gets the same list `30d2` and loads nothing; the TTM never frees it (`docs/re/ttm.md`, `Resources`).

## Route choice

- `1018:03ac(from, to)`: 0 when either is 0; else the word at `0x0a94 + 12 × from + 2 × to` (signed multiply). No range check: only 0..6 are safe, and the walk only passes spots.
- `1018:03ea(id)`: the frame list address of segment `id` for 1..34 (a jump table: `0aea`, `0b50`, `0bce`, `0c82`, ... `162a`); 0 for anything else, including 0 and negative ids.
- `1018:0094`, only when the delay `30d4` is 0, part 1: with no route and Johnny's spot not the target, the route becomes `1018:03ac(spot, target)`.
- `1018:0094`, part 2, with a route and no segment: it scans the route word by word for `-spot`, stopping at `-7`. When it stopped at `-7` it returns at once: nothing drawn, the delay stays 0.
- `1018:0094`, part 2: else `r = rand % 100` (`1018:1e60`, unsigned `DIV`). Starting at the first pair after the marker, it subtracts the pair's percent from `r` and moves on while the result is greater than 0 (signed). So `r = 0` picks the first pair, and `r` equal to the running total of the pairs so far picks the last of them.
- `1018:0094`, part 2: the segment is the chosen pair's first word. `30ce = 1018:03ea(segment)`; the wanted heading `30c8`, end heading `30cc`, and end spot `30ca` come from the segment table.
- `1018:0094`, part 2: when `30ce` is 0 (segment 0), Johnny is put at once at the end spot and heading, and the route is cleared when that spot is the target. Segment 0 is (0, 0, 0), so that puts Johnny at spot 0, heading 0.
- `1018:0094`, part 2, reading past a group: the scan for `-spot` and the percent loop do not stop at the next marker. A (0, 0) group subtracts 0 and goes on into the next group's words (markers count as segments, segment ids as percents), and with spot 0 the scan matches the first 0 word. Only a route left over from an earlier target gets there (`Story interface`); the result is a segment read out of the wrong place, or a frame list address of 0 with headings and an end spot read from below the segment table.
- `1018:0094`, after such a pick, in the emulator: Johnny's spot became 46 with a heading out of range, later picks found no marker `-46` and returned at once, and the turn frame `heading × 6` made the draw read an image pointer out of the data segment. The original has no way back from it: Johnny stops being drawn or is drawn from garbage.

## Turning

- `1018:0094`, part 3, still only when the delay is 0: when a target heading is set (`30dc ≠ -1`), Johnny is on the target spot, and his heading is the wanted one: if the wanted heading is not the target heading, it becomes the target heading; else the frame becomes the standing turn set of the spot at that heading and the target heading is cleared to -1.
- `1018:0094`, part 4: when the heading is not the wanted one, `d = heading - wanted`. For `d = ±4`, the turn is +1 when `rand & 1` is 0, else -1. Otherwise the turn is -1 for `d < -4`, +1 for `-4 < d < 0`, +1 for `d > 4`, and -1 for `0 < d < 4`. So Johnny always turns the short way round.
- `1018:0094`, part 4: `heading = (heading + turn) & 7`; the frame becomes the record at the new heading in the standing turn set of the spot when Johnny is on the target spot, else in the walking turn set.
- `1018:0094`: one turn step per call with the delay at 0. A turn of 3 headings takes 3 frames before the walk starts.
- `1018:0094`, part 4, at spot 0: both turn sets are segment 0, whose frame list address is 0, so the frame becomes `heading × 6`, a pointer into the start of the data segment.
- `1018:0074`: the wanted heading becomes Johnny's current heading. Nothing else resets it, so when the story moves Johnny (`Story interface`), the wanted heading is still the old one, and the next walk call turns Johnny toward it first unless a new segment or target heading replaces it.

## Walking a segment

- `1018:0094`, part 5, still only when the delay is 0: with a segment and the heading equal to the wanted one, the frame becomes the segment's next record, and the record moves on by one.
- `1018:0094`, part 5: when the record it moved to is (0, 0, 0), Johnny arrives: his spot becomes the end spot `30ca`, his heading the end heading `30cc`, the segment is cleared, and the route is cleared when the new spot is the target. The last drawn frame is the record before the (0, 0, 0).
- `1018:0094`: parts 3, 4, 5 run in that order in the same call. A turn that reaches the wanted heading lets part 5 run right after it, and its record replaces the turn frame: the last turn frame is never drawn when a segment is waiting. A segment picked in part 2 can be started in part 5 of the same call when Johnny already faces its start heading.
- `1018:0094`: when Johnny arrives at a spot that is not the target, the next call with the delay at 0 picks the next segment from the same route.
- `1018:0094`: when he arrives at the target spot, a set target heading is turned to in later calls, ending with the standing frame (part 3).

## Drawing

- `1018:0094`: the draw runs on every call, also when the delay is not 0 (then it is the only thing the call does). With no frame yet (`30c6` = 0) nothing is drawn and the delay is not set.
- `1018:0094`, draw: the image is entry `word & 0x7fff` of the list `30d2`; flags are 2 (mirrored, `docs/re/graphics.md`) when bit `0x8000` is set, else 0; `x = 30c4 + record x`, `y = 30c2 + record y`.
- `1018:0094`, draw: `1038:0ae4(image, x, y, flags)` on the current target, then `1010:1551(image, x, y)`, which in mode 0 (`1068:2e78`, never 1 here) redraws only the palm trunk, BACKGRND sprite 13, when Johnny is behind it (`docs/re/island.md`, `Redrawing over sprites`).
- `1018:0094`, draw: then three kind-1 dirty rects of `(x, y, image width, image height)`, no padding: B → A age 0, B → A age 1, C → B age 0 (`1068:1eb2` = B, `1eb4` = A, `1eb0` = C). The last two arguments, the saved offset and segment, are 0. The same three rects as `1010:1a0d`, written out instead of called.
- `1018:0094`, draw: then the delay `30d4 = 4`.
- `1018:06bf` calls `1010:040e(0)` just before every walk call, which leaves B as the target, so Johnny is drawn on B.
- `1018:0094`: since `30c6` is never cleared, a call that changes nothing draws the last frame again, at the place that frame names, even after the story moved Johnny elsewhere.

## Timing

- `1008:16c2`: counts `30d4` down by 1 per clock tick (16 ms) while it is not 0.
- `1018:0094`: sets `30d4 = 4` after every draw, also on calls where the delay had not run out. So the delay only reaches 0 when at least 4 clock ticks pass between two walk calls; the walk does not advance one frame per 4 ticks.
- With one story step per 50 ms and an even 16 ms clock (ours, OQ-36), a step sees 3 ticks seven times out of eight and 4 ticks once, so Johnny takes one walk or turn step about every 400 ms. On Windows 3.x, with the clock ticks in bursts of 3 or 4 per 55 ms (OQ-36), about 7 steps in 16 saw 4 ticks: a walk step about every 125 ms (an estimate from OQ-36, not measured). How fast Johnny walks depends on that tick pattern.
- Browser check (2026-10-19): with even ticks Johnny walks visibly slower than the scenes animate, as the rule above predicts (OQ-36). Turns, segments, the palm trunk, and the dirty rects looked right: no jumps, no blinking, no trails.
- There is no rest on arrival: the story asks `1018:0b46` on the next step, and an entry starts as soon as Johnny is on its spot and heading.

## Story interface

- `1018:0b46(spot, heading)`: stores the target spot unless 0 and the target heading unless -1, then answers 1 when Johnny is on the spot (or the spot is 0) and faces the heading (or the heading is -1).
- `1018:06bf` at `1018:073a`: while an ADS entry is pending and `1018:0b46(start spot, start heading)` answers 0, it calls `1018:0094` and ends the step. The step that gets 1 starts the entry.
- `1018:06bf` at `1018:0771`: on an idle entry's first step, `1018:0074`. At `1018:0776`: on every idle step, `1018:0094`. The idle entry never calls `1018:0b46`, so the target is the one the last ADS entry set (its start spot and heading), and Johnny walks back to it during the idle wait.
- `1018:06bf`: no walk call while an ADS entry plays.
- `1018:06bf`, ending an entry (`1018:0783` idle, `1018:081c` ADS): Johnny's spot and heading become the entry's end spot and heading, without a walk reset. After an ADS entry, an end spot of 0 becomes `rand % 6 + 1` and an end heading of 0 becomes `rand & 7`.
- `1018:0540`: a new sequence puts Johnny on the first entry's start spot and heading, also without a walk reset.
- So a route, a segment, and a wanted heading can outlive the move: an idle entry that ends mid-walk leaves its route set, and the next ADS entry walks on along that old route toward the new target. When that route reaches its own target spot, the (0, 0) group is read past (`Route choice`).
- Spot 0: only scene table entries 1, 13, 37, 69, 71, 72, 73 (`docs/re/story.md`, `Scene table`; entry 0 is the empty row) start at spot 0, all with heading 0. All have flag `0x01` and none `0x02`, so each is either the first entry of a sequence or the whole sequence. `1018:0540` sets Johnny's heading to 0, so `1018:0b46(0, 0)` answers 1 at once and `1018:0094` is never called with Johnny at spot 0. The entry ends with a random spot 1..6.
- `1018:0b46`: the start headings in the scene table are all 0..7, so every pending entry sets a target heading.

## Emulated

`scripts/re/unicorn/original_walk.py` (`WalkTracer`, extends `IslandTracer`), `dump_walk.py`, `test_original_walk.py`. Writes `re/fixtures/walk/walk-data.bin` (`1068:02e1`..`165f`, 4991 bytes) and `re/fixtures/walk/traces.tsv`.

- Runs as original code: `1018:0000`, `1018:0074`, `1018:0094`, `1018:03ac`, `1018:03ea`, `1018:0b46`, `1010:0136` and `1010:1551` with everything they call in `1010`, the clock `1008:16c2`, and the random generator (`1018:1e60`, `1018:1eb6`).
- Recorded and replaced, as in the island harness (`docs/re/island.md`, `Emulated`): `1030:124a`, `1030:16d8`, `1038:1bd8`, `1038:0ae4`, `1038:0ac2`, `1030:02ef`, `1038:06ce`, `1060:007e` (`dirty`), `1060:04b2` (1 on every third call), `1020:081c`.
- Each case `k` (0..35) is a fresh emulator: `1010:0136` once with nothing set (loads BACKGRND and MRAFT); the island globals (mode 0, nothing placed, low tide `k % 2`, holiday shown, every setting on, NumDays 1, the clip off over `(0, 0, 639, 479)`); `1018:1eb6(1009k)`; `1010:0136` again; `30d2 = 0` and `1018:0000`; Johnny on spot `1 + k / 6` (integer), heading `k % 8`. Then one `state` row at beat -1.
- Beat `b` (numbered across the case) starts with `floor(50(b + 1) / 16) - floor(50b / 16)` clock calls (3 or 4: 16 ms ticks, 50 ms steps) and ends with a `state` row.
- Legs 0..5. The target spot is `1 + k % 6` for leg 0, else `(k + 3 × leg) % 7` (0 = any); the target heading `(3k + 5 × leg + 1) % 8`. Before an odd leg Johnny is moved to spot `1 + (k + leg) % 6`, heading `(2k + leg) % 8` (an ADS entry ended). Before an even leg above 0, 8 idle beats: `1018:0074` in the first (a `reset` row), `1018:0094` in each.
- A leg beat calls `1018:0b46(spot, heading)`, writes an `at` row, and calls `1018:0094` when the answer is 0. The leg ends on an answer of 1; after 1500 beats it would write a `stuck` row.
- A code hook at `1018:011d` checks each pick: the chosen pair must lie in Johnny's group and name a segment above 0. Otherwise it writes the beat's rows so far and a `bad` row (the leg), and the case ends there. This is the one row kind the overview's `Trace format` did not list.
- The `state` row: spot, heading, target spot, target heading, wanted heading, end heading, end spot (all signed), the route as `from,to`, the next record and the frame as `segment:record` (a turn frame is `turn set:heading`), the delay, and the random write index `1068:1ce6`.
- `test_original_walk.py` pins: the table block and its name string; the frame lists back to back from `0aea` to `1660` and `1018:03ea` giving 0 for 0 and 35; the route lists back to back from `0362` to `0aa2` and `1018:03ac` giving 0 for spot 0 and from = to; every leg of cases 0, 7, 23, 35 ending with Johnny on the target spot and heading; one JOHNWALK sprite per drawing beat with its three rects (B → A 0, B → A 1, C → B 0) at the sprite's place and size, and the delay 4 after it; case 4 ending in a `bad` row in leg 2, on the end spot of a left-over route.
- Rows: 48257 `at`, 48831 `state`, 51867 `sprite` (48599 Johnny, 3268 palm trunk redraws, BACKGRND sprite 13), 145797 `dirty` (3 per Johnny), 68 `reset`, 6 `bad`, no `stuck`.
- Observed: 202 legs ended, the longest after 648 beats (case 5, leg 4). Johnny's frame changed 6138 times: 830 turn frames and 5308 segment frames.
- Observed: cases 4, 11, 18, 19, 25, 26 end in a `bad` row, all the same way. The leg before the idle stretch had target spot 0, which `1018:0b46` does not store, so it ended at once with Johnny away from the stored target. The idle stretch then picked a route toward that older target, the next leg set a new target, and Johnny walked the old route on to its end spot, whose (0, 0) group he then read past. In the game the same happens when an idle entry ends before Johnny is back on the last ADS entry's start spot. The other 30 cases never pick outside a group.

## Past fixes reviewed

No row of the "Past fixes to re-check" table in `docs/re/open-questions.md` belongs to chunk 8.

- `052884d` (walking + pathfinding): ported jc_reborn's walk: a depth-first path search over a spot connection matrix with a path picked by `Math.random`, frame "bookmarks", a 6-tick frame delay, an 80-tick rest on arrival, and the palm leaves drawn over Johnny. Original: no search; a route table of per-spot segment choices by percent with the story's random generator (`1018:03ac`, `1018:0094`), a 4-tick delay set again after every draw, no rest, and only the palm trunk redrawn over him (`1010:1551` mode 0). Verdict: replaced by `src/walk/walk.ts`.
- `27692e6`, `850e1f3`, `1717846` (chunks 5 to 7): moved the old walk onto the display model, the ADS tick, and the story bridge (OQ-25). Verdict: the bridge is gone with the old walk; OQ-25 is resolved.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1018:0000` | `walk_loadJohnWalkBmp` | `src/walk/walk.ts:43` `loadWalk` (called from `src/main.ts` after the first `drawIsland`) | fixed |
| `1018:004d` | `walk_freeJohnWalkBmp` | none (nothing to free in JavaScript) | match |
| `1018:0074` | `walk_resetPath` | `src/walk/walk.ts:70` `walkReset` | fixed |
| `1018:0094` | `walk_step` | `src/walk/walk.ts:77` `walkStep` (`advance`, `drawFrame`; a pick outside the group drops the route, OQ-37) | fixed |
| `1018:03ac` | `walk_routeOf` | `src/walk/walk.ts:54` `routeOf` (`src/walk/walk-tables.ts` `ROUTES`) | fixed |
| `1018:03ea` | `walk_segmentFrames` | `src/walk/walk.ts:59` `segmentFrames` (`src/walk/walk-tables.ts` `SEGMENTS`) | fixed |
