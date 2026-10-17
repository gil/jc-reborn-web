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

## Resolved

None yet.
