# Open Questions

Behavior we haven't settled against the original, and workarounds kept without a known root cause. When one is resolved, write the finding in `<subsystem>.md`, fix or delete the code, and move the entry to "Resolved" with the address that settled it.

## Workarounds without a known root cause

### OQ-8: Resource lookup is case-sensitive in our code

- **Where:** `src/resource/resource-archive.ts`, `src/ttm/gdi-device.ts` (`find`)
- **What it does:** exact match on the stored name. The original matches the stored name case-insensitively and refuses a path prefix (`1018:1019`, `1018:195a`, `1000:197e`).
- **Old guess behind it:** every name in the data is already uppercase with no path. True for ADS sub-resource names (`src/resource/resource-archive.data.test.ts`); not checked for TTM.
- **Resolve in:** chunk 5 (TTM interpreter), by checking every resource name TTM bytecode loads
- **Resolution:** every resource name TTM bytecode loads (`0xf01f`, `0xf02f`, `0xf05f`) exists in the archive when compared in upper case (`src/ttm/gdi-device.data.test.ts`, `finds every resource a TTM script loads`), except `FLAME.BMP` and `FLURRY.BMP` in `FIRE.TTM`, which the archive does not have at all and no ADS script loads; there the original and ours both get no bitmaps. No name has a path or lacks an extension. `GdiDevice` looks names up in upper case, as the original compares them case-insensitively.
- **Status:** resolved (chunk 5)

### OQ-9: Screen pixels with index 0 are see-through in our code

- **Where:** `src/gfx/gdi/display.ts` (`blitScreen`), `src/gfx/present.ts` (`presentSurface`); `src/decode/nibbles.ts:10` still maps index 0 to `TRANSPARENT`, which `rawIndices` (`src/gfx/gdi/surface.ts`) turns back into 0
- **What it does:** a screen pixel with index 0 shows black, or whatever a lower layer holds.
- **Original:** `gfx_blitPixelRows` (`1040:0286`) copies screens with `BitBlt` `SRCCOPY`, and `gfx_buildBitmaps` (`1040:0000`) keeps the palette's color 0 in the color table when `1068:2572` is 0, so index 0 is drawn opaque in palette color 0 (`JOHNCAST.PAL` color 0 is 168, 0, 168). Only bitmaps force color 0 to black and use the mask from `1040:035c`. Index 0 appears in `INTRO.SCR` (1,894 pixels), `ISLETEMP.SCR` (18), `OCEAN00.SCR` (9,917), `OCEAN01.SCR` (9,254), and `OCEAN02.SCR` (10,013).
- **Old guess behind it:** index 0 is a transparent sentinel never used as a visible color.
- **Model:** `src/gfx/gdi/display.ts` (`blitScreen`) draws screens opaque with index 0 kept, as `1040:0286` does. The old layer pipeline still shows index 0 as black or as a lower layer.
- **Resolve in:** chunk 5 (TTM interpreter), when the model is wired in; then check in the browser whether palette color 0 shows on the ocean screens (the island may cover those pixels).
- **Resolution:** the engine draws every screen through Display.blitScreen (TTM screens, the ocean, INTRO.SCR), opaque with index 0 kept, and src/gfx/present.ts shows index 0 as palette color 0. Browser check (2026-10-18): the user saw nothing wrong on the ocean, intro, or scenes; no magenta reported.
- **Status:** resolved (chunk 5)

### OQ-10: TTM interpreter frames bytecode and finds tags on its own

- **Where:** `src/ttm/page-runner.ts` (`runTtmPage`, `pageOfTag`), `src/ads/scheduler.ts:174` (`tagPageOf`)
- **What it does:** re-reads instructions with its own framer (signed args, no `0xAF1F`/`0xAF2F` case, no arg code check) and finds a tag by scanning the bytecode for `0x1111 <id>` each time, starting right after it.
- **Old guess behind it:** a tag is a jump label inside the bytecode.
- **Original:** the loader indexes the bytecode once (`1050:04d6`): pages split after each `0x0FF0`, and each `0x1111` is recorded with the page it sits on (`1050:042a`). `decodeTtm` now returns `pageOffsets` and `tags` built the same way, and `readTtmInstruction` (`src/decode/ttm-bytecode.ts`) frames exactly like the original.
- **Resolve in:** chunk 5 (TTM interpreter): find how the original interpreter uses the page table and tag records, then switch `src/ttm/` and `findTtmTag` to `readTtmInstruction`, `pageOffsets`, and `tags`.
- **Resolution:** src/ttm/page-runner.ts reads instructions with readTtmInstruction, runs pages from pageOffsets, and finds goto and page-call targets with pageOfTag (1058:13a9); the scheduler takes a scene's first page from ttm.tags (1050:042a). The old framer and findTtmTag are deleted.
- **Status:** resolved (chunk 5)

### OQ-15: Line and ellipse pixels are our choice, not GDI's

- **Where:** `src/gfx/gdi/primitives.ts` (`lineTo`, `drawCircle`)
- **What it does:** lines use a midpoint Bresenham that leaves out the end point; circles fill every pixel whose center lies within the radius of the rect center, with a 1-pixel border.
- **Original:** `1030:02ef` and `1038:1bd8` call `MoveTo`/`LineTo`, `1040:0688` calls `Ellipse(cx - r, cy - r, cx + r, cy + r)`. Which pixels GDI picks is Windows behavior, not in `SCRANTIC.SCR`.
- **Resolve in:** only with a reference capture from Windows 3.1; until then the end points, rect edges, and symmetry are pinned and the inner pixels are not
- **Status:** open

### OQ-17: The original presents only dirty rects, the model presents whole frames

