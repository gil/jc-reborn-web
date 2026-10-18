# Island

How the original draws the island scene: the background, the island and its placement, surf, raft, holiday sprite, clouds, ocean waves, and the redraws that keep island parts in front of moving sprites. Trust order and conventions: `docs/re/README.md`.

Findings for chunk 7. One claim per address. Our own words; no decompiled code. The story calls these from `1018:0540` and `1018:06bf` (`docs/re/story.md`).

## Globals

- `1068:30a8`, `30aa`, `30ac`: the bitmap lists of `HOLIDAY.BMP` (`1068:02b0`), `BACKGRND.BMP` (`02bc`), `MRAFT.BMP` (`02c9`). Near pointers to tables of sprite records (record `+6` width, `+8` height, `docs/re/graphics.md`).
- `1068:30c4` / `30c2`: x / y. `1010:1b00` writes the island position (top-left of BACKGRND sprite 0); `1010:0136` then subtracts `(0x121, 0x117)`, and from there on they are the island offset that every island part, TTM scene, and walk adds.
- `1068:30c0`: low tide: 1 low, 0 high, `0xffff` not chosen yet. `1068:30be`: the place word (see `Flags from the story`), `0xffff` = nothing placed.
- `1068:30b2`: island mode: 0 island by day or night, 1 night screen always, 2 no island (a filled screen, nothing drawn on it). `1068:30b0`: still island. `1068:30ae`: no raft. `1068:30b4`: holiday sprite shown.
- `1068:30b6`: raft frame 1..5. `1068:30b8`: time slot (`docs/re/story.md`). `1068:30ba`: holiday 0..4. `1068:30bc`: speed, always 0 (`docs/re/story.md`, `Timing`).
- `1068:0280`: wind, 1 (blowing right, the data segment value) or -1. `1068:0282`, `0284`, `0286`: the three surf frame counters (0..2). `1068:0288`: surf timer, `1068:028a`: ocean-wave timer, both counted down by the clock (`1008:16c2`).
- `1068:2e7a`, `2e7c`, `2e7e`: small, medium, and large clouds still allowed. `1068:2e80`: 15 cloud records. `1068:2f34`: number of cloud records in use (15, or 0 with Clouds off).
- `1068:2f36`, `2f38`, `2f3a`, `2f3c`: glints and wave kinds 1, 2, 3 still allowed. `1068:2f40`: 30 wave records. `1068:2f3e`: number of wave records in use (30, or 0 with Waves off or a still island).
- Cloud and wave records are 6 words: x, y, frame, kind, period, countdown. A record with x = 0 and y = 0 is empty; nothing else marks it.
- `1068:2e78`: redraw mode of `1010:1551`: 0 for the walking Johnny, 1 for clouds, waves, and the raft. Set to 1 just around those calls.
- Settings: Background `1068:00b6` (0 = filled screen), Clouds `00b8` (cloud records in use), Waves `00ba` (wave records in use).
- All of `30a8`..`30c4`, `0282`..`028a`, `2e78`..`2f40` are 0 in the data segment.

## Flags from the story

- `1010:1c41(flags, place)` with `(-1, -1)`: place `0xffff`, low tide `0xffff`, mode 0, still 0, no raft 0, holiday shown 1. Called first in every new sequence (`1018:0540`).
- `1010:1c41`, any other call, flags in this order: `0x200` low tide 0 (high tide), `0x4000` no raft, `0x10` holiday hidden, `0x1000` still, `0x800` mode 1, `0x2000` mode 2 (so `0x2000` wins over `0x800`). Flags only ever set; nothing but the reset clears them.
- `1010:1c41`, place: when nothing is placed yet and the entry has any of the low 6 bits, the place word becomes 0. Then entry bit `0x20` sets the whole word to 1, else bit `0x10` sets it to 2 (both overwrite earlier bits). Then entry bits `0x01`, `0x02`, `0x04`, `0x08` add `0x04`, `0x08`, `0x10`, `0x20`.
- `1010:1c41`: so in the place word, 1 means "left island" (entry `0x20`), 2 "low island" (entry `0x10`), and `0x04`..`0x20` four room bits for the other entries. `1018:0eb5` keeps clashing entries out of one sequence (`docs/re/story.md`).

## Placement

