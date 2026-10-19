# Segment Overview

Which NE segment holds which subsystem, based on the functions named so far. Update when a chunk learns more.

| Segment | Ghidra | Size | Main subsystem | Evidence |
| --- | --- | --- | --- | --- |
| Code1 | `1000` | `0x28a9` | `rtl` | Borland runtime helpers (`rtl_lxmul`, `rtl_scopy`, shifts) |
| Code2 | `1008` | `0x1711` | `platform`: window procedure, timing, settings, startup | `platform_winMain`, the window procedure `platform_screenSaverProc` (50 ms `WM_TIMER`), `platform_defScreenSaverProc`, the settings (`platform_loadSettings`, `platform_saveSettings`) and their dialogs, startup and shutdown (`platform_initSaver`, `platform_shutdownSaver`), the 16 ms clock `platform_clockTick`, and the idle callback `story_idleTick`. See `story.md` |
| Code3 | `1010` | `0x1f6f` | `story` (the island) | The island: drawing (`story_drawIsland`, `story_placeIsland`), the island flags (`story_setIslandFlags`), surf, raft, holiday sprite, clouds, ocean waves, and the redraw of island parts over sprites. See `island.md` |
| Code4 | `1018` | `0x1f5f` | mixed: `story`, `ads`, `resources`, `walk` | `1018:0000`..`1018:0eb5` is the walk (`1018:0000`..`1018:03ea`: `walk_loadJohnWalkBmp`, `walk_freeJohnWalkBmp`, `walk_resetPath`, `walk_step`, `walk_routeOf`, `walk_segmentFrames`; see `walk.md`) and the story step and sequence builder (`story_step`, `story_newSequence`, `story_buildQueue`, `story_pickScene`, `story_advanceDays`, `ads_loadAdsById`); see `story.md`. `1018:1008`..`1018:1d70` is the resource layer: `RESOURCE.MAP` loading (`resources_readResourceMap`), the name hash (`resources_hashName`), and the virtual file layer over `RESOURCE.001` (`resources_openFile`, `resources_readFile`, `resources_seekFile` and friends); see `resources.md`. `1018:1e60`..`1018:1ef5` is the random generator (`story_random`, `story_seedRandom`, `story_randomPercent`) |
| Code5 | `1020` | `0x083c` | `audio`, `gfx` transitions, `platform` | `audio_loadWaveResources`, `audio_playSound`, `audio_closeMciDevice`, `platform_requestExit`, the password helpers (`platform_encodePassword`, `platform_checkPassword`, `platform_passwordDialog`); the wipe dispatcher `gfx_wipeScreen` (`1020:0364`) and its six wipes (`1020:0512`..`1020:071c`). See `graphics.md` and `story.md` |
| Code6 | `1028` | `0x1b1e` | `resources` | `1028:0000`..`1028:1797` is the decompression stream (`resources_openStream`, `resources_readStream`, `resources_closeStream`) and the stored, RLE, and LZW codecs, both read and write sides. Every loader uses it for compressed chunks. `1028:17c8`..`1028:1b0d` are 50 thunks: `decoders_callLoadBmp`, `decoders_callLoadScreen`, three forwarders to graphics code, and 45 stubs that return a constant, mostly called from the TTM interpreter (OQ-14). See `resources.md` and `decoders.md` |
| Code7 | `1030` | `0x1bb4` | `decoders`, `gfx`, cursors | The BMP loader (`decoders_loadBmp`, `decoders_readBmpInfo`, `decoders_bmpPixelBytes`, `decoders_freeBmpInfo`, `decoders_expandAmgBits`) and the SCR loader (`decoders_loadScreen`); `gfx_freeBitmaps`, `gfx_countBitmapRecords`, `gfx_drawLine`, text (`gfx_drawText`, `gfx_loadFont`), `gfx_drawSpriteStretched`, saved rects (`gfx_saveRectBits`, `gfx_restoreRectBits`, `gfx_rectBitsSize`), cursor table (`platform_registerCursor` and friends). See `decoders.md` and `graphics.md` |
| Code8 | `1038` | `0x1ec8` | `decoders`, `gfx` | `1038:0000`..`1038:0619` is the chunk reader every loader uses (`decoders_openChunkFile`, `decoders_findChunk`, `decoders_chunkSize`, `decoders_closeChunkFile`, and helpers) plus `platform_nearMalloc`. Then `gfx_copyRect`, `gfx_presentRect`, the sprite blit (`gfx_drawSprite`, `gfx_drawSpritePlain`), scaling dead code (`gfx_rescaleSprite`, `gfx_doubleBitmap`, `gfx_halveBitmap`, `gfx_rescaleDisplay`), display setup (`gfx_initDisplay`, `gfx_closeDisplay`), `gfx_applyClip`, `gfx_drawRect`, `gfx_createColorBrush`. See `decoders.md` and `graphics.md` |
| Code9 | `1040` | `0x11db` | `gfx`, `decoders`, `platform` | The bitmap builder (`gfx_buildBitmaps`, `gfx_buildBitmapMask`, `gfx_flipPixelRows`, `gfx_mirrorPixelRows`), `gfx_blitPixelRows`, `gfx_drawCircle`, `gfx_paletteColor`, the palette loader (`decoders_loadPalette`) and palette slots (`gfx_selectPalette`, `gfx_freePalette`), `gfx_drawPixel`, the bitmap matrix (`decoders_loadBmpMatrix`, `gfx_freeBmpMatrix`, `gfx_blitBmpMatrix`, `gfx_scrollBmpMatrix`), the timer callbacks (`platform_initTimers`, `platform_addTimerCallback`, `platform_runTimerCallbacks` and friends, `1040:076a`..`1040:089a`). See `decoders.md`, `graphics.md`, and `story.md` |
| Code10 | `1048` | `0x1f1f` | `ads` | The ADS loader (`ttm_loadTtmWithId`, `ads_loadAds`, `ads_unload`, its size table `ads_nextInstruction`, the section index `ads_indexSections`, `ads_sectionSceneIds`), the section scripts (`ads_runBlock`, `ads_runInstruction`, `ads_evalConditions`, the block skippers, `ads_randomBlock`, the scene operations), section state setters, and the tick (`ads_tick`, `ads_advancePage`, `ads_sectionBusy`). See `decoders.md` and `ads.md` |
| Code11 | `1050` | `0x0bc7` | `ttm` | Starts with the TTM loader and page index: `ttm_loadTtm`, `ttm_selectTtm`, `ttm_addTagRecord`, `ttm_skipStringArg`, `ttm_indexPages`. Then TTM setup and helpers: the checked page run (`ttm_runPageChecked`), the pending palette (`ttm_activatePendingPalette`), unloading (`ttm_unload`, `ttm_unloadAll`), the dirty-rect helper (`ttm_markDrawn`), and screen to background (`ttm_screenToBackground`, `ttm_copyToBackground`). See `decoders.md` and `ttm.md` |
| Code12 | `1058` | `0x1c30` | `ttm` | The TTM page runner `ttm_runPage` (`1058:040c`, current opcode at `1068:46da`), the opcode handlers (`ttm_soundOpcode`, `ttm_drawOpcode`, and the cases of its control table), `ttm_pageOfTag`, and the effects (`ttm_effectOpcode` and helpers). Its switches are linear-search jump tables in the code segment (`scripts/re/jump-tables.json`). It loads screens, bitmaps, and matrices through the `1028` thunks. See `ttm.md` |
| Code13 | `1060` | `0x0a7e` | `gfx` dirty rects, `platform` | `1060:0000`..`1060:0780` are the dirty-rect lists: node pool, `gfx_addDirtyRect`, `gfx_replayDirtyList`, and the restore pass `gfx_restoreDirtyRects`. Then `platform_globalAllocLock`, `platform_globalUnlockFree`. See `graphics.md` |
| Data14 | `1068` | `0x47c0` | data | Auto data segment: globals, strings, heap, stack |