- **Where:** `1038:07e8` and its callers: `1030:02ef` (width `-a - b` when the line goes left or up), `1040:0688` (right and bottom passed as width and height)
- **What it does:** the original copies only the dirty rect of each drawing call to the window, so a wrong rect leaves part of a line on screen later than the rest, or presents too much.
- **Ours:** the browser shows the whole surface every frame.
- **Resolve in:** chunk 5, when the model is wired in: decide whether any visible difference is worth modeling
- **Resolution:** `Display.window` is painted only by presents, rect by rect, from the same source the original uses (`src/gfx/gdi/display.ts`, `present`). Drawing the window whole each frame shows the same picture, so nothing visible is left to model. A wrong dirty rect now shows on screen exactly as it would in the original.
- **Status:** resolved (chunk 5)

### OQ-18: Where GDI puts a mirrored or flipped sprite

- **Where:** `src/gfx/gdi/sprite.ts` (`drawSprite` with flags 1 or 2, `drawSpriteStretched`)
- **What it does:** draws the mirrored or flipped image into exactly the same rect as the plain one.
- **Original:** `1038:0ae4` mirrors through a pre-mirrored copy (`JOHNWALK.BMP` and the TTM bitmaps loaded right after opcode `0x2012`, built by `1040:054e`, which lands exactly in place) or through a negative `StretchBlt` destination extent (`x + w` with width `-w`). Whether Windows 3.1 maps a negative extent to the same pixels or one pixel off is GDI behavior, not in the binary.
- **Resolve in:** only with a reference capture from Windows 3.1
- **Status:** open

### OQ-20: The graphics model is not wired in

- **Where:** `src/gfx/gdi/`, `src/gfx/present.ts`, `src/ttm/page-runner.ts`, `src/ttm/gdi-device.ts`, `src/ads/scheduler.ts`, `src/island/island.ts`, `src/walk/walk.ts`, `src/story/story.ts`, `src/main.ts`
- **What it does:** the running engine draws each TTM thread into its own transparent layer, keeps "saved zones" in one more layer, and composites everything every frame. The original draws into three surfaces and erases with dirty-rect restores (`docs/re/graphics.md`, `Dirty rects`, `Display buffers`).
- **Old guess behind it:** jc_reborn's SDL layer design.
- **Resolve in:** chunk 5 (TTM interpreter): find which surface each opcode draws on and when the restore pass runs, switch the interpreter, island, and walk drawing to `src/gfx/gdi/`, then delete the old pipeline and its workarounds (`lingeringLayers`, `clearSavedZones`, the zone layer)
- **Resolution:** the scheduler, island, walk, story, and main loop draw through src/gfx/gdi/ (buffers B and C, dirty rects, restore pass, window). The layer pipeline (src/gfx/layer.ts, primitives.ts, sprite.ts, clip.ts, zone.ts, compositor.ts, src/ttm/interpreter.ts, thread.ts, bmp-slots.ts) and its workarounds (lingeringLayers, clearSavedZones, the zone layer) are deleted. The connections that are not checked yet are OQ-22, OQ-24, OQ-25, OQ-26, and OQ-28.
- **Status:** resolved (chunk 5)

## Past fixes to re-check against the original

Each fix below was made without the decompile. Treat it as a guess until a chunk confirms or replaces it. "Out of scope" rows touch docs, build paths, or sound playback, which have no counterpart in the original.