- `1010:1b00`: a place word of `0xffff` becomes 0 (it writes the global). With bit 2 set (low island) the position is `(0x121, 0x12b)`; else with bit 1 (left island) `(0x11, 0x135)`. No random draw in either case.
- `1010:1b00`, otherwise: the base and range are `(0xa8, 0xff)` and `(0x6f, 0x3b)` at low tide, `(0x43, 0xff)` and `(0xe2, 0x81)` at high tide (anything but 1 counts as high).
- `1010:1b00`, with a place word not 0: when it is exactly `0x10`, `0x20`, or `0x30`, the y base grows by half the y range. Unless both `0x04` and `0x10` or both `0x08` and `0x20` are set, the y range is halved. When it is exactly `0x08`, `0x20`, or `0x28`, the x base grows by half the x range. Unless both `0x04` and `0x08` or both `0x10` and `0x20` are set, the x range is halved. All halvings are signed division of positive values.
- `1010:1b00`: then `1010:14bf(x, y, -1, base x, base y, range x, range y)`.
- `1010:14bf(px, py, sprite, x0, y0, w, h)`: with a sprite index other than -1, `w` and `h` lose that BACKGRND sprite's width and height. When `w` or `h` is negative (signed), both results are 0 and no number is drawn. Otherwise `x = x0 + rand % w` (unsigned; no draw when `w` is 0), then `y = y0 + rand % h` the same way. x is drawn first.
- `1010:00fc(left)`: TTM island offset `1068:46e4 = x + 1`, `46e2 = y`; `x + 0x111` instead when `left` is set. Both 0 in mode 2. `1010:0136` calls it with 0; the story calls it with the entry's flag `0x400` when an ADS entry starts.
- The left island's offset x is `0x11 - 0x121 = -0x110`, so flag `0x400` (`+0x110`) puts a scene's TTM drawing back where it would be on a centered island. Entry 26 is the only one with place `0x20`, and it has flag `0x400`.

## Drawing the island

- `1010:0136`, every call: when the holiday is not 0 and `HOLIDAY.BMP` is not loaded, loads it.
- `1010:0136`, while `BACKGRND.BMP` is not loaded: clears the mirror flag `1068:4106`, loads `BACKGRND.BMP` and `MRAFT.BMP`, and returns 1 when both loaded. When BACKGRND failed it also sets both record counts to 0; any failure returns 0. Nothing is drawn. `1008:143c` makes this first call.
- `1010:0136`, later calls, background into C (target `1068:1eb8 = 1eb0`): with Background off or mode 2, a filled rect of color 5 over the whole screen (fill on, foreground and background 5: one `PATCOPY`); else in mode 0 with a slot below 12, `OCEAN00.SCR`, `OCEAN01.SCR`, or `OCEAN02.SCR` (`1068:0262`, `rand % 3`); else `NIGHT.SCR` (`1068:02d3`).
- `1010:0136`: so night is mode 1 or slots 12..15, and only when Background is on and there is an island. The draw of the ocean screen is the first random number of the island.
- `1010:0136`: then, when low tide is not chosen, `low tide = rand & 1`; then `1010:1b00` (zero, one, or two draws); then the offset `(x - 0x121, y - 0x117)`; then `1010:00fc(0)`. These run in mode 2 too.
- `1010:0136`, unless mode 2, on C: the raft (`1010:1d69(1)`), BACKGRND sprite 0 (the island) at offset `+ (0x121, 0x117)`; at low tide (exactly 1) sprite 1 at `+ (0xfa, 0x12f)` and sprite 2 at `+ (0x97, 0x148)`; surf timer 0 and all three surf counters 2, then `1010:0e74(0)`; then sprite 14 at `+ (0x18d, 0x117)`, sprite 13 at `+ (0x1bb, 0x94)`, sprite 12 at `+ (0x16e, 0x7a)` (the palm). All plain draws (`1038:0ac2`).
- `1010:0136`, then: source C, target B, a whole-screen copy C → B, and a whole-screen kind-1 dirty rect B → A, age 0. The draw target stays B.
- `1010:0136`, then: wave records in use 0 when Waves is off or the island is still, else 30; `1010:0463`; cloud records in use 0 when Clouds is off, else 15; `1010:0a38`; `1010:040e(1)`; `1010:1e50(1)`. Returns 1.

## Surf

