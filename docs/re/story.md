# Story and Main Loop

How the original picks and plays scenes: the timer-driven step, the clock, sequences built from the scene table, day counters, holidays, time slots, settings, and the random generator. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 7. One claim per address. Our own words; no decompiled code. The island drawing is in `docs/re/island.md`; walking is chunk 8.

## Startup and shutdown

- `1008:0000`: WinMain. A second instance (previous instance not 0) returns 1 at once. A leading `-` or `/` is skipped; `c`/`C` opens the settings dialog (resource `0x58`) and exits; `s`/`S` runs the saver; anything else (an empty command line too) opens dialog `0x6d` first and then runs the saver.
- `1008:0000`: registers the window class with the window procedure `1008:0fcd`, creates a popup window the size of the screen, posts `WM_USER`, and runs a plain `GetMessage` loop. On the way out it shows a message box when `1068:0054` holds an error string id.
- `1008:0fcd`: `WM_CREATE` loads the settings (`1008:0c5c`) and starts timer 1 at 50 ms. `WM_DESTROY` kills the timer, runs the cleanup callback `1068:2d8c` (`1008:157b`) once and clears it, then saves the settings (`1008:0dc8`).
- `1008:0fcd`: `WM_PAINT` and `WM_ERASEBKGND` add a kind-1 dirty rect `B → A` for the painted rect (shifted by the centering offset); `WM_ERASEBKGND` fills the client rect black first. The next restore pass presents it.
- `1008:0fcd`: `WM_USER` runs once (flag `1068:00ca`). It quits with an error when less than about 2.5 MB of global memory is free, then calls `1008:143c` and quits with another error when that fails.
- `1008:143c`: startup order: saves the current directory (`1068:2e20`) and changes to `SourceDir` (`1068:2dc4`); reads `RESOURCE.MAP`; screen size 640 × 480 (`1068:2562`/`2564`); scale modes `2e74`..`2e77` all 3; display init (`1038:1744`, failure returns 0); `1068:429e = 1` (the window is painted from B); loads and selects `JOHNCAST.PAL` (`1068:024a`).
- `1008:143c`: then draws `INTRO.SCR` (`1068:0257`) with B as source and target, makes A the target, and copies the whole screen B → A. This is the intro picture; nothing else shows it, and the first story step (50 ms later) wipes it.
- `1008:143c`: then `1040:076a(13)`, `1040:07e6(1008:16c2, 4)` (the clock), `1018:1ed4` (seed), `1010:0136` (the first call only loads the island bitmaps), `1018:0000` (`JOHNWALK.BMP`), `1048:0000`, `1068:287a = 0`, `1020:0000` (sounds), and last the cleanup callback `1068:2d8c = 1008:157b` and the idle callback `1068:2d90 = 1008:15c8`. When the island or walk bitmaps fail it runs `1008:157b` and returns 0.
- `1008:157b`: closes the MCI device, ends the sequence (`1018:0673`, which wipes), frees the island bitmaps (`1010:03ce`), the walk (`1018:004d`), every ADS (`1048:001b`), the cursors and timers (`1030:017f`), the display, and goes back to the saved directory.
- `1008:033e`: returns 1. WinMain and `1020:019c` ask it before opening a dialog.

## Timing

- `1008:0fcd`: `WM_TIMER` (`0x113`) does nothing while `1068:2d86` is set (`1008:13cd` sets it while it dispatches one input message during wipes and file reads). Otherwise it runs the timer callbacks (`1040:089a`), calls the idle callback `1068:2d90` (`1008:15c8`) once, then loops on `PeekMessage` without removing, running `1040:089a` on every pass, until any message is waiting.
- `1008:0fcd`: so the story step runs once per `WM_TIMER`, at most once per 50 ms. Windows posts at most one `WM_TIMER` at a time, so a slow step never causes a burst of steps. Between steps the window procedure spins on the timer callbacks, so the clock keeps running at its own rate, independent of steps.
- `1040:076a(n)`: when the base tick `1068:45de` is 0, sets it to `1000 / (n × 18)` ms (32-bit signed division) and `1068:45e2 = 1`; returns 1. With `n = 13` the base tick is 4 ms. A second call returns 0 and changes nothing.
- `1040:07e6(callback, interval)`: fills the first empty slot of 5 at `1068:45ac` (10 bytes each: far callback, period, 32-bit next time) with the callback, the period `base × interval` ms, and the next time = `GetCurrentTime` now. Returns 0 when the base tick is 0, the callback is null, the interval is 0, or all slots are taken. The clock gets `4 × 4 = 16` ms.
- `1040:089a`: on the first call (`1068:257c` is 1 in the data segment and nothing sets it again) it only sets every used slot's next time and the base time `1068:45a8` to now, clears the flag, and returns.
- `1040:089a`: later calls: for each used slot in order, while its next time `<=` now (32-bit, high word signed), next time += period and the callback runs. A slot late by k periods fires k times in a row: missed ticks are caught up, never dropped.
- `1040:089a`: then the base time moves on by the base tick until it is `>=` now, counting `1068:45e0` down once per step when it is not 0. Nothing else reads or writes `45e0`.
- `1040:079e`: when the base tick is set: empties the five slots, clears `45de` and `45e2`, returns 1. Only `1030:017f` (shutdown) calls it.
- `1040:085a(n)`: empties slot `n - 1` for `n` in 1..4. Unreferenced.
- `1008:16c2` (the clock, no direct caller, registered by `1008:143c`): adds 1 to the 32-bit clock `1068:2e70` (low) / `2e72` (high), then counts down by 1 each of these words when it is not 0: `1068:30d4` (walk frame delay, set to 4 by `1018:0094`; chunk 8), `334c` (idle-entry wait, `1018:06bf`), `0288` (surf timer, `1010:0e74`), `028a` (ocean-wave timer, `1010:04a2`), `3f2c`. No other instruction names `3f2c`, so it is dead.
- `1008:16c2`: the clock rate is 62.5 Hz (one tick per 16 ms), as long as `GetCurrentTime` moves smoothly. Every delay the ADS and TTM side keeps is in these ticks.
- `1008:15c8`: runs the story step `1018:06bf`, then reads `GetCurrentTime`. The first time it stores it in `1068:2e18`; later calls set `1068:30bc = (1068:2e14 × 100000 / (now - 2e18)) / 10` (32-bit; `2e18` is moved back by 1 when it equals now, so the division never sees 0), and never move `2e18` again.
- `1008:15c8`: no instruction writes `1068:2e14` (a byte scan of every code segment finds only this read), and the data segment holds 0 there, so `30bc` is always 0. `1010:04a2` reads `30bc` (`docs/re/island.md`).
- `1008:15c8`: a second figure from the call count `1068:2e16` and `1068:2e1c` is computed every second call and thrown away.