| Commit | Summary | Chunk |
| --- | --- | --- |
| `85c05ad` | copyZoneToBg skips transparent pixels (colorkey) | 4 (reviewed, see docs/re/graphics.md) |
| `d670686` | SET_DELAY missing timer | 5 (reviewed, see docs/re/ttm.md) |
| `5f4e3a0` | DRAW_RECT/DRAW_CIRCLE no longer add ctx.dx/dy to args 3&4 (width/height) | 5 (reviewed, see docs/re/ttm.md) |
| `0e7cd64` | getUint16/getInt16 mistake | 3 |
| `eb46290` | force-stop orphan TTM threads after ADS END | 6 (reviewed, see docs/re/ads.md) |
| `6b0be68` | audio playback | out of scope |
| `b631319` | animation sprites sometimes get cut | 4 (reviewed, see docs/re/graphics.md) |
| `8adc66a` | various consistency fixes | 6 (reviewed, see docs/re/ads.md), 7 (reviewed, see docs/re/story.md) |
| `1204c0d` | hain instant phase transitions so a scene-end → walk-start (or walk-end → new-scene-start) completes in one tick. | 7 (reviewed, see docs/re/story.md) |
| `c037b5f` | swapped order: storyTick → adsTick → storyAnimateBg | 7 (reviewed, see docs/re/story.md) |
| `72fb9d7` | load data relative | out of scope |
| `f47def5` | replace elapsedTicks with mini-based pacing; eliminate second pass in adsTick | 6 (reviewed, see docs/re/ads.md) |
| `7fef3c3` | replace elapsedTicks with mini-based pacing; eliminate second pass in adsTick | 6 (reviewed, see docs/re/ads.md) |
| `194d7fb` | add thread leak detection sweeps (pre-tick, begin-scene, start-walk, post-walk) | 6 (reviewed, see docs/re/ads.md), 7 (reviewed, see docs/re/story.md) |
| `613b3c2` | add watchdog timeout (8000 ticks) to force-end self-sustaining scene cycles | 7 (reviewed, see docs/re/story.md) |
| `9a40bb2` | LOAD_SCREEN resets dx/dy to zero, sprites render in screen-relative coords after background switch | 5 (reviewed, see docs/re/ttm.md) |
| `0d4078d` | DRAW_BACKGROUND opcode is a no-op, jc_reborn only frees image slots not the framebuffer | 5 (reviewed, see docs/re/ttm.md) |
| `7a9d964` | TIMER opcode sets delay and timer directly, continues loop; remove timerYield workaround | 5 (reviewed, see docs/re/ttm.md) |
| `e1d3bae` | GOTO_TAG defers jump via nextGotoOffset, continues interpret loop instead of returning early | 5 (reviewed, see docs/re/ttm.md) |
| `cacfdb0` | PURGE opcode schedules nextGotoOffset instead of immediate jump, continues interpret loop | 5 (reviewed, see docs/re/ttm.md) |
| `a933bf7` | revert UNKNOWN_6 back to no-op | 6 (reviewed, see docs/re/ads.md) |
| `31988b3` | revert DRAW_SCREEN implementation for now, to avoid duplication issues | 5 (reviewed, see docs/re/ttm.md) |
| `2ed4424` | GOTO_TAG must yield after jumping, otherwise loops without an UPDATE create infinite tight loops in ttmPlay | 5 (reviewed, see docs/re/ttm.md) |
| `a9610d3` | clear saved zones when all threads from a slot stop, preventing clock block from MEANWHIL.TTM persisting through SUZY.ADS scene | 6 (reviewed, see docs/re/ads.md) |
| `966476f` | UNKNOWN_6 opcode now checks if scene is running before adding, preventing redundant scene starts in EAT scenes | 6 (reviewed, see docs/re/ads.md) |
| `c7f3c6b` | implement DRAW_SCREEN opcode for scaled sprite rendering used in sandcastle and plane scenes | 5 (reviewed, see docs/re/ttm.md) |
| `d39b9ac` | clear saved zones between scenes to prevent visual artifacts leaking across transitions | 7 (reviewed, see docs/re/story.md) |
| `037819f` | GOTO_TAG searched LOCAL_TAG instead of TAG, causing loops to fall through into wrong animation frames | 5 (reviewed, see docs/re/ttm.md) |
| `27684eb` | problem with threads rendering on top of each other | 6 (reviewed, see docs/re/ads.md) |
| `c126833` | problem where nothing would start after certain scenes | 6 (reviewed, see docs/re/ads.md) |
| `d808ee0` | correct file | out of scope |
| `43ef25b` | better color and transparency handling | 3, 4 (4 reviewed, see docs/re/graphics.md) |
| `e6287e1` | correct original repo | out of scope |
| `db6d598` | flickering animation sprites | 6 (reviewed, see docs/re/ads.md) |
| `d0bc6b6` | transparency | 3 |

## Not reviewed on purpose

### OQ-7: Compression (write) side of the stream code

- **Where:** `1028:0072`, `1028:0384`, `1028:0a4b`, `1028:11be`, `1028:1233`, `1028:13cf`, `1028:155d`, `1028:157c`, `1028:1654`, `1028:1698`, and the write-mode branches of `1028:0615`, `1028:0875`, `1028:0547`
- **What it does:** the stored, RLE, and LZW encoders and the write-mode stream paths.
- **Why not reviewed:** the engine only reads `RESOURCE.001`; nothing in the original's runtime writes compressed data that we need to reproduce. All four callers of `1028:0615` pass a mode string `"r"`, and `1028:0a4b` (the only way to feed an encoder) has no callers.
- **Status:** open, by choice

### OQ-16: Text drawing is not modeled

- **Where:** `1030:04ee`, `1030:04ce`, `1030:0765`
- **What it does:** `TextOut` with the `WILLY.FON` font, text and back colors from `1068:1ea0`/`1ea1`, back mode from `1068:1ea2`.
- **Ours:** nothing draws text.
- **Chunk 5:** only TTM opcodes 0xa204..0xa294 draw text, through 1030:04ce; no TTM script uses them or the font opcodes (docs/re/ttm.md, Text and fonts). The engine does not draw text.
- **Status:** open, by choice

### OQ-21: Wipe speed

- **Where:** `src/gfx/fade.ts` (`WIPE_TICKS`), `src/story/story.ts` (one `step++` per story tick)
- **What it does:** spreads every wipe over 16 story ticks, showing a proportional share of its shapes each tick.
- **Original:** `1020:0512`..`1020:071c` draw every shape in one go, pumping window messages between shapes (`1008:13cd`), with no timer: the speed is whatever the machine manages. The story waits for the call to return.
- **Old guess behind it:** a visible wipe needs a fixed duration in a browser frame loop.
- **Resolve in:** chunk 7 (story and main loop): decide a duration from the original's timing model, if any, when the story's call to `1020:0364` (`1018:0673`) is read
- **Resolution:** kept by choice (user, 2026-10-18): a wipe takes `WIPE_TICKS = 16` story steps, 0.8 s at the original's 50 ms step; the story does nothing else meanwhile, as `1020:0364` blocks `1018:0540`.
- **Status:** resolved (chunk 7), by choice

### OQ-23: Page-runner guards where the original misbehaves

- **Where:** `src/ttm/page-runner.ts`
- **What it does:** a page call (`0x3003`) or goto for a tag no page starts with does nothing; a sprite index past the end of its list draws nothing and marks no rect; `0x2022` with equal bounds gives the low bound (`int16` turns the `NaN` remainder into 0); a page without `0x0FF0` throws when the bytecode ends (`readTtmInstruction` reads past it).
- **Original:** `1058:0f7f` runs `1058:040c(0xFFFF)` and reads a page pointer from past the table; `1058:025b` reads whatever word follows the bitmap list; `1058:0e08` faults on `DIV` by 0; `1058:040c` reads past the bytecode.
- **Data:** no script uses `0x3003`; every goto tag exists (150 trace runs have a goto: the 75 uses of `0x1201`, each on a first run and a replay); no `0x2022` has equal bounds; every page ends with `0x0FF0` (`src/decode/ttm-loader.data.test.ts`). Sprite indices do go past their lists: with pages run in file order, 17 draws (GJNAT1, GJVIS3, SMDATE, SJLEAVES; `docs/re/ttm.md`, `Emulated`). The harness pads the lists with zeros, so the trace comparison checks our guard against the original drawing a null image. Whether the game reaches those pages with those slot contents depends on the ADS order (chunk 6).
- **Why not reviewed:** the original's behavior in every case is a read of unrelated memory or a fault, which no port can match.
- **Status:** open, by choice

