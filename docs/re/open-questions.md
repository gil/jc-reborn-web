# Open Questions

Behavior we haven't settled against the original, and workarounds kept without a known root cause. When one is resolved, write the finding in `<subsystem>.md`, fix or delete the code, and move the entry to "Resolved" with the address that settled it.

## Workarounds without a known root cause

### OQ-1: Story watchdog force-ends scenes after 8000 ticks

- **Where:** `src/story/story.ts:332`
- **What it does:** ends the current scene once `playingTicks > 8000`, whatever the threads are doing.
- **Old guess behind it:** some scenes cycle forever without reaching an end.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-2: ADS pre-tick sweep frees threads with a nil TTM slot

- **Where:** `src/ads/scheduler.ts:401`
- **What it does:** before each ADS tick, frees threads whose TTM slot is nil or unloaded.
- **Old guess behind it:** threads leak after walks and block the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open

### OQ-3: Orphan threads force-stopped 100 ticks after ADS END

- **Where:** `src/ads/scheduler.ts:45-49`, `src/ads/scheduler.ts:479-483`
- **What it does:** after END, waits `STOP_REQUEST_GRACE_TICKS = 100` ticks for threads to finish, then force-stops the rest.
- **Old guess behind it:** GOTO-loop threads never see the stop request and wedge the scene.
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open

### OQ-4: Straggler threads freed before a walk starts

- **Where:** `src/story/story.ts:274-279`
- **What it does:** when the story moves to a walk, stops every thread still running.
- **Old guess behind it:** threads from the finished scene leak into the walk.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-5: Residual threads freed after a walk ends

- **Where:** `src/story/story.ts:306-311`
- **What it does:** when the walk is done, stops every thread still running before the next scene starts.
- **Old guess behind it:** threads survive the walk and block the next scene.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-6: Scene picker drops wanted flags when nothing matches

- **Where:** `src/story/story.ts:172-177`
- **What it does:** if no scene has all wanted flags, picks a random scene that only avoids the unwanted flags.
- **Old guess behind it:** some flag and day combinations have no candidate, and an empty pick would crash.
- **Resolve in:** chunk 7 (story and main loop)
- **Status:** open

### OQ-8: Resource lookup is case-sensitive in our code

- **Where:** `src/resource/resource-archive.ts`, callers of `archive.byName.get` (`src/ttm/interpreter.ts:182`, `src/ttm/interpreter.ts:193`, `src/ttm/bmp-slots.ts:6`)
- **What it does:** exact match on the stored name. The original matches the stored name case-insensitively and refuses a path prefix (`1018:1019`, `1018:195a`, `1000:197e`).
- **Old guess behind it:** every name in the data is already uppercase with no path. True for ADS sub-resource names (`src/resource/resource-archive.data.test.ts`); not checked for TTM.
- **Resolve in:** chunk 5 (TTM interpreter), by checking every resource name TTM bytecode loads
- **Status:** open

### OQ-9: Screen pixels with index 0 are see-through in our code

- **Where:** `src/decode/nibbles.ts:10` (`unpackNibbles` maps index 0 to `TRANSPARENT` for screens and bitmaps), `src/gfx/compositor.ts:31` (draws `TRANSPARENT` as black)
- **What it does:** a screen pixel with index 0 shows black, or whatever a lower layer holds.
- **Original:** `gfx_blitPixelRows` (`1040:0286`) copies screens with `BitBlt` `SRCCOPY`, and `gfx_buildBitmaps` (`1040:0000`) keeps the palette's color 0 in the color table when `1068:2572` is 0, so index 0 is drawn opaque in palette color 0 (`JOHNCAST.PAL` color 0 is 168, 0, 168). Only bitmaps force color 0 to black and use the mask from `1040:035c`. Index 0 appears in `INTRO.SCR` (1,894 pixels), `ISLETEMP.SCR` (18), `OCEAN00.SCR` (9,917), `OCEAN01.SCR` (9,254), and `OCEAN02.SCR` (10,013).
- **Old guess behind it:** index 0 is a transparent sentinel never used as a visible color.
- **Resolve in:** chunk 4 (graphics), after checking whether those pixels are ever visible (later drawing may cover them, for example the island over the ocean)
- **Status:** open