## Random

- `1018:1e60`: additive lagged Fibonacci generator over 56 words at `1068:1ce8`, read index `1068:1ce4` (24 in the data segment), write index `1068:1ce6` (55). One call adds the word at the read index to the word at the write index (16-bit wrap), returns that new word, and moves both indices on by 1, back to 0 at 56. The write index moves first; nothing depends on the order.
- `1018:1e60`: one generator serves everything: the story (`1018:06bf`, `0d50`, `1ef5`), the island (`1010:0136`, `04a2`, `0a38`, `0b67`, `14bf`), the walk (`1018:0094`), ADS random blocks (`1048:0cda`), and TTM random (`1058:040c`). The order of calls across subsystems decides every value.
- `1018:1eb6(n)`: calls `1018:1e60` `n` times (`n` as an unsigned count; 0 calls none).
- `1018:1ed4`: seeds by `1018:1eb6(time(NULL) & 0xffff)`, the low word of the seconds since 1970 (`1000:082c`). There is no other seeding: the start table is fixed, so two runs started in the same second play the same story.
- `1000:082c`: Borland `time()`: reads the DOS date and time and returns the seconds since 1970 in `DX:AX`; also stores them when the pointer is not null.
- `1018:1ef5(w1, w2, ..., 0)`: draws one value `r`, then for `i = 1, 2, ...`: `t = (wi × 0x28f) & 0xffff` (`0x28f` = 655, about 65536 / 100, so `wi` is a percentage); when `t > r` (unsigned) it returns `i`, else `r -= t`. It returns 0 when the list ends. So `[50]` is a 50% chance of 1, and a list summing to 100 almost always returns one of its indices.

## Settings

- `1008:0c5c`: reads `SCRANTIC.INI` (`1068:00a9`), section `ScreenSaver.ScreenAntics` (`1068:0090`), each key with the current global as its default: `SourceDir` → `1068:2dc4` (string, 80 bytes, default the current directory), `Background` → `00b6`, `Clouds` → `00b8`, `Waves` → `00ba`, `Sounds` → `00bc`, `Password` → `2d9c` (string, 40 bytes, encoded by `1020:0106`), `NumDays` → `2d9b` (byte), `Introduction` → `2d9a` (byte), `CurrentYear` → `2d98`, `CurrentMonth` → `2d96`, `CurrentDay` → `2d94`, `StartTime` → `00be`.
- `1068:00b6`..`00be` hold 1, 1, 1, 1, 900 in the data segment; `2d94`..`2d9b` hold 0. So a fresh install has Background, Clouds, Waves, and Sounds on, StartTime 9:00, and NumDays, Introduction, and the stored date all 0.
- `1008:0c5c` runs on `WM_CREATE` and when the settings dialog opens. `1008:0dc8` writes every key but `SourceDir` back (numbers with `wsprintf`) on `WM_DESTROY` and on the dialog's OK. The story changes only NumDays, Introduction, and the date between the two.
- `1008:12eb(dialog, hhmm)`: the dialog's StartTime: wraps below 0 and at 2400 (with a beep), rounds minutes 60..69 up to the next hour, else snaps to :00 (below 30) or :30, stores it in `00be`, and shows it. The up and down buttons step it by 30. The INI value is used as is, so a hand-edited StartTime need not be on the half hour (`1018:0c21` copes).