### OQ-27: TTM opcodes the data never uses

- **Where:** `src/ttm/page-runner.ts` (no case for them)
- **What it does:** our runner treats these as doing nothing (apart from the default dirty rect for `0xAxxx` opcodes): the effects `0xa014`, `0xa024`, `0xa034`, `0xa044`, `0xa074`, `0xa084`, `0xa094`, `0xa0b5` (`1058:1510`); the palette effects `0x0400`, `0x2302`..`0x2322`, `0x2402`, `0x4136` (they need `1068:1ebf`, never set), and `0x4114`, `0x4124` (copy B to the screen and select the pending palette); text and fonts (OQ-16); the BMP matrix `0x00e0`, `0x2032`, `0xa704`, `0xf08f` (no resource has `BMP:MTX:`); `0xb000`, `0xb013` (`1050:0000`, `1050:0061`); `0x0010`, `0x1011`, `0x1041`, `0x1031`, `0xaf02`, `0xaf1f`, `0xaf2f`, `0xa5a7`, the `0xCxxx` opcodes other than `0xc051`.
- **Original:** `docs/re/ttm.md`, `Opcodes`, `Zones and effects`, `Palettes`, `Stubs and dead branches`.
- **Why not reviewed:** no TTM script uses any of them (`docs/re/decoders.md`, TTM opcode coverage), so nothing can check a port against the original's output.
- **Status:** open, by choice

### OQ-31: ADS interpreter guards where the original reads through a null pointer

- **Where:** `src/ads/script.ts` (`ifBlock`, `whileBlock`, `randomBlock`, `skipBlock`)
- **What it does:** when a condition chain, a block, or a random block runs off the end of the bytecode, ours stops the pass (returns `null`). After a false while block whose `0x1520` is missing, ours also stops.
- **Original:** `1048:1758` and `1048:11db` pass a null pointer on to `1048:1925`, which reads the word at it; `1048:17a0` adds 2 to a null result of `1048:118a` and goes on at offset 2 of segment 0; `1048:0cda` reads the word at a null pick.
- **Data:** every if and while block in the 10 ADS scripts is closed and every random block ends with `0x30FF` (the corpus trace of step 2 runs every section without reaching these paths).
- **Why not reviewed:** the original reads unrelated memory there; no port can match it.
- **Status:** open, by choice

### OQ-34: Story guards where the original reads through a null entry

- **Where:** `src/story/sequence.ts` (`buildQueue`, `newSequence`)
- **What it does:** when the opening pick finds no entry, ours returns an empty queue (the next story step builds a new sequence); when the queue is empty, Johnny keeps his spot and heading.
- **Original:** `1018:089b` queues the null pointer at the head and reads its length and flags from data-segment offsets 7, 0x0b, 0x0d; `1018:0540` reads Johnny's spot and heading from offsets 3 and 4. The null head makes `1018:06bf` start a new sequence on the next step, as ours does.
- **Data:** no slot lacks an opening candidate (at least 44 per slot, many with no place bits, and the budget left is at least 135; `docs/re/story.md`, `Sequence building`), and none of the 480 traced builds hit it (`docs/re/story.md`, `Emulated`).
- **Why not reviewed:** the original reads unrelated memory there; no port can match it.
- **Status:** open, by choice

### OQ-35: Windows plumbing, dialogs, password, and sound loading are not modeled

- **Where:** `1008:0000`, `1008:0221`, `1008:033e`, `1008:034f`, `1008:0517`, `1008:0a2d`, `1008:12eb`, `1008:13cd`, `1020:0000`, `1020:0085`, `1020:0106`, `1020:013f`, `1020:019c`, `1020:026e`, `1020:081c`, `1020:082a`
- **What it does:** command-line handling, the settings and password dialogs, exit on mouse or key input, message pumping during wipes, debug logging (empty in this build), and loading the WAVESFX samples through MMSYSTEM.
- **Why not reviewed:** none of them changes what the screen saver draws or when; the browser has its own page, controls, and sound playback (`docs/re/story.md`, `Exit and dialogs`).
- **Status:** open, by choice

### OQ-32: The intro is held 2 s before the first story step

- **Where:** `src/main.ts` (`INTRO_HOLD_MS`)
- **What it does:** shows `INTRO.SCR` for 2 s before the first step, which starts the first wipe.
- **Original:** `1008:143c` draws `INTRO.SCR` and the first `WM_TIMER`, 50 ms later, runs `1018:0540`, which wipes at once. On a 1991 PC the loading around it kept the intro on screen for a while.
- **Why not reviewed:** user's choice (2026-10-18): in a browser the original timing makes the intro a flash.
- **Status:** open, by choice

### OQ-33: Settings are saved after each new sequence

- **Where:** `src/story/story.ts` (`startSequence`), `src/story/settings.ts`
- **What it does:** writes the `SCRANTIC.INI` values to local storage every time a sequence starts.
- **Original:** `1008:0dc8` writes them once, on `WM_DESTROY`.
- **Why not reviewed:** a browser tab can close without warning; the values only change in `1018:0b87`, which runs at the start of a sequence, so saving there loses nothing.
- **Status:** open, by choice

### OQ-36: The clock ticks evenly every 16 ms