### OQ-10: TTM interpreter frames bytecode and finds tags on its own

- **Where:** `src/ttm/interpreter.ts:26` (`step`), `src/ttm/interpreter.ts:46` (`findTagOffset`), `src/ttm/interpreter.ts:56` (`findPreviousTagOffset`), `src/ads/scheduler.ts:201` (`findTtmTag`)
- **What it does:** re-reads instructions with its own framer (signed args, no `0xAF1F`/`0xAF2F` case, no arg code check) and finds a tag by scanning the bytecode for `0x1111 <id>` each time, starting right after it.
- **Old guess behind it:** a tag is a jump label inside the bytecode.
- **Original:** the loader indexes the bytecode once (`1050:04d6`): pages split after each `0x0FF0`, and each `0x1111` is recorded with the page it sits on (`1050:042a`). `decodeTtm` now returns `pageOffsets` and `tags` built the same way, and `readTtmInstruction` (`src/decode/ttm-bytecode.ts`) frames exactly like the original.
- **Resolve in:** chunk 5 (TTM interpreter): find how the original interpreter uses the page table and tag records, then switch `src/ttm/` and `findTtmTag` to `readTtmInstruction`, `pageOffsets`, and `tags`.
- **Status:** open

### OQ-11: ADS scheduler frames bytecode with its own size table

- **Where:** `src/ads/opcodes.ts` (`ADS_ARG_COUNTS`), `src/ads/scheduler.ts` (`scanBytecode`, `findAdsTag`, `adsPlayChunk`, and every place that steps over args)
- **What it does:** steps over ADS instructions with a hand-made table that disagrees with the original's (`1048:0383`, read by `1048:0303`): `0xF010` takes 0 args in ours and 1 in the original (in the data it is always followed by `0xFFFF`, which the original reads as its arg, not as a section end); `0x1520` takes 5 in ours and 0 in the original (not in its table; the one use, in `ACTIVITY.ADS`, is followed by a normal `0x2005` that ours eats as its args); the 24 table opcodes ours does not list (`0xf000`, `0xf210`, `0x1010`..`0x1060`, `0x1080`, `0x1310`, `0x1320`, `0x1340`, `0x1380`..`0x13c1`, `0x2000`, `0x2015`, `0x2020`, `0x4010`) are taken for section tag words with no args. It also finds sections and tags with its own scan (any word not in its table is a tag) instead of the section index.
- **Old guess behind it:** arg counts worked out by hand from the data and from jc_reborn.
- **Original:** `adsArgCount` and `indexAdsSections` (`src/decode/ads-bytecode.ts`) follow `1048:0303` and `1048:04fc`, checked on all 65,536 opcode words and every ADS file. `decodeAds(...).sections` holds the section index: every section starts after its tag word, and only sections closed by a `0xFFFF` count. The `ADS opcode coverage` table in `docs/re/decoders.md` lists every opcode where ours and the original differ.
- **Resolve in:** chunk 6 (ADS scheduler): read how the original interpreter steps over `0xF010` and the other differing opcodes, switch the scheduler to `adsArgCount` and `sections`, then delete `ADS_ARG_COUNTS`.
- **Status:** open

### OQ-12: Per-section scene lists are not built at load time

- **Where:** `src/ads/scheduler.ts` (`scanBytecode`, `chunks`)
- **What it does:** builds its list of scenes per tag while scanning at scene start.
- **Old guess behind it:** jc_reborn's bookmarking scan.
- **Original:** `1048:040f` builds, per section, the distinct tag nodes named by `0x2000`/`0x2005` instructions through `1048:0bf4`, stored at record words `[0x1e9 + i]`. This happens the first time `1048:04fc` selects the slot, not inside `1048:0079`.
- **Resolve in:** chunk 6 (ADS scheduler), together with `1048:0bf4`.
- **Status:** open

### OQ-13: A missing TTM does not fail the ADS load