- `1010:0e74(0)`: when the surf timer is 0 it is set to 4 and one counter moves: when `0282 == 0286`, `0282` + 1; else when `0284 == 0282`, `0286` + 1; else `0284` + 1. Any counter above 2 becomes 0. So the three spots step through frames 0..2 one after another, one step per 4 clock ticks.
- `1010:0e74(0)`: then for each spot of the tide in order, when the counters moved or the spot's rect overlaps a dirty rect on A of age 0 (`1060:04b2`), the spot is drawn (`1010:0e74(base)`) and a kind-1 dirty rect B → A of the rect is added, plus one B → C when the island is still (exactly 1).
- `1010:0e74`, the spots at high tide (low tide 0), as `base: rect at offset +`: 3: `(0x10f, 0x132, 0x48, 0x1d)` with counter `0282`; 6: `(0x16d, 0x13f, 0x9c, 0x19)` with `0284`; 9: `(0x207, 0x12f, 0x41, 0x20)` with `0286`.
- `1010:0e74`, at low tide (any other value): 30: `(0xea, 0x143, 0x78, 0x30)` with `0282`; 33: `(0x170, 0x164, 0xab, 0x1c)` with `0284`; 36: `(0x22f, 0x143, 0x51, 0x30)` with `0286`; 39: `(0x82, 0x154, 0x61, 0x1d)` with `0282`.
- `1010:0e74(base)`, with a base: a plain draw of BACKGRND sprite `base + counter` at the rect's x and y. Any other argument draws nothing. The highest sprite used is 41.
- `1010:0e74`: several rects are narrower than their sprites (6: 156 for 160, 9: 65 for 72, 33: 171 for 176, 36: 81 for 88, 39: 97 for 104), so the surf's right columns reach A only when something else presents them.
- `1010:0e74` is called with 0 from `1010:0136` (target C, after the counters were set to 2 and the timer to 0, so the counters move once and every spot is drawn) and from `1010:040e` (target B), and with a base from `1010:1551`.

## Raft and holiday

- `1010:1d69(first)`: with `first`, the raft frame becomes `NumDays - 1`, clamped to 1..5. Draws only when MRAFT is loaded, the frame is not 0, and the no-raft flag is clear.
- `1010:1d69`: the sprite is MRAFT `frame - 1`, at offset `+ (0x201, 0x10a)` at high tide (0), `+ (0x212, 0x119)` otherwise. It is drawn (`1038:0ae4`, flags 0) when `first`, or when its rect overlaps a dirty rect on A of age 0. When not `first`, the draw is followed by `1010:1551` in mode 1. No dirty rect is added.
- `1010:1e50(first)`: draws only when the holiday is not 0, HOLIDAY is loaded, the holiday is shown, and the mode is not 2. Holiday 1: sprite 0 at `+ (0x19b, 0x12a)`, rect 40 × 34; 2: sprite 2 at `+ (0x195, 0x10b)`, 56 × 65; 3: sprite 3 at `+ (0x16a, 0x9b)`, 152 × 47; 4: sprite 1 at `+ (0x14e, 0x11e)`, 128 × 48 (the sprite is 120 × 47).
- `1010:1e50`: a plain draw when `first`, or when the rect overlaps a dirty rect on A of age 0. No dirty rect is added; the story calls it every step after the island step, so it repaints wherever the dirty rects of the step touch it.

## Clouds