- **Where:** `src/engine/clock.ts`
- **What it does:** one clock tick per 16 ms of real time, one story step per 50 ms.
- **Original:** `1040:089a` compares slot times with `GetCurrentTime`, which on Windows 3.x moves in 55 ms jumps, so the 16 ms callback fired three or four times in a burst; `WM_TIMER` came at the same 55 ms granularity. The average rates match ours.
- **Where it shows:** the walk delay (`1068:30d4`) is set to 4 after every walk call, so Johnny only moves on a step that saw 4 ticks: one step in 8 with even ticks (about every 400 ms), about 7 in 16 with 55 ms bursts (about every 125 ms) (`docs/re/walk.md`, `Timing`).
- **Why not reviewed:** the bursts depend on the PC's timer chip, not on `SCRANTIC.SCR`.
- **Browser check (2026-10-19):** Johnny walks visibly slower than the scenes animate. The user chose to model the Windows 3.x tick bursts in `src/engine/clock.ts` after chunk 8, so the walk runs at about its original speed with `1018:0094` unchanged.
- **Status:** open, to do after chunk 8 (user, 2026-10-19)

### OQ-37: Walk guards where the original reads through a bad pointer

- **Where:** `src/walk/walk.ts` (`pickSegment`, `loseRoute`, `drawFrame`, `showTurn`)
- **What it does:** a percent pick that runs past its group's last choice, or lands on the (0, 0) choice, picks no segment: the walk drops the route and segment (`Walk.lostRoutes` counts it) and routes again from Johnny's spot on its next frame. It draws nothing when there is no frame, no JOHNWALK sheet, or the sprite index is past the sheet's end, and a turn at a spot with no turn set leaves no frame.
- **Original:** `1018:0094` reads on into the next group's words (markers as segments, segment ids as percents), and from there on reads segments, spots, and frames out of the wrong place: Johnny jumps, lands on a spot like 46, or stops being drawn (`docs/re/walk.md`, `Route choice`). This happens with the shipped data: a route left over from an older target (an idle entry that ends before Johnny is back on the last ADS entry's start, or a target of spot 0 that `1018:0b46` does not store) reaches its own end spot, whose group is (0, 0). 6 of the 36 traced cases get there; `re/fixtures/walk/traces.tsv` ends them with a `bad` row, and `src/walk/walk.data.test.ts` checks the port drops the route at that same beat. The other guards never fire: `1018:0094` never runs with Johnny at spot 0 unless a bad pick put him there, every frame's sprite exists (`src/walk/walk-tables.data.test.ts`), and `1008:143c` stops when JOHNWALK.BMP does not load.
- **Status:** open, by choice (user, 2026-10-19)

## Resolved

### OQ-1: Story watchdog force-ends scenes after 8000 ticks

- **Where:** `src/story/story.ts` (`case 'playing'`)
- **What it does:** ends the current scene through `endScene` once `playingTicks > 8000`, without touching ADS state. It counts engine ticks (20 ms each, OQ-29).
- **Old guess behind it:** some scenes cycle forever without reaching an end.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** `1018:06bf` has no time limit; an entry ends when `1048:0766` says its section is idle, or when an idle entry's wait (`1068:334c`) runs out. The watchdog is deleted. `src/story/story.data.test.ts` plays every scene table entry of every ADS file to its end with the ported random generator: all 65 ADS entries end, from 42 to 2490 story steps (2.1 s to 2 min 4 s at 50 ms, walk to the start spot included; median 500); `ACTIVITY.ADS` tag 6 ends after 313 steps, the longest is `STAND.ADS` tag 5.
- **Status:** resolved (chunk 7)

### OQ-2: ADS pre-tick sweep frees threads with a nil TTM slot

- **Where:** `src/ads/scheduler.ts:356-361`
- **What it does:** before each ADS tick, frees threads whose TTM slot is nil or unloaded.
- **Old guess behind it:** threads leak after walks and block the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Resolution:** nodes exist only for the tags of TTMs that loaded (`1050:042a`; `1048:0079` fails the whole ADS when one TTM is missing), and an instruction naming an unknown node does nothing (`1048:0bf4` returns 0). The sweep went with `src/ads/scheduler.ts`.
- **Status:** resolved (chunk 6)

### OQ-3: Orphan threads force-stopped 100 ticks after ADS END

- **Where:** `src/ads/scheduler.ts:43-47`, `src/ads/scheduler.ts:413-425`
- **What it does:** after END, waits `STOP_REQUEST_GRACE_TICKS = 100` ticks for threads to finish, then force-stops the rest.
- **Old guess behind it:** GOTO-loop threads never see the stop request and wedge the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Resolution:** the root cause is the busy check: `1048:0766` does not count a node whose page jumped to itself (self-goto flag, node `[6]`), so a scene with endless goto loops ends anyway. `0xFFFF` ends a section's script; it is not a stop request. The grace period went with `src/ads/scheduler.ts`. `src/ads/tick.ts` `adsSectionBusy`, pinned in `src/ads/tick.test.ts`.
- **Status:** resolved (chunk 6)

### OQ-4: Straggler threads freed before a walk starts

- **Where:** `src/story/story.ts:271-276`
- **What it does:** when the story moves to a walk, stops every thread still running.
- **Old guess behind it:** threads from the finished scene leak into the walk.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** `1018:06bf` never runs the ADS tick for a walk entry, so no scene can run during a walk. The engine now ticks the ADS only while a scene plays (`storyPlayScene`), and each scene gets its own ADS state (OQ-30). The sweeps are deleted.
- **Status:** resolved (chunk 6)

### OQ-5: Residual threads freed after a walk ends