## Scene table

- `1068:1756`: 80 entries of 17 bytes, then a 0 word. All bytes are signed. Fields: `+0x00` word id (200..215, groups of related entries), `+0x02` weight, `+0x03` start spot, `+0x04` start heading, `+0x05` end spot, `+0x06` end heading, `+0x07` length (budget units, 5..105), `+0x08` first slot, `+0x09` slot after the last, `+0x0a` day (0 = any; 1..11), `+0x0b` word flags, `+0x0d` word place, `+0x0f` ADS id, `+0x10` ADS tag.
- `1068:1756`: spots are 1..6, 0 meaning anywhere (start) or "pick one" (end); headings 0..7. Entry 0 (id 200) is all zero apart from the id: weight 0 and tag 0, so no pick ever returns it.
- `1068:1756`, flags `+0x0b`: `0x01` may open a sequence (pick kind 1; on the closing scene it means the scene is the whole sequence), `0x02` may fill the middle (kind 2), `0x04` may close a sequence (kind 4), `0x08` may repeat (the 14 idle entries only), `0x10` hides the holiday sprite (entry 79), `0x200` forces high tide (17 entries), `0x400` shifts the TTM island offset by `0x110` (entries 8, 13, 22, 23, 26), `0x800` island mode 1 (entry 11), `0x1000` still island (entries 4, 11, 52, 53, 79), `0x2000` island mode 2, no island (entries 69, 71, 72, 73), `0x4000` no raft (entry 13). No entry uses any other bit, and none uses `0x80`.
- `1068:1756`, place `+0x0d`: the low 6 bits say where on the island the scene needs room. `0x01`: entries 8, 13, 27; `0x02`: 13, 37; `0x04`: 27; `0x08`: 4, 9, 10, 11, 12, 37, 52, 53; `0x10`: 24, 25, 76..79; `0x20`: 26. Bit `0x8000` is the runtime "pending" mark of a queued entry, bit `0x4000` the runtime candidate mark of `1018:0d50`; both are 0 in the data segment.
- `1068:1756`: entries 54..67 (id 212) are the idle entries: ADS id -1, tag 1, weight 1, length 5, flags `0x0b` (open, middle, repeat), start and end on the same spot and heading.
- `1068:1756`: the day scenes, one per day 1..11: 9 (day 1), 68 (2), 69 (3), 10 (4), 11 (5), 70 (6), 12 (7), 13 (8), 71 (9), 72 (10), 73 (11). Those that may close a sequence (flag 4): 9, 10, 11, 12, 13, 69, 71, 72, 73; the other two (68, 70) can only be extras. 10 and 13 also have flag 1. The slot ranges of 10, 11, 71, 72, 73 start at 8 or 12, but the day pick ignores slots (`1018:0d50`), so they play at any time.
- `1068:166e`: the ADS file table, 17-byte entries: id word, 13-byte name, cached ADS slot word (0 = not loaded). Ids: -2 (no name, loads from a buffer at `1068:361c`; no scene uses it), 101 `ACTIVITY.ADS`, 102 `BUILDING.ADS`, 104 `FISHING.ADS`, 105 `JOHNNY.ADS`, 106 `MARY.ADS`, 107 `MISCGAG.ADS`, 108 `STAND.ADS`, 109 `SUZY.ADS`, 110 `VISITOR.ADS`, 111 `WALKSTUF.ADS`; ends at id 0. No id 103.
- `1018:0e7b(id, n)`: the `n`-th entry with an id, or 0. Unreferenced.

## Time slots and holidays

- `1000:020f`: Borland `gettime`: writes hour, minute, second, hundredths (one byte each) at a near pointer.
- `1000:01f4`: Borland `getdate` into a 5-byte buffer at a near pointer: day byte `+0`, month byte `+1`, year word `+2`, weekday byte `+4`.
- `1018:0c21(hhmm)`: `(hhmm / 50 + (hhmm % 100) / 30 + 14) % 16`, all signed. For an on-the-hour or half-hour time this is `2 × hour + (minute is 30) + 14`, mod 16: 16 half-hour slots in an 8-hour cycle, so 9:00 and 17:00 are the same slot.
- `1018:0540`: the time slot `1068:30b8 = (1018:0c21(now) - 1018:0c21(StartTime) + 16) % 16`, where `now = hour × 100 + (minute >= 30 ? 30 : 0)`. Slot 0 is StartTime; each slot is half an hour later, and the cycle repeats every 8 hours.
- `1010:0136` draws the night screen for slots 12..15 (`docs/re/island.md`), so the last two hours of every 8-hour cycle starting at StartTime are night. Entries with a first slot of 12 play only then; entries ending at slot 8 or 12 never play at night.
- `1018:0540`: the holiday `1068:30ba` from the date (unsigned byte compares): October 29..31 → 1, December 23..25 → 2, December 29..31 → 3, January 1 → 3, March 15..17 → 4, any other day → 0. The tests run in that order; the ranges do not overlap.