- **Where:** `src/ads/scheduler.ts` (`makeAdsState`, the `ADS sub-resource not found` warning)
- **What it does:** warns and leaves the slot empty when an `ADS:RES:` name is not in the archive.
- **Old guess behind it:** a missing resource should not stop the show.
- **Original:** `1048:0079` loads every listed TTM at once and fails the whole ADS (unloading every ADS slot and every TTM through `1048:001b`) if one fails. The data never triggers it: every listed name exists (`src/resource/resource-archive.data.test.ts`).
- **Resolve in:** chunk 6 (ADS scheduler)
- **Status:** open

### OQ-15: Line and ellipse pixels are our choice, not GDI's

- **Where:** `src/gfx/gdi/primitives.ts` (`lineTo`, `drawCircle`)
- **What it does:** lines use a midpoint Bresenham that leaves out the end point; circles fill every pixel whose center lies within the radius of the rect center, with a 1-pixel border.
- **Original:** `1030:02ef` and `1038:1bd8` call `MoveTo`/`LineTo`, `1040:0688` calls `Ellipse(cx - r, cy - r, cx + r, cy + r)`. Which pixels GDI picks is Windows behavior, not in `SCRANTIC.SCR`.
- **Resolve in:** only with a reference capture from Windows 3.1; until then the end points, rect edges, and symmetry are pinned and the inner pixels are not
- **Status:** open

### OQ-16: Text drawing is not modeled

- **Where:** `1030:04ee`, `1030:04ce`, `1030:0765`
- **What it does:** `TextOut` with the `WILLY.FON` font, text and back colors from `1068:1ea0`/`1ea1`, back mode from `1068:1ea2`.
- **Ours:** nothing draws text.
- **Resolve in:** chunk 5 (TTM interpreter): find whether any TTM opcode reaches these functions and whether the data uses it
- **Status:** open

### OQ-17: The original presents only dirty rects, the model presents whole frames

- **Where:** `1038:07e8` callers: `1030:02ef` (width `-a - b` when the line goes left or up), `1040:0688` (right and bottom passed as width and height)
- **What it does:** the original copies only the dirty rect of each drawing call to the window, so a wrong rect leaves part of a line on screen later than the rest, or presents too much.
- **Ours:** the browser shows the whole surface every frame.
- **Resolve in:** chunk 5, when the model is wired in: decide whether any visible difference is worth modeling
- **Status:** open

## Past fixes to re-check against the original

Each fix below was made without the decompile. Treat it as a guess until a chunk confirms or replaces it. "Out of scope" rows touch docs, build paths, or sound playback, which have no counterpart in the original.