- **Where:** `src/story/story.ts:301-306`
- **What it does:** when the walk is done, stops every thread still running before the next scene starts.
- **Old guess behind it:** threads survive the walk and block the next scene.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** `1018:06bf` never runs the ADS tick for a walk entry, so no scene can run during a walk. The engine now ticks the ADS only while a scene plays (`storyPlayScene`), and each scene gets its own ADS state (OQ-30). The sweeps are deleted.
- **Status:** resolved (chunk 6)

### OQ-6: Scene picker drops wanted flags when nothing matches

- **Where:** `src/story/story.ts:177-181` (`pickSceneFrom`)
- **What it does:** if no scene has all wanted flags, picks a random scene that only avoids the unwanted flags.
- **Old guess behind it:** some flag and day combinations have no candidate, and an empty pick would crash.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** the original has no fallback. `1018:0d50` returns no entry when nothing matches; `1018:089b` re-picks the closing scene until one is found (every slot has candidates, `docs/re/story.md`, `Sequence building`) and stops the middle when a middle pick finds nothing. `src/story/sequence.ts` follows it; the old picker is deleted in step 7.
- **Status:** resolved (chunk 7)

### OQ-11: ADS scheduler frames bytecode with its own size table

- **Where:** `src/ads/opcodes.ts` (`ADS_ARG_COUNTS`), `src/ads/scheduler.ts` (`scanBytecode`, `findAdsTag`, `adsPlayChunk`, and every place that steps over args)
- **What it does:** steps over ADS instructions with a hand-made table that disagrees with the original's (`1048:0383`, read by `1048:0303`): `0xF010` takes 0 args in ours and 1 in the original (in the data it is always followed by `0xFFFF`, which the original reads as its arg, not as a section end); `0x1520` takes 5 in ours and 0 in the original (not in its table; the one use, in `ACTIVITY.ADS`, is followed by a normal `0x2005` that ours eats as its args); the 24 table opcodes ours does not list (`0xf000`, `0xf210`, `0x1010`..`0x1060`, `0x1080`, `0x1310`, `0x1320`, `0x1340`, `0x1380`..`0x13c1`, `0x2000`, `0x2015`, `0x2020`, `0x4010`) are taken for section tag words with no args. It also finds sections and tags with its own scan (any word not in its table is a tag) instead of the section index.
- **Old guess behind it:** arg counts worked out by hand from the data and from jc_reborn.
- **Original:** `adsArgCount` and `indexAdsSections` (`src/decode/ads-bytecode.ts`) follow `1048:0303` and `1048:04fc`, checked on all 65,536 opcode words and every ADS file. `decodeAds(...).sections` holds the section index: every section starts after its tag word, and only sections closed by a `0xFFFF` count. The `ADS opcode coverage` table in `docs/re/decoders.md` lists every opcode where ours and the original differ.
- **Resolve in:** chunk 6 (ADS scheduler): read how the original interpreter steps over `0xF010` and the other differing opcodes, switch the scheduler to `adsArgCount` and `sections`, then delete `ADS_ARG_COUNTS`.
- **Resolution:** the scheduler and `ADS_ARG_COUNTS` are deleted; the port frames instructions with `adsArgCount` (`src/ads/state.ts`, `nextInstruction`, `1048:0303`) and runs sections from `decodeAds(...).sections`.
- **Status:** resolved (chunk 6)

### OQ-12: Per-section scene lists are not built at load time

- **Where:** `src/ads/scheduler.ts` (`scanBytecode`, `chunks`)
- **What it does:** builds its list of scenes per tag while scanning at scene start.
- **Old guess behind it:** jc_reborn's bookmarking scan.
- **Original:** `1048:040f` builds, per section, the distinct tag nodes named by `0x2000`/`0x2005` instructions through `1048:0bf4`, stored at record words `[0x1e9 + i]`. This happens the first time `1048:04fc` selects the slot, not inside `1048:0079`.
- **Resolve in:** chunk 6 (ADS scheduler), together with `1048:0bf4`.
- **Resolution:** `makeAdsState` builds each section's scene list (`sectionScenes`) as `1048:040f` does; the original builds them on the first `1048:04fc(slot)`, which the story calls right after the load, so the result is the same.
- **Status:** resolved (chunk 6)

### OQ-13: A missing TTM does not fail the ADS load

- **Where:** `src/ads/scheduler.ts` (`makeAdsState`, the `ADS sub-resource not found` warning)
- **What it does:** warns and leaves the slot empty when an `ADS:RES:` name is not in the archive.
- **Old guess behind it:** a missing resource should not stop the show.
- **Original:** `1048:0079` loads every listed TTM at once and fails the whole ADS (unloading every ADS slot and every TTM through `1048:001b`) if one fails. The data never triggers it: every listed name exists (`src/resource/resource-archive.data.test.ts`).
- **Resolve in:** chunk 6 (ADS scheduler)
- **Resolution:** `makeAdsState` throws when a listed TTM is missing, as `1048:0079` fails the load. The data never triggers it.
- **Status:** resolved (chunk 6)

### OQ-14: `1028` stub group that does not reach a decoder

- **Where:** the stub group `1028:17c8`, `1028:185e`..`1028:1b0d` (the forwarders `1028:17d8`, `1028:182c`, `1028:1845` were settled in chunk 4)
- **What it does:** of the stubs, 42 return 0, `1028:196e` returns nothing, and `1028:1afc` and `1028:1b0d` return 1. Only direct `CALLF`s reference them: 20 of the return-0 stubs are called from `1058` code around the TTM interpreter (`1058:0054`..`1058:00e5`, `1058:021d`, `1058:02ec`, `1058:0a93`, `1058:0aa4`, `1058:1725`); the other 25 stubs have no reference. See `Thunks` in `docs/re/decoders.md`.
- **Why not reviewed:** none of them reaches a decoder; their targets belong to graphics or to the TTM opcode handlers that call the stubs.
- **Chunk 4:** the three forwarders are settled and verified. `1028:182c` returns the record count of a bitmap list through `1030:15fb`; `1028:1845` frees a loaded bitmap through `1030:00fe` (both in `Bitmap masks and mirrors`, `docs/re/graphics.md`); `1028:17d8` draws a sprite through `1038:0ae4` (`Sprites`). Only the stub group is left.