## Day counters

- `1018:0b87`: when today (`1000:01f4`) differs from the stored `CurrentYear` (word) / `CurrentMonth` / `CurrentDay` (the bytes widened to words): first `NumDays += 1` when `NumDays < Introduction` (signed bytes); then when `NumDays > 11` or `NumDays < 2`, both NumDays and Introduction become 1; then today is stored.
- `1018:0b87`: then, whether or not the date changed: when `1068:30ee` (this is a new sequence) and `1068:30ec` (the last queue held a day scene of the current Introduction) and `Introduction <= NumDays`: `Introduction += 1`. Then `30ec` and `30ee` are both cleared.
- `1018:06bf` sets `30ee = 1` just before each `1018:0540`, so the second test always sees it set.
- `1018:0d50`, kind `0x80`: one draw in ten (`rand % 10 == 0`, unsigned) sets `Introduction = NumDays` and looks for the day scene of that day; the other nine return none. So Introduction is NumDays + 1 only between a sequence that queued the current day scene and the next hit of the one-in-ten draw.
- `1018:089b`: sets `30ec` when the closing scene's or the extra's day equals Introduction. Only day scenes have a day other than 0, and Introduction is at least 1 once `1018:0b87` has seen a date, so in practice `30ec` means "a day scene was queued (or chosen as the extra)".
- Example, a fresh install (NumDays, Introduction, and date 0). Date 1: the date differs, `0 < 0` is false, NumDays 0 is below 2, so both become 1. Sequences run with no day scene until the one-in-ten draw picks day 1 (entry 9, a closing scene); that sequence sets `30ec`, so the next sequence makes Introduction 2. Date 2: NumDays 1 is below Introduction 2, so NumDays becomes 2, and the day-2 scene (entry 68) can now come up. If no day-2 scene was picked before date 3 arrives, Introduction is still 2, NumDays stays 2, and the day-2 scene is still the one being offered. NumDays only moves on a calendar day after the current day scene was queued, and after day 11 it goes back to 1.

## Sequence building