## Tables found

- `1068:0262`: three near pointers to `OCEAN00.SCR`, `OCEAN01.SCR`, `OCEAN02.SCR`. `story_drawIsland` (`1010:0136`) picks one at random.
- `1068:166e`: ADS file table, 17-byte entries: 2-byte id, 13-byte file name, 2-byte cached handle. First entry is id -2 with no name. Ids 101, 102, 104 to 111 map to `ACTIVITY.ADS` .. `WALKSTUF.ADS` (no id 103). Ends at id 0. Read by `ads_loadAdsById` (`1018:0c62`) and `1018:0d11`.
- `1068:3365`: archive table filled by `resources_readResourceMap` (`1018:1771`), 0x1c bytes per archive.
- `1068:1dc2`: compression method table, 14 bytes per method for methods 0..2 (stored, RLE, LZW): buffer and state sizes plus read, write, and init functions. Read by `resources_initStreamMethod` (`1028:0547`).
- `1068:3f66`: stream slot table, 100 near pointers to 0x21-byte stream records. Filled by `resources_allocStreamSlot` (`1028:04f8`).
- `1068:3499`: open-file slots, 10 entries of 18 bytes, one per open archived resource. Filled by `resources_openFile` (`1018:1019`).
- `1068:414e`: 4 chunk reader records of `0x43` bytes, one per open chunked resource. Found by `decoders_chunkReaderFor` (`1038:0000`).
- `1068:425a`: backup of one chunk reader record, taken by `decoders_findChunk` (`1038:0215`) and restored on failure by `decoders_restoreChunkReader` (`1038:01da`).
- `1068:25b0`: 64-byte palette level table (level `v` gives `v × 4`, 63 gives 255). Read by `decoders_loadPalette` (`1040:09eb`).
- `1068:45e4`: palette slots, near pointers; slot 0 is the active palette, 1..9 are loaded ones. Filled by `decoders_loadPalette` (`1040:09eb`).
- `1068:460c`: 10 ADS slots, far pointers to `0x472`-byte records. Filled by `ads_loadAds` (`1048:0079`).
- `1068:2634` / `1068:2638`: head of the TTM record list and the current TTM record. Filled by `ttm_loadTtm` (`1050:0177`), selected by `ttm_selectTtm` (`1050:03e2`).
- `1068:263c` / `1068:263e`: head of the TTM tag record (thread node) list (`0x3d`-byte near nodes) and the current node. Filled by `ttm_addTagRecord` (`1050:042a`).
- `1068:2608`: current ADS slot index (`-1` = none). Set by `ads_indexSections` (`1048:04fc`).
- `1068:2606`: index of the section `ads_tick` (`1048:1acb`) is running; never `-1`.
- `1068:4608`: high word (`460a`) is the ADS end-of-block counter, raised by `0x1500`, `0x1510`, `0x1520` in `ads_runInstruction` (`1048:1519`) and cleared by `ads_runBlock` (`1048:1925`).
- `1068:4634`: result of the last ADS condition chain (`ads_evalConditions`, `1048:1223`).
- `1068:2e70`: 32-bit clock (high word at `2e72`), +1 per timer callback (`1008:16c2`). Read by `ads_tick`, `ads_advancePage`, `ads_addScene`. See `ads.md`.
- `1048:0383`: ADS size table in the code segment, 35 opcodes with handler offsets at `+0x46`. Read by `ads_nextInstruction` (`1048:0303`).
- `1048:1142`: 18-entry table of `ads_skipBlock` (`1048:106b`): `0xFFFF`, the 15 if opcodes `0x1310`..`0x13c1`, `0x1500`, `0x1510`.
- `1048:14bd`: 23-entry condition table of `ads_evalConditions` (`1048:1223`).
- `1048:1875`: 44-entry opcode table of `ads_runInstruction` (`1048:1519`).
- `1068:260a`: the 2 ADS opcodes that name scenes (`0x2000`, `0x2005`). Read by `ads_sectionSceneIds` (`1048:040f`).
- `1068:1e24`: function pointer to `decoders_bmpPixelBytes` (`1030:000e`), called by `decoders_loadBmp` (`1030:124a`).
- `1068:2574`: function pointer to the bitmap builder `1040:0000`, called by `decoders_loadBmp` (`1030:124a`).
- `1068:2578`: function pointer to `1040:0000` too, used only by the dead `BMP:VGA:`/`BMP:AMG:` branch of `decoders_loadBmp`.
- `1068:46f0`: 20 dirty-list heads (near pointers to 26-byte nodes). Used by the `1060` list code.
- `1068:46ee` / `1068:46ec`: free dirty-node list and the node pool count. Grown by `gfx_growDirtyPool` (`1060:0000`).
- `1068:287e` / `1068:2882`: the restore table (pairs of near pointers to the source and target DC globals) and its single `(B, A)` pair. Walked by `gfx_restoreDirtyRects` (`1060:03d3`).
- `1068:287c`: `0xffff`, the source of saved-bits (kind 4) dirty rects.
- `1068:1ea3`..`1068:1eae`: clip on, inclusive clip rect, fill flag, background and foreground colors (with text colors at `1068:1ea0`..`1ea2`). See `graphics.md`, `Surfaces and clip`.
- `1068:1eb0`..`1068:1eb8`: the three offscreen DCs C, B, A (`1eb0`, `1eb2`, `1eb4`), the copy source `1eb6`, and the draw target `1eb8`.
- `1068:45a0`..`1068:45a4`: the three 640 × 480 offscreen bitmaps.
- `1068:361a`: wipe counter, picks the next wipe in `gfx_wipeScreen` (`1020:0364`).
- `1068:2e74`..`1068:2e77`: scale modes, all 3 at runtime, so every scaling branch is dead.
- `1068:46d8`: TTM replay flag, a copy of the thread node's word `[7]`.
- `1068:4644`: goto page (`0xFFFF` = none).
- `1068:4642`: purge flag.
- `1068:46e6`: delay set by the page (`0xFFFF` = none).
- `1068:4646`: pending palette (near offset, segment at `4648`).
- `1068:46d6` / `1068:4106`: mirror next load: set by `0x2012`, copied for the load.
- `1068:27c0`: keep drawings (no `C → B` rect when set).
- `1068:27c2`: page-call depth.
- `1068:46e4` / `1068:46e2`: island offset x, y.
- `1068:46e0` / `1068:46de`: page-call offset x, y.
- `1068:4640`: screen loaded in this page.
- `1068:30d2`: shared `JOHNWALK.BMP` bitmap list.
- `1068:2638`: current TTM record.
- `1068:1756`: the scene table, 80 entries of 17 bytes ending with a 0 word. Read by `story_pickScene` (`1018:0d50`). See `story.md`, `Scene table`.
- `1068:30f2` / `1068:30f0`: the scene queue (near pointers into the scene table, ending with 0) and the current position. Built by `story_buildQueue` (`1018:089b`), walked by `story_step` (`1018:06bf`).
- `1068:1ce4` / `1068:1ce6` / `1068:1ce8`: the random generator's read index (24), write index (55), and 56-word table. Used by `story_random` (`1018:1e60`).
- `1068:00b6`..`1068:00be`: the settings Background, Clouds, Waves, Sounds, StartTime (1, 1, 1, 1, 900). Read and written by `platform_loadSettings` / `platform_saveSettings`.
- `1068:2d94`..`1068:2d9b`: the day counters: stored day, month, year (words), Introduction and NumDays (bytes). Moved by `story_advanceDays` (`1018:0b87`) and `story_pickScene`.
- `1068:45ac`: 5 timer callback slots of 10 bytes (far callback, period, 32-bit next time); base tick `1068:45de`, base time `1068:45a8`. Filled by `platform_addTimerCallback` (`1040:07e6`).
- `1068:30e2` / `1068:30de` / `1068:30e0` / `1068:30dc`: Johnny's spot and heading, and the walk target spot and heading. Set by `story_step`, `story_newSequence`, `story_isAtSpot` (`1018:0b46`), `walk_loadJohnWalkBmp`, and `walk_step`; see `walk.md`, `Globals`.
- `1068:02de`: walk segments, 3 signed bytes each (start heading, end heading, end spot) for segments 0..34. Read by `walk_step` (`1018:0094`). See `walk.md`, `Tables`.
- `1068:0347` / `1068:034e`: the standing and walking turn set (a segment id) of each spot 0..6. Read by `walk_step`.
- `1068:0362`..`1068:0aa1`: the 30 walk route lists, one per (from, to) spot pair. Read by `walk_step`.
- `1068:0a94`: the walk route table base; the 36 words used start at `0aa2` (`0x0a94 + 12 × from + 2 × to`). Read by `walk_routeOf` (`1018:03ac`).
- `1068:0aea`..`1068:165f`: the 34 walk frame lists (sprite, x, y records, each list ending with a zero record). Addressed by `walk_segmentFrames` (`1018:03ea`).
- `1068:30c6`..`1068:30d4`: the walk state: frame, wanted heading, end spot, end heading, next record, route, the `JOHNWALK.BMP` list, frame delay. Used by `walk_step`; see `walk.md`, `Globals`.
- `1068:30b8`: the time slot (0..15) of the current sequence. Set by `story_newSequence` (`1018:0540`).
- `1068:30ba`: the holiday (0..4) of the current sequence. Set by `story_newSequence`.
- `1068:334e`: the ADS id whose file is loaded. Set by `ads_loadAdsById` (`1018:0c62`).
- `1068:30bc`: a speed figure from `story_idleTick` (`1008:15c8`); always 0, since its factor `1068:2e14` is never written. Read by `1010:04a2`.
- The 11 opcode jump tables (linear-search `switch`es in the `1048` and `1058` code segments): `scripts/re/jump-tables.json`.

`JOHNWALK.BMP` at `1068:27d2` is the name `0xf02f` compares against (`1058:079f`), and `Unable to load bitmap file %s` at `1068:27df` its failure log (`1058:07c5`); both are referenced only from case code the export missed before chunk 5. Other code loads `JOHNWALK.BMP` from the copy at `1068:0355`.