| Commit | Summary | Chunk |
| --- | --- | --- |
| `85c05ad` | copyZoneToBg skips transparent pixels (colorkey) | 4 |
| `d670686` | SET_DELAY missing timer | 5 |
| `5f4e3a0` | DRAW_RECT/DRAW_CIRCLE no longer add ctx.dx/dy to args 3&4 (width/height) | 5 |
| `0e7cd64` | getUint16/getInt16 mistake | 3 |
| `eb46290` | force-stop orphan TTM threads after ADS END | 6 |
| `6b0be68` | audio playback | out of scope |
| `b631319` | animation sprites sometimes get cut | 4 |
| `8adc66a` | various consistency fixes | 6, 7 |
| `1204c0d` | hain instant phase transitions so a scene-end → walk-start (or walk-end → new-scene-start) completes in one tick. | 7 |
| `c037b5f` | swapped order: storyTick → adsTick → storyAnimateBg | 7 |
| `72fb9d7` | load data relative | out of scope |
| `f47def5` | replace elapsedTicks with mini-based pacing; eliminate second pass in adsTick | 6 |
| `7fef3c3` | replace elapsedTicks with mini-based pacing; eliminate second pass in adsTick | 6 |
| `194d7fb` | add thread leak detection sweeps (pre-tick, begin-scene, start-walk, post-walk) | 6, 7 |
| `613b3c2` | add watchdog timeout (8000 ticks) to force-end self-sustaining scene cycles | 7 |
| `9a40bb2` | LOAD_SCREEN resets dx/dy to zero, sprites render in screen-relative coords after background switch | 5 |
| `0d4078d` | DRAW_BACKGROUND opcode is a no-op, jc_reborn only frees image slots not the framebuffer | 5 |
| `7a9d964` | TIMER opcode sets delay and timer directly, continues loop; remove timerYield workaround | 5 |
| `e1d3bae` | GOTO_TAG defers jump via nextGotoOffset, continues interpret loop instead of returning early | 5 |
| `cacfdb0` | PURGE opcode schedules nextGotoOffset instead of immediate jump, continues interpret loop | 5 |
| `a933bf7` | revert UNKNOWN_6 back to no-op | 6 |
| `31988b3` | revert DRAW_SCREEN implementation for now, to avoid duplication issues | 5 |
| `2ed4424` | GOTO_TAG must yield after jumping, otherwise loops without an UPDATE create infinite tight loops in ttmPlay | 5 |
| `a9610d3` | clear saved zones when all threads from a slot stop, preventing clock block from MEANWHIL.TTM persisting through SUZY.ADS scene | 6 |
| `966476f` | UNKNOWN_6 opcode now checks if scene is running before adding, preventing redundant scene starts in EAT scenes | 6 |
| `c7f3c6b` | implement DRAW_SCREEN opcode for scaled sprite rendering used in sandcastle and plane scenes | 5 |
| `d39b9ac` | clear saved zones between scenes to prevent visual artifacts leaking across transitions | 7 |
| `037819f` | GOTO_TAG searched LOCAL_TAG instead of TAG, causing loops to fall through into wrong animation frames | 5 |
| `27684eb` | problem with threads rendering on top of each other | 6 |
| `c126833` | problem where nothing would start after certain scenes | 6 |
| `d808ee0` | correct file | out of scope |
| `43ef25b` | better color and transparency handling | 3, 4 |
| `e6287e1` | correct original repo | out of scope |
| `db6d598` | flickering animation sprites | 6 |
| `d0bc6b6` | transparency | 3 |

## Not reviewed on purpose

### OQ-7: Compression (write) side of the stream code

- **Where:** `1028:0072`, `1028:0384`, `1028:0a4b`, `1028:11be`, `1028:1233`, `1028:13cf`, `1028:155d`, `1028:157c`, `1028:1654`, `1028:1698`, and the write-mode branches of `1028:0615`, `1028:0875`, `1028:0547`
- **What it does:** the stored, RLE, and LZW encoders and the write-mode stream paths.
- **Why not reviewed:** the engine only reads `RESOURCE.001`; nothing in the original's runtime writes compressed data that we need to reproduce. All four callers of `1028:0615` pass a mode string `"r"`, and `1028:0a4b` (the only way to feed an encoder) has no callers.
- **Status:** open, by choice

### OQ-14: `1028` thunks that do not reach a decoder

- **Where:** `1028:17d8`, `1028:182c`, `1028:1845`, and the stub group `1028:17c8`, `1028:185e`..`1028:1b0d`
- **What it does:** three forward to other code: `1038:0ae4` (four words, role unknown), `1030:15fb` (counts a bitmap record list), and `1030:00fe` (frees a loaded bitmap's DIBs, masks, and records). Of the rest, 42 return 0, `1028:196e` returns nothing, and `1028:1afc` and `1028:1b0d` return 1. Only direct `CALLF`s reference them: 20 of the return-0 stubs are called from `1058` code around the TTM interpreter (`1058:0054`..`1058:00e5`, `1058:021d`, `1058:02ec`, `1058:0a93`, `1058:0aa4`, `1058:1725`); the other 25 stubs have no reference. See `Thunks` in `docs/re/decoders.md`.
- **Why not reviewed:** none of them reaches a decoder; their targets belong to graphics or to the TTM opcode handlers that call the stubs.
- **Chunk 4, step 1:** `1028:182c` (called from `1050:0061`) returns the record count of a bitmap list through `1030:15fb`. `1028:1845` (called from `1050:080c` and twice from `1040:0db0`) frees a loaded bitmap through `1030:00fe`. Both verified; see `Bitmap masks and mirrors` in `docs/re/graphics.md`. `1028:17d8` is left for step 3 (sprites).
- **Resolve in:** chunk 4 (graphics) for `1028:17d8`; chunk 5 (TTM interpreter) for the stub group
- **Status:** open, by choice

## Resolved

None yet.