- `1018:0540`: one new sequence, in this order: `1018:0673` (wipe and empty the queue); the time slot and holiday (above); `1010:1c41(-1, -1)` (island flags reset); `1018:0b87` (day counters); `1018:089b(slot, 300)`; Johnny's spot `1068:30e2` and heading `1068:30de` from the first queued entry's start spot and heading (sign-extended; spot 0 and heading 0 are stored as they are); position `1068:30f0 = 0`; `1010:0136` (draw the island).
- `1018:0673`: `1020:0364(0)` (the next wipe, `docs/re/graphics.md`); unloads the ADS of every queued entry (`1018:0d11` with its ADS id) up to the first 0; then sets queue word 0 (`1068:30f2`) and the position `1068:30f0` to 0. The other queue words keep their old values.
- `1068:30f2`: the queue: near pointers into the scene table, ending with 0. `1068:30f0` is the index of the current entry.
- `1010:1c41(flags, place)` as the story uses it: `(-1, -1)` resets the island state; any other call adds an entry's needs to it (high tide, no raft, holiday hidden, still, island mode, place bits). The bits and their globals are in `docs/re/island.md`. The story calls it for every queued entry, closing scene first.
- `1018:0eb5(flags, place)`: true when nothing is placed yet (`1068:30be == 0xffff`). Otherwise false when the entry's place bits clash with what is placed: `0x20` clashes with `0x2a`; `0x10` with `0x15`; `0x01` without `0x02` with `0x2a`, without `0x04` with `0x30`; `0x02` without `0x01` with `0x15`, without `0x08` with `0x30`; `0x04` without `0x08` with `0x2a`, without `0x01` with `0x0c`; `0x08` without `0x04` with `0x15`, without `0x02` with `0x0c`. An entry with no place bits always fits.
- `1018:0d50(kind, slot, budget)`: kind 4 sets the budget to 999; kind `0x80` returns none nine times in ten, else sets Introduction to NumDays and the budget to 999 (see Day counters).
- `1018:0d50`: walks the table, clears every entry's candidate mark, and marks an entry when: for kind `0x80`, its day equals Introduction; otherwise (and also for kind `0x80` when the day does not match) its flags share a bit with `kind`, its tag is not 0, `first slot <= slot < slot after` (signed), its day is 0, `length / 2 < budget` (signed, rounded toward 0), and `1018:0eb5` says it fits. The place word is also tested against the sign of `kind`, which adds nothing since every kind is below `0x8000`.
- `1018:0d50`: the marked weights are summed (as a word). A sum of 0 returns none. Otherwise `k = rand % sum + 1` (unsigned), and the result is the first marked entry, in table order, at which the running total of weights reaches `k`.
- `1018:0d50`: the day test ignores slot, tag, budget, and place, so a day scene can be picked at night or on a crowded island. Kind `0x80` has no other matches, since no entry has flag `0x80`.
- `1018:089b(slot, budget)`, the day scene: `1018:0d50(0x80, slot, 0)`. When it returns an entry that is neither the last closing scene `1068:30e6` nor the last extra `1068:30e8`, it becomes the day scene `1068:30ea` (for sound 25), and the closing scene when it has flag 4, else the extra.
- `1018:089b`, the closing scene: picked with kind 4 while it is none, equals `30e6`, or (when there is an extra) has flag 1. The pick runs with the island reset, so `1018:0eb5` always passes, and every slot has at least 16 closing scenes, so the loop ends.
- `1018:089b`: the budget loses the closing scene's length and `1010:1c41` adds it; then `30e6` = the closing scene. With an extra: the budget loses its length too and `1010:1c41` adds it. `30e8` = the extra, or 0. Then `30ec` (see Day counters).
- `1018:089b`, the opening: a closing scene with flag 1 is the whole sequence: the budget becomes 0 and nothing else is queued. Otherwise, when there is an extra with flag 1 and `1018:1ef5(50)` hits, the extra opens (and is no longer pending as an extra); else a kind-1 pick opens: the budget loses its length and `1010:1c41` adds it.
- `1018:089b`, the opening pick never finds nothing with this table: every slot has at least 44 opening entries, many with no place bits (which always fit), and the budget left is at least `300 - 105 - 60 = 135`, above half of any length. A null result would be queued as the end of the queue and its length read from `DS:0007` (OQ-34).
- `1018:089b`, the middle: while the budget is not 0 and fewer than `0x12a` (298) entries are queued: when the extra is still pending and `1018:1ef5(5)` hits, the extra is queued; else a kind-2 pick (none ends the middle) is queued 1 time, or for a flag-8 entry `n` times with `n` drawn by `1018:1ef5(10, 20, 30, 20, 10, 10)` (1..6, drawn again on 0) and drawn again while `n > 1` and `length × n > budget` (signed). Every copy loses its length from the budget and goes through `1010:1c41`.
- `1018:089b`: the budget can go below 0 (an entry's length is only checked as `length / 2 < budget`). The loop goes on while it is not 0, but a negative budget makes every kind-2 pick fail, so the middle ends.
- `1018:089b`: an extra still pending when the middle ends is not queued at all. Its `30e8`, `30ea`, and `30ec` effects stay.
- `1018:089b`: last, the closing scene and a 0 end the queue, and every queued entry gets the pending bit `0x8000` in its place word.

## Story step

- `1018:06bf`: does nothing while `1068:334a` is set. No instruction writes `334a` (byte scan of every code segment) and it is 0 in the data segment, so the step always runs.
- `1018:06bf`: reads the entry at the position. When it is 0, or when the byte `1068:1dbc` is 2, it sets `30ee = 1`, builds a new sequence (`1018:0540`), and reads the entry again (position 0). No instruction writes `1dbc` by its address and the data segment holds 0, so only the end of the queue starts a new sequence.
- `1018:06bf`: then `1010:040e(0)` (the island step). From here on the step works on the entry read at the start, even after the position moves on.
- `1018:06bf`: when the entry is pending and `1018:0b46(start spot, start heading)` says Johnny is not there yet, it runs `1018:0094` (walk toward the start) and skips to the end of the step.
- `1018:06bf`, idle entry (ADS id -1): on its first step (pending set) it clears pending, sets the wait `1068:334c = rand % 240 + 180` clock ticks (about 2.9 to 6.7 s at 16 ms), and calls `1018:0074`. On every step it calls `1018:0094` (Johnny stands, turns, and is drawn), then, when `334c` is 0 (counted down by `1008:16c2`), it ends the entry.
- `1018:06bf`, ADS entry: on its first step it loads the ADS (`30e4 = 1018:0c62(id)`), selects its slot (`1048:04fc`), starts the tag (`1048:0874`), clears pending, and sets the TTM island offset (`1010:00fc(flags & 0x400)`). On every step, the first one included: `1048:04fc(30e4)`, `1048:1acb` (the ADS tick), and when `1048:0766(tag)` says the tag is no longer busy, it ends the entry.
- `1018:06bf`, ending an entry: Johnny's spot and heading become the entry's end spot and heading, the pending bit is set again, and the position moves on by 1. After an ADS entry only, an end spot of 0 becomes `rand % 6 + 1` and an end heading of 0 becomes `rand & 7` (spot first). An idle entry has no 0 end spot.
- `1018:06bf`: the entry's pending bit is set again when it ends, so an entry queued twice in a row (a repeat) starts fresh each time, and the whole queue is pending again for the next sequence that queues the same entries.
- `1018:06bf`, last: `1010:1e50(0)` (holiday sprite); when `1068:30ea` is this step's entry, sound 25 (`1020:00ba(0x19)`) and `30ea = 0`, so the day scene plays sound 25 on its first step, or the first step on which Johnny is still walking to it; then `1060:03d3(0)` (the dirty-rect restore pass).
- `1018:0b46(spot, heading)`: stores the walk target: `1068:30e0 = spot` unless 0, `1068:30dc = heading` unless -1. Returns 1 when (spot is 0 or equals Johnny's spot `30e2`) and (heading is -1 or equals Johnny's heading `30de`). The story passes the start heading, which is never -1, so heading 0 must match too.
- `1018:0074` (chunk 8): clears the walk path state `1068:30d0`/`30ce` and sets the wanted heading `30c8` to Johnny's heading.
- `1018:0094` (chunk 8): when the frame delay `30d4` is 0, takes one walk or turn step toward `30e0`/`30dc` (with random path choices); every call draws the current Johnny frame, redraws the island in front of it (`1010:1551`), adds its dirty rects, and sets `30d4 = 4` (a new frame at most every 4 clock ticks).

## ADS by id

- `1018:0c62(id)`: when `id` differs from the current id `1068:334e`, unloads the current id's ADS (`1018:0d11`) and makes `id` current. Then finds `id` in `1068:166e`: when its cached slot is 0 it loads the file (`1048:0079`) and caches the slot. Returns the slot, or 0 for an unknown id.
- `1018:0d11(id)`: finds `id` in `1068:166e`; when it has a cached slot, unloads it (`1048:067f`) and clears the cache. Id -1 (idle) is not in the table, so it does nothing.
- So an ADS stays loaded, with its section states and nodes, while the ADS entries of a sequence keep the same id; idle entries between them do not count. A different id unloads it. `1018:0673` unloads the ADS of every queued entry at the end of the sequence, so every sequence starts with fresh ADS files. `334e` is not reset there, which only spares a second unload.

## Exit and dialogs

- `1008:0221`: the default message handling: a mouse move of more than 3 pixels (Manhattan distance) from where the first move was seen, any button down, a key down (`0x100`, `0x104`), or `WM_ACTIVATE`/`WM_ACTIVATEAPP` with deactivation and no password calls `1020:019c`; `WM_DESTROY` posts quit; `WM_SETCURSOR` hides the cursor.
- `1020:019c`: guarded against reentry; asks for the password with dialog `PasswordProtection` (`1020:026e`) when one is set, beeps on a wrong one, otherwise sends `WM_CLOSE` to the main window.
- `1008:034f`: the settings dialog: Background, password, Sounds, StartTime up and down; OK saves with `1008:0dc8`. Clouds and Waves have no control in the dialog, only INI keys.
- `1008:0517`: draws the owner-drawn StartTime up and down buttons.
- `1008:0a2d`: the change-password dialog: OK is enabled only when the new password matches its confirmation (case-insensitive); on OK it checks the old password when one is set and stores the new one with `1020:0106`.
- `1020:0106`: encodes a password: each byte XORed with the matching byte of `Dynamix (JTP - Jeff Tunnell Productions)...` (`1068:1d68`) plus `0x21`. `1020:013f` compares a typed password the same way.
- `1020:026e`: the password prompt's dialog procedure. `1020:082a`: an exported dialog procedure that returns 0.
- `1020:081c`: the debug log; empty in this build. `1008:13cd`: dispatches one pending input message with `1068:2d86` set; wipes and file reads call it so input still ends the saver.
- `1020:0000`: when Sounds is on, finds, loads, and locks the `WAVE` resources `WAVESFX1`..`WAVESFX25` in the executable into a table. `1020:0085`: closes the MCI device (Sounds on). `1020:00ba(n)`: plays sample `n` (1..25) with `sndPlaySound` (async, from memory, no default) when Sounds is on and the sample loaded.
- `1020:00ba`: the story itself plays only sample 25, for the day scene (`1018:06bf`); TTM `0xc051` (`1058:0000`) plays the others.
- None of these change the picture or the timing of the screen saver (OQ-35).

## Emulated

`scripts/re/unicorn/original_story.py` (`dump_story.py` writes `re/fixtures/story/`, gitignored).

- Runs as original code: the random generator (`1018:1e60`, `1018:1eb6`, `1018:1ef5`), and `1018:0540` with everything it calls: `1018:0673`, `1018:0c21`, `1010:1c41`, `1018:0b87`, `1018:089b`, `1018:0d50`, `1018:0eb5`.
- Replaced by handlers that return 0 and do nothing: `1010:0136` (draw island), `1020:0364` (wipe), `1018:0d11` (ADS unload), `1020:081c` (debug log). `1000:020f` and `1000:01f4` write the case's wall clock (seconds and hundredths 0; weekday from the date). Nothing else needed a handler: the builder touches only the data segment.
- `random.tsv` (`kind seed call value`): for each discard `n` in 0, 1, 55, 1000, 65535, a fresh emulator, `1018:1eb6(n)`, then 300 rows of `1018:1e60`. Then one fresh emulator and, for each list `[50]`, `[5, 10, 15]`, `[20, 30, 50]`, `[10, 20, 30, 20, 10, 10]`, `[35, 5, 5, 5]`, `[30, 50]`, `[35]`, `[30]` in this order, 200 calls of `1018:1ef5`, the generator going on across lists. 3100 rows.
- `sequences.tsv` (`case build event values`): each case `k` (0..15) is a fresh emulator with NumDays `k % 13`, Introduction `5k % 13`, the stored date `(1992, 6, 1)` for odd `k` else `(0, 0, 0)`, StartTime `[900, 0, 1230, 2330][k % 4]`, and `1018:1eb6([0, 1, 55, 56, 1000, 4096, 31337, 65535][k % 8])`. Build `b` (0..29) sets the wall clock to `[(1992, 10, 29), (1992, 12, 24), (1992, 12, 31), (1993, 1, 1), (1993, 3, 16), (1992, 6, 1)][k % 6]` at `(3k % 24):(7k % 60)`, plus `b / 3` days and `97b` minutes, sets `30ee = 1`, calls `1018:0540`, and writes a `queue` row (scene table indices) and a `state` row (the 21 globals of the overview's `Trace formats`). 960 rows.
- `scene-table.bin` (1362 bytes from `1068:1756`, the 80 entries and the 0 word) and `random-table.bin` (116 bytes from `1068:1ce4`: the two indices, then the 56 words) are the raw tables the TypeScript constants are checked against.
- `test_original_story.py` pins the harness: the generator against a Python model, discards, the percent pick, one queue and one state row per build, Johnny at the first entry's start, the slot formula, and day 1 for a fresh install.
- Observed: 48 of the 480 queues hold a day scene, every day 1..11 at least once. Queues are 1 to 27 entries long (mean 13.4); the one-entry queues are all entry 37, the only closing scene with flag 1. No queue holds an index outside 1..79, so the null opening pick (OQ-34) never happened.
- Observed: NumDays and Introduction move as `Day counters` says. NumDays goes up by 1 only on a date change while it is below Introduction; Introduction goes up by 1 on the sequence after a day scene of its day was queued, and falls back to NumDays when the one-in-ten day draw hits (case 4, builds 1..2: 5/6, then 5/5). Case 7 shows the wrap: NumDays 11 below Introduction 12 becomes 12, then both 1.

## Past fixes reviewed

- `8adc66a` (various consistency fixes), story and island part: random cloud count and placement band, a 2-frame surf counter, sound 17 for a day scene, and a scene end test without the stop request. Original: clouds come from `1010:0a38` (15 records, 30% each, `1018:1ef5(5, 10, 15)` kinds, y from 1 within `0x8b`), the surf counters cycle 0..2 (`1010:0e74`), the day scene plays sound 25 (`1018:06bf`), and an entry ends when `1048:0766` says its section is idle. Verdict: differs in every part; replaced by `src/island/island.ts` and `src/story/story.ts`.
- `1204c0d` (chain instant phase transitions in one tick): ran up to five phase changes per tick so a scene end and the next walk start happened together. Original: there are no phases; one `1018:06bf` per `WM_TIMER` does whatever the current entry needs, and a new sequence is built and its first entry run in the same step. Verdict: only mattered in the old story; replaced by `src/story/story.ts` (`storyStep`).
- `c037b5f` (order storyTick → adsTick → storyAnimateBg): ran the phase step before the ADS tick and the island animation. Original: `1018:06bf` runs the island step first (`1010:040e(0)`), then the walk or the entry's ADS tick, then the holiday redraw (`1010:1e50(0)`), sound 25, and the restore pass (`1060:03d3(0)`). Verdict: differs; `storyStep` follows the original order.
- `194d7fb` (thread leak sweeps), story part: freed running threads before a scene, before a walk, and after a walk. Original: no ADS tick runs during a walk or an idle entry (`1018:06bf`), and every new sequence drops the cached ADS (`1018:0673`). Verdict: only mattered in the old story; the sweeps are gone with it.
- `613b3c2` (8000-tick watchdog): force-ended a scene after 8000 ticks. Original: no time limit in `1018:06bf` (OQ-1); every scene table entry ends on its own with the ported code (`src/story/story.data.test.ts`). Verdict: deleted.
- `d39b9ac` (clear saved zones between scenes): cleared the zone layer at each scene start. Original: the layer pipeline it patched was deleted in chunk 5; saved rects are kept by id on the display (`docs/re/graphics.md`). Verdict: only mattered in the old pipeline; gone with it.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1000:01f4` | `rtl_getdate` | `src/story/calendar.ts:43` `wallClockOf` (`Date`) | match |
| `1000:020f` | `rtl_gettime` | `src/story/calendar.ts:43` `wallClockOf` (`Date`) | match |
| `1000:082c` | `rtl_time` | `src/story/random.ts:57` `seedRandom` (caller passes `Date.now() / 1000`) | match |
| `1008:0000` | `platform_winMain` | none (out of scope, OQ-35) | match |
| `1008:0221` | `platform_defScreenSaverProc` | none (out of scope, OQ-35) | match |
| `1008:033e` | `platform_alwaysTrue` | none (out of scope, OQ-35) | match |
| `1008:034f` | `platform_configureDialog` | none (out of scope, OQ-35) | match |
| `1008:0517` | `platform_configureDialogItems` | none (out of scope, OQ-35) | match |
| `1008:0a2d` | `platform_changePasswordDialog` | none (out of scope, OQ-35) | match |
| `1008:0c5c` | `platform_loadSettings` | `src/story/settings.ts:58` `loadSettings` | fixed |
| `1008:0dc8` | `platform_saveSettings` | `src/story/settings.ts:73` `saveSettings` (after each new sequence, OQ-33) | fixed |
| `1008:0fcd` | `platform_screenSaverProc` | `src/main.ts` loop and `src/engine/clock.ts:19` `EngineClock.stepDue` | fixed |
| `1008:12eb` | `platform_setDialogStartTime` | none (out of scope, OQ-35) | match |
| `1008:13cd` | `platform_pumpInputMessage` | none (out of scope, OQ-35) | match |
| `1008:143c` | `platform_initSaver` | `src/main.ts` startup, `src/island/island.ts:96` `drawIntro` (intro held 2 s, OQ-32) | fixed |
| `1008:157b` | `platform_shutdownSaver` | none (nothing to free in JavaScript) | match |
| `1008:15c8` | `story_idleTick` | `src/main.ts` loop (one `storyStep` per step); `1068:30bc` is never set, `Island.speed` stays 0 | fixed |
| `1008:16c2` | `platform_clockTick` | `src/engine/timers.ts:12` `clockTick` (`30d4` is chunk 8's, `3f2c` is dead) | fixed |
| `1018:0540` | `story_newSequence` | `src/story/story.ts:111` `startSequence` + `src/story/sequence.ts` `newSequence` | fixed |
| `1018:0673` | `story_endSequence` | `src/story/story.ts:100` `wipeDone` + `startSequence` (`state.ads = null`) | fixed |
| `1018:06bf` | `story_step` | `src/story/story.ts:59` `storyStep` (no pause or forced-sequence test: nothing writes `1068:334a` or `1068:1dbc`) | fixed |
| `1018:089b` | `story_buildQueue` | `src/story/sequence.ts:161` `buildQueue` | fixed |
| `1018:0b46` | `story_isAtSpot` | `src/story/story.ts:82` `isAtSpot` | fixed |
| `1018:0b87` | `story_advanceDays` | `src/story/sequence.ts:116` `advanceDays` | fixed |
| `1018:0c21` | `story_halfHourSlot` | `src/story/calendar.ts:25` `halfHourSlot` | fixed |
| `1018:0c62` | `ads_loadAdsById` | `src/story/story.ts:146` `loadAdsById` | fixed |
| `1018:0d11` | `ads_unloadAdsById` | `src/story/story.ts:146` `loadAdsById` / `startSequence` (drop the cached state) | fixed |
| `1018:0d50` | `story_pickScene` | `src/story/sequence.ts:133` `pickScene` | fixed |
| `1018:0e7b` | `story_findScene` | none (unreferenced) | match |
| `1018:0eb5` | `story_fitsIsland` | `src/story/sequence.ts:93` `fitsIsland` | fixed |
| `1018:1e60` | `story_random` | `src/story/random.ts:40` `StoryRandom.next` | fixed |
| `1018:1eb6` | `story_discardRandom` | `src/story/random.ts:48` `StoryRandom.discard` | fixed |
| `1018:1ed4` | `story_seedRandom` | `src/story/random.ts:57` `seedRandom` | fixed |
| `1018:1ef5` | `story_randomPercent` | `src/story/random.ts:22` `percentPick` | fixed |
| `1020:0000` | `audio_loadWaveResources` | none (out of scope, OQ-35) | match |
| `1020:0085` | `audio_closeMciDevice` | none (out of scope, OQ-35) | match |
| `1020:00ba` | `audio_playSound` | `src/story/story.ts:59` `storyStep` (`playSound(25)`); playback out of scope | match |
| `1020:0106` | `platform_encodePassword` | none (out of scope, OQ-35) | match |
| `1020:013f` | `platform_checkPassword` | none (out of scope, OQ-35) | match |
| `1020:019c` | `platform_requestExit` | none (out of scope, OQ-35) | match |
| `1020:026e` | `platform_passwordDialog` | none (out of scope, OQ-35) | match |
| `1020:081c` | `platform_debugLog` | none (out of scope, OQ-35) | match |
| `1020:082a` | `platform_adsControlDialog` | none (out of scope, OQ-35) | match |
| `1040:076a` | `platform_initTimers` | `src/engine/clock.ts:4` `EngineClock` (16 ms, catch-up, resume; even ticks, OQ-36) | fixed |
| `1040:079e` | `platform_clearTimers` | none (no timer is ever removed while running) | match |
| `1040:07e6` | `platform_addTimerCallback` | `src/engine/clock.ts:4` `EngineClock` (16 ms, catch-up, resume; even ticks, OQ-36) | fixed |
| `1040:085a` | `platform_removeTimerCallback` | none (no timer is ever removed while running) | match |
| `1040:089a` | `platform_runTimerCallbacks` | `src/engine/clock.ts:13` `EngineClock.ticksDue` (16 ms, catch-up, resume; even ticks, OQ-36) | fixed |