Settled by chunk 5: every stub that 1058 code reaches returns 0 and is reached only from opcodes no TTM script uses (docs/re/ttm.md, Stubs and dead branches). The 25 stubs without a reference stay unreferenced.

### OQ-19: Stretched sprites: negative source extents and shrink rule

- **Where:** `src/gfx/gdi/sprite.ts` (`drawSpriteStretched`)
- **What it does:** nearest pixel, mirrored or flipped inside the image.
- **Original:** `1030:03d7` negates the source width or height with the source origin left at 0, which points outside the bitmap, and shrinking uses the DC's stretch mode (default `BLACKONWHITE`). Both are GDI behavior.
- **Found in chunk 4:** only the TTM case `1058:025b` reaches `1030:03d7`, for opcodes `0xa506`, `0xa516`, `0xa526`, `0xa536`; the TTM scripts use none of them (`docs/re/decoders.md`, TTM opcode coverage).

Settled by chunk 5: 1030:03d7 is reached only from 1058:025b for opcodes 0xa506, 0xa516, 0xa526, 0xa536, which no TTM script uses (docs/re/ttm.md, Opcodes). The pixel rule stays GDI behavior, irrelevant to the data.

### OQ-22: Thread start and pacing in the scheduler adapter

- **Where:** `src/ads/scheduler.ts` (`adsAddScene` line 155, `restartThread` line 178, `adsTick` line 355, `runThread` line 430, `replayEndingPage` line 450, `advancePage` line 455)
- **What it does:** a new or restarted thread is reset as `1048:0b3e` does (delay 0, first page = the tag's page from `ttm.tags`) and runs at once. Each tick runs the current page of every running thread (first run, then replays), counts timers down by `mini` (the smallest timer, at least 1 tick), and moves a due thread to its next page with replay off. A purge sends the thread back to its tag page and ends it unless the scene has a time limit; scene time limits count down by `mini` every tick. An ending thread (`isRunning = 2`) keeps replaying its page until its timer is due, as `1048:1acb` keeps replaying a purged node until `1048:196e` finds it due. Browser check (2026-10-18): before that replay, Johnny vanished for the whole delay of a purged page (up to 240 ticks) before the next scene; pinned in `src/ads/scheduler.data.test.ts`.
- **Original:** `1048:1acb` and `1048:196e` compare due times against a clock instead of counting down; on the due tick the page is replayed once more before the page advances; what a purge does next depends on the node's mode (`+0x2f`); how `1048` picks a scene's first page is not checked.
- **Old guess behind it:** the old scheduler forced delays of at least 4 ticks and averaged `0x2022`. The 1-tick floor replaces that so pages with delay 0 (93 uses) cannot stall the loop.
- **Resolve in:** chunk 6 (ADS interpreter)
- **Resolution:** nodes advance on due times against a clock (`1048:196e`), scenes start through the section scripts, and every section of every ADS matches the original trace (`src/ads/tick.data.test.ts`). The clock itself is OQ-29.
- **Status:** resolved (chunk 6)

### OQ-24: Island drawing bridge

- **Where:** `src/island/island.ts`, `src/story/story.ts` (`buildSequence` line 120, `storyInit` line 220, `storyRedrawHoliday` line 339)
- **What it does:** draws the ocean, raft, clouds, island, first waves, and holiday sprite into C when a sequence starts, then copies C to B and marks the whole screen `(B → A, age 0)`. Every 8 ticks a wave is drawn on B with rects `(B → A, 0)` and `(B → C, 0)`. The holiday sprite is redrawn on B when its rect overlaps a `(B → A, age 0)` rect. Scenes off the island start from a C cleared to index 0; `INTRO.SCR` is drawn into C. Seen in a headless run: `startScene` gives a scene without `LEFT_ISLAND` the island offset of a left island (`islandX = -272`), so `ACTIVITY.ADS` tag 4 (`MJDIVE.TTM`) dives off the left edge of the screen; the old pipeline computed the same offset.
- **Original:** `1010:040e` (waves and island bits), `1010:1e50` (holiday), and the island setup; which surfaces and rects they use is not checked.
- **Resolve in:** chunk 7 (story and island)
- **Resolution:** `src/island/island.ts` ports `1010:0136`, `1010:040e`, `1010:1e50` and their helpers through `IslandDevice` (`src/island/island-device.ts`); every case of the island trace matches the original (`src/island/island.data.test.ts`, `docs/re/island.md`, `Emulated`). The left-island offset comes from `1010:1b00` (place bit 1: island at `(0x11, 0x135)`, so offset `(-272, 30)`) and the TTM offset from `1010:00fc` (`+1`, or `+0x111` for scenes with flag `0x400`). Wired into the story in step 7.
- **Status:** resolved (chunk 7)

### OQ-26: Random numbers come from Math.random

- **Where:** `src/main.ts` (`random`, shared by `GdiDevice` and `makeAdsState`), `src/island/island.ts`, `src/story/story.ts`
- **What it does:** draws 16-bit values (and fractions) from `Math.random`. ADS random picks (`1048:0cda`) and the device share one source, `game.random`.
- **Original:** `1018:1e60` with its own seed; the sequence decides delays of `0x2022`, ADS random picks, and island choices.
- **Resolve in:** chunk 7 (story and island)
- **Resolution:** one `StoryRandom` (`1018:1e60`, `src/story/random.ts`) seeded by dropping `time() & 0xffff` numbers (`1018:1ed4`, `src/main.ts`) serves the story, the island, ADS random blocks (`makeAdsState`), and TTM `0x2022` (`GdiDevice`); pinned against the original in `src/story/random.data.test.ts`.
- **Status:** resolved (chunk 7)

### OQ-28: Engine tick order

- **Where:** `src/main.ts` (the loop)
- **What it does:** `storyTick`, `storyAnimateBg(1)`, `walkTick` (walks only), `storyPlayScene` (`adsTick`, then `adsSectionBusy`), `storyRedrawHoliday`, `display.restorePass(0)`. Sound 25 has no counterpart.
- **Original:** `1018:06bf`: `1010:040e(0)`, ..., `1048:1acb`, `1048:0766`, `1010:1e50(0)`, sound 25 when due, `1060:03d3(0)`.
- **Resolve in:** chunk 7 (story and island)
- **Resolution:** `storyStep` (`src/story/story.ts`) follows `1018:06bf`: island step, walk or entry, holiday redraw, sound 25, restore pass; clock ticks run between steps.
- **Status:** resolved (chunk 7)

### OQ-29: One ADS tick per engine tick, with the tick count as the clock

- **Where:** `src/main.ts` (the loop, `now`), `src/engine/clock.ts` (`MS_PER_TICK = 20`)
- **What it does:** runs one story step (and one ADS tick while a scene plays) every 20 ms and passes the number of steps so far as the clock that due times and end times are compared with.
- **Original:** `1008:16c2` adds 1 to the clock `1068:2e70`/`2e72` per timer callback; `1018:06bf` runs from the message loop (`1008:15c8`), so several steps can run per clock tick, or none. The timer rate and how often the story step runs are not checked.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** a story step every 50 ms (`1008:0fcd` `SetTimer`), at most one per period; the clock and its countdowns every 16 ms (`1040:076a(13)`, `1040:07e6(.., 4)`, `1008:16c2`), caught up after a slow frame (`EngineClock`, `src/engine/clock.ts`). The ADS tick gets the clock `Timers.now`, not a step count.
- **Status:** resolved (chunk 7)

### OQ-30: The ADS is loaded fresh for every scene

- **Where:** `src/story/story.ts` (`startScene`)
- **What it does:** builds a new `AdsState` for each scene, so every node starts idle.
- **Original:** `1018:0c62` keeps the loaded ADS when the next scene uses the same ADS id, so nodes keep their modes, and a node of the previous scene that loops on itself can go on playing; it unloads the ADS (`1048:067f`) only when the id changes.
- **Resolve in:** chunk 7 (story and main loop)
- **Resolution:** `loadAdsById` (`src/story/story.ts`) keeps the ADS state while consecutive entries use the same id, and every new sequence drops it (`1018:0c62`, `1018:0673`).
- **Status:** resolved (chunk 7)

### OQ-25: Walk drawing bridge

- **Where:** `src/walk/walk.ts` (`startWalk`, `walkTick`, `walkHold`, `walkDraw`), called by the story bridge in `src/story/story.ts` (`walkStep`, `holdJohnny`) once per story step
- **What it does:** the current walk frame is drawn on B every tick with the TTM sprite rects (`(x, y, w, h + 2)` into `(B → A, 0)`, `(B → A, 1)`, `(C → B, 0)`), and the palm is drawn over Johnny when he is behind it. The last frame is drawn again on the tick the walk ends, so he stays on screen through the 80-tick arrival rest. Browser check (2026-10-18): without that, Johnny vanished for the rest (1.6 s) before the next scene; pinned in `src/walk/walk.data.test.ts`.
- **Original:** walking is driven from `1048` (chunk 8); its draw calls and rects are not checked.
- **Story bridge (chunk 7):** the story calls the walk through `src/story/story.ts` (`walkStep`, `holdJohnny`, `newWalk`), all made up: spots 1..6 become 0..5; a target spot or heading of "any" means the current one; with Johnny at spot 0 he is moved without walking; idle entries draw his standing frame each step (`walkHold`); the walk offset is the island offset plus one (`1018:0094` draws at the island offset plus the frame's x, and `walkDraw` subtracts one); the walk timers (6, 80) now count 16 ms clock ticks; the 80-tick arrival rest is jc_reborn's and has no counterpart in `1018:06bf`.
- **Resolve in:** chunk 8 (walking)
- **Resolution:** `src/walk/walk.ts` ports `1018:0000`, `1018:0074`, `1018:0094`, `1018:03ac`, and `1018:03ea` with the original tables (`src/walk/walk-tables.ts`, generated from `1068:02e1`..`165f`). The story calls `walkStep` and `walkReset` where `1018:06bf` calls `1018:0094` and `1018:0074`, and `isAtSpot` stores the target in the walk (`1018:0b46`). Spots are 1..6; a segment is picked from the route by percent with the story's random generator; Johnny turns one heading per frame; the frame delay is 4 clock ticks (`Timers.walk`, `1068:30d4`), set again after every draw; there is no rest on arrival; the frame is drawn on every story step at the island offset plus the frame's x and y, only the palm trunk is redrawn over it (`1010:1551` mode 0), and the three dirty rects have the image's size. `src/walk/walk.data.test.ts` matches the original walk trace (`re/fixtures/walk/traces.tsv`). The jc_reborn walk (`calcpath.ts`, `calcpath-data.ts`, `walk-data.ts`, `walkHold`, the 6 and 80 tick timers, the palm sprites 12 and 13) is deleted.
- **Status:** resolved (chunk 8)