- `1010:0a38`: clouds left: 8 small, 4 medium, 2 large. Wind: -1 when `1018:1ef5(50)` hits, else 1.
- `1010:0a38`: walks all 15 records, whatever the number in use: clears x and y; when `1018:1ef5(30)` hits, `1018:1ef5(5, 10, 15)` picks large (1), medium (2), or small (3). A pick with none left falls back: large to medium to small, medium to small. With a cloud: kind 2, 1, 0 for large, medium, small (BACKGRND sprite 17, 16, 15), its count goes down, `1010:14bf(x, y, sprite, 0, 1, 640, 0x8b)`, period `rand % 5 + 6`, countdown `rand % period`, frame 0.
- `1010:0a38`: so with Clouds off the cloud draws still happen (15 records' worth), only nothing shows. A cloud that does not fit lands at 0, 0, which reads as empty, but its count was spent.
- `1010:0b67`, pass 1 (spawn): for each record in use that is empty: `1018:1ef5(20, 30, 50)` picks large, medium, small, without fallbacks. With one: x from `1010:14bf` with base 640 (wind -1) or -1000 (wind 1) and range 1000, y base 1 and range `0x8b`; countdown 0, frame 0, period `rand % 5 + 6`. These start off screen.
- `1010:0b67`, pass 2 (move): for each record in use that is not empty, the countdown goes down by 1; when it was 0: countdown = period, a kind-1 dirty rect B → A of the old rect, x += wind; when the cloud has left the screen (wind -1 and `x + width < 0`, or wind 1 and `x > 640`) the record is cleared and its count goes up.
- `1010:0b67`, pass 3 (draw): for each record in use that is not empty: when (it just moved, countdown == period) or its rect overlaps a dirty rect on A of age 0, and it is on screen (`x + width > 0` and `x < 640`): drawn (`1038:0ae4`, flags 2, mirrored, when the wind is 1, else 0), dirty rects B → A and B → C, then `1010:1551` in mode 1.
- `1010:040e` calls `1010:0b67` only with its argument set, which only `1010:0136` does. So clouds are placed and drawn once per sequence and never move: the move pass runs once, right after the placement, and moves a cloud by 1 pixel at most.

## Ocean waves

- `1010:0463`: glints left 30, kind 1 left 4, kind 2 left 2, kind 3 left 1; clears x and y of all 30 records.
- `1010:04a2`, for each record in use, spawn: when it is empty, `1018:1ef5(35)` is drawn; when that hits and the speed `1068:30bc` is above 100, `1018:1ef5(35, 5, 5, 5)` picks a glint or a wave kind 1, 2, 3 (none: no spawn).
- `1010:04a2`: the speed is always 0 (`docs/re/story.md`, `Timing`), so the original never spawns a glint or an ocean wave, and its wave records stay empty. It still draws one random number per empty record in use on every island step: 30 per step with Waves on and a moving island.
- `1010:04a2`, spawn glint (when any left): kind 0, period `rand % 30 + 10`, countdown = period, `1010:14bf(x, y, -1, 0, 0xd6, 640, 0x23)`; dropped again (x and y cleared) when the point touches the palm trunk rect `+ (0x1bb, 0x94, 0x16, 0x91)` or the palm rect `+ (0x16e, 0x7a, 0x94, 0x45)` (`1010:1a88` not 0); else its count goes down.
- `1010:04a2`, spawn wave kind 1, 2, 3 (when any left): frame 0, period `1018:1ef5(30, 50)` (0, 1, or 2), countdown = period, and `1010:14bf(x, y, -1, ...)` with base and range `(-10, 0xf9)` / `(0x28a, 0x28)`, `(-40, 0x121)` / `(0x2a8, 0x5d)`, `(-70, 0x17e)` / `(0x2c6, 0x8e)`; its count goes down.
- `1010:04a2`, for each record in use that is not empty (spawned this step included), glint: foreground 15, a line from `(x, y)` to `(x + 1, y)` (`1030:02ef`), a kind-1 dirty rect B → A `(x, y, 1, 1)` age 0. When the wave timer is 0 and the countdown, going down by 1, was 0: dirty rects B → A age 1 and C → B age 0 of the same pixel, the record cleared, its count up.
- `1010:04a2`, wave kinds 1..3: when the wave timer is 0, x += wind and the countdown goes down by 1; when it was 0, countdown = period and frame + 1. Then the frame's sprite comes from `1068:0278` (kind 1: 18 19 20 21 20 19 18), `1068:0270` (kind 2: 22..25..22), `1068:0268` (kind 3: 26..29..26), each ended by `0xff`; at the end the record is cleared and its count goes up.
- `1010:04a2`: a wave sprite whose rect lies inside (`1010:1a88` = 2) one of the first three surf rects of the tide is not drawn. Otherwise: a plain draw, `1010:1551` in mode 1, and `1010:1a0d`.
- `1010:04a2`, last: when the wave timer is 0 it is set to 10. So waves move and change frame every 10 clock ticks.

## Redrawing over sprites

- `1010:1551(sprite, x, y)`: saves the clip, sets it on with `(x, y)` to `(x + width, y + height)` inclusive (one pixel wider and taller than the sprite), redraws, and restores the old clip. All redraws are plain draws on the current target.
- `1010:1551`, mode 0 (walking Johnny): only when the sprite's bottom `y + height` is above `y offset + 0x125` and its rect touches the trunk rect `+ (0x1bb, 0x94, 0x16, 0x91)`: sprite 13 again. So Johnny walks behind the palm trunk and in front of everything else.
- `1010:1551`, mode 1, when the sprite touches the island band `+ (0, 0xd6, 0x280, 0x10a)`: at low tide (exactly 1) sprite 2 (rect `+ (0x97, 0x148, 0x39, 0x1e)`), surf 39, sprite 0 (rect `+ (0x121, 0x117, 0x117, 0x33)`), sprite 1 (rect `+ (0xfa, 0x12f, 0x17c, 0x45)`), surf 30, 33, 36; at high tide sprite 0, surf 3, 6, 9.
- `1010:1551`, mode 1: a surf spot is redrawn when the sprite's bottom row `(x, y + height, width, 1)` touches the spot's rect; the island sprites when the whole sprite rect touches theirs.
- `1010:1551`, mode 1, then always: sprite 13 (trunk rect), sprite 12 (rect `+ (0x16e, 0x7a, 0x94, 0x45)`), sprite 14 (rect `+ (0x18d, 0x117, 0x68, 0x26)`) when touched.
- `1010:1a88(x, y, w, h, X, Y, W, H)`: adds 1 when the first rect lies inside the second (`x >= X`, `x + w < X + W`, `y >= Y`, `y + h < Y + H`) and 1 when they touch (`x + w >= X`, `x < X + W`, `y + h >= Y`, `y < Y + H`). All signed. So 2 inside, 1 touching, 0 apart; a rect ending exactly at `X` or `Y` touches.
- `1010:1a0d(x, y, w, h)`: kind-1 dirty rects B → A age 0, B → A age 1, C → B age 0.

## Island step

- `1010:040e(first)`: nothing in mode 2. Otherwise target B, source C, then `1010:04a2`. With `first`: `1010:0b67`, then surf (`1010:0e74(0)`) and raft (`1010:1d69(0)`). Without `first`: returns when the island is still, else surf and raft.
- `1010:040e`: so a still island has no surf or raft animation and, since its wave records are not in use, no wave draws at all. The story calls `1010:040e(0)` once per step (`1018:06bf`).

## Unreferenced and cleanup

- `1010:0059`: presents the whole screen with B as source, target, and A, then restores the three. No caller and no relocation.
- `1010:00b2`: presents the whole screen with A as source and target. No caller and no relocation.
- `1010:03ce`: frees BACKGRND and MRAFT and clears their pointers. Only `1008:157b` (shutdown) calls it. HOLIDAY is never freed.

## Bitmaps

- `BACKGRND.BMP`: 42 images. 0 island 280 × 52; 1 and 2 low-tide sand 384 × 69 and 64 × 30; 3..5 surf 72 × 29; 6..8 surf 160 × 25; 9..11 surf 72 × 32; 12 palm 152 × 69; 13 trunk 24 × 145; 14 104 × 28; 15..17 clouds 128 × 36, 192 × 57, 264 × 76; 18..21 waves 32 × 6; 22..25 waves 64 × 12; 26..29 waves 104 × 16; 30..41 low-tide surf (120 or 128 × 48, 176 × 28, 88 × 48, 104 × 29). The island code uses indices 0..41, so none runs past the end.
- `MRAFT.BMP`: 7 images: 72 × 39, 88 × 39, three 128 × 39 (raft frames 1..5), then two 8 × 1 the raft code never uses.
- `HOLIDAY.BMP`: 4 images: 40 × 34, 120 × 47, 56 × 65, 152 × 47.

## Emulated

`scripts/re/unicorn/original_island.py` (`dump_island.py` writes `re/fixtures/island/traces.tsv`, gitignored).

- Runs as original code: `1010:0136` and everything it calls in `1010`, `1010:040e`, `1010:1e50`, the clock callback `1008:16c2`, and the random generator (`1018:1e60`, `1018:1eb6`, `1018:1ef5`).
- Recorded and replaced: `1030:124a` (`sheet`, returns a bitmap table with the real widths and heights, one per sheet), `1030:16d8` (`screen`), `1038:1bd8` (`fill`; any rect that is not a solid fill raises), `1038:0ae4` and `1038:0ac2` (`sprite`, the latter with flags 0), `1030:02ef` (`line`), `1038:06ce` (`copy`), `1060:007e` (`dirty`; any kind but 1 raises), `1060:04b2` (`overlaps`). `1020:081c` does nothing. Nothing else needed a handler.
- `1060:04b2` does not model the dirty lists: the `n`-th call of a case (zero-based, counted from the second `1010:0136`) answers 1 when `n % 3 == 1`, else 0, so the port sees the same answers by counting its own calls.
- Each case is a fresh emulator: `1010:0136` once with nothing set (it only loads BACKGRND and MRAFT; its rows are dropped), the case's globals, the clip off over `(0, 0, 639, 479)`, `1018:1eb6(997k)`, `1010:0136` again (rows with step -1, then a `state` row), then for steps 0..59: `1 + step % 4` calls of `1008:16c2`, `1010:040e(0)`, `1010:1e50(0)`, and a `state` row. Surfaces: 0 = A, 1 = B, 2 = C.
- Case `k` (0..23): mode `[0, 0, 0, 1, 2][k % 5]`; place `[0xffff, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0c, 0x30][k % 10]`; low tide `[0xffff, 0, 1][k % 3]`; still when `k % 7 == 3`; no raft when `k % 6 == 5`; holiday hidden when `k % 4 == 2`; holiday `k % 5`; slot 13 for odd `k`, else 0; Background off when `k % 8 == 7`; Clouds off when `k % 9 == 8`; Waves off when `k % 10 == 9`; NumDays `[1, 3, 9][k % 3]`; speed 200 for even `k`, else 0.
- The `state` row: island x `30c4`, y `30c2`, low tide `30c0`, place `30be`, raft frame `30b6`, surf `0282 0284 0286`, wind `0280`, surf timer `0288`, wave timer `028a`, clouds left `2e7a 2e7c 2e7e`, waves left `2f36 2f38 2f3a 2f3c`, random write index `1ce6`, then the 15 cloud records and the 30 wave records as `x,y,frame,kind,period,countdown`.
- `test_original_island.py` pins the harness: the first call only loads the two sheets, the island goes into C and through B, mode 2 fills with color 5 (after loading HOLIDAY when the case has a holiday), the overlap rule, and a `state` row ending every step.
- 47548 rows (plus the header): 22986 `dirty`, 11957 `line`, 7612 `sprite`, 3462 `overlaps`, 1464 `state`, 24 `copy`, 19 `sheet`, 17 `screen`, 7 `fill`.
- Observed: with speed 200 the cases draw 11957 glint lines and 2716 wave sprites (BACKGRND 18..29); with speed 0, none. This is the only way to see them, since the real speed is always 0.
- Observed: clouds (BACKGRND 15..17) are drawn only in step -1 (10 draws over all cases).
- Observed: the surf counters move on 30 of the 60 steps (every other step: 1 to 4 clock ticks per step against the 4-tick timer) in every case with an island that is not still; never in mode 2 or with a still island (cases 3, 4, 9, 10, 14, 17, 19).
- Observed: no sprite index past a sheet's end.

## Side-by-side checklist

| Original | Name | Ours | Status |
| --- | --- | --- | --- |
| `1010:0059` | `story_presentFromB` | none (unreferenced) | match |
| `1010:00b2` | `story_presentFromA` | none (unreferenced) | match |
| `1010:00fc` | `story_setTtmOffset` | `src/island/island.ts` | open |
| `1010:0136` | `story_drawIsland` | `src/island/island.ts` (`islandInit`) | open |
| `1010:03ce` | `story_freeIslandBitmaps` | none (nothing to free in JavaScript) | match |
| `1010:040e` | `story_animateIsland` | `src/island/island.ts` (`islandAnimate`) | open |
| `1010:0463` | `story_resetOceanWaves` | none | open |
| `1010:04a2` | `story_animateOceanWaves` | `src/island/island.ts` (`islandAnimate`) | open |
| `1010:0a38` | `story_initClouds` | none | open |
| `1010:0b67` | `story_animateClouds` | none | open |
| `1010:0e74` | `story_drawSurf` | `src/island/island.ts` (`islandAnimate`) | open |
| `1010:14bf` | `story_randomPlace` | `src/island/island.ts` (`randomIslandState`) | open |
| `1010:1551` | `story_redrawIslandOver` | none | open |
| `1010:1a0d` | `story_markIslandDrawn` | none | open |
| `1010:1a88` | `story_rectOverlap` | none | open |
| `1010:1b00` | `story_placeIsland` | `src/island/island.ts` (`randomIslandState`) | open |
| `1010:1c41` | `story_setIslandFlags` | `src/story/sequence.ts:76` `resetIslandFlags`, `src/story/sequence.ts:80` `applySceneFlags` | fixed |
| `1010:1d69` | `story_drawRaft` | `src/island/island.ts` (`islandInit`) | open |
| `1010:1e50` | `story_drawHoliday` | `src/island/island.ts` (`islandRedrawHoliday`) | open |
