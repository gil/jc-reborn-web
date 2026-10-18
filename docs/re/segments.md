# Segment Overview

Which NE segment holds which subsystem, based on the functions named so far. Update when a chunk learns more.

| Segment | Ghidra | Size | Main subsystem | Evidence |
| --- | --- | --- | --- | --- |
| Code1 | `1000` | `0x28a9` | `rtl` | Borland runtime helpers (`rtl_lxmul`, `rtl_scopy`, shifts) |
| Code2 | `1008` | `0x1711` | `platform` | `platform_winMain`, `platform_screenSaverProc`, `platform_defScreenSaverProc`, INI load/save, `platform_initSaver`; also `story_idleTick` |
| Code3 | `1010` | `0x1f6f` | `story` (island scene), mostly unclear | Only `story_drawIsland` named so far |
| Code4 | `1018` | `0x1f5f` | mixed: `story`, `ads`, `resources`, `walk` | `story_stepScene`, `ads_loadAdsById`, `walk_loadJohnWalkBmp`, `platform_messageBoxFromResource`. `1018:1008`..`1018:1d70` is the resource layer: `RESOURCE.MAP` loading (`resources_readResourceMap`), the name hash (`resources_hashName`), and the virtual file layer over `RESOURCE.001` (`resources_openFile`, `resources_readFile`, `resources_seekFile` and friends). See `resources.md` |
| Code5 | `1020` | `0x083c` | `audio`, `gfx` transitions | `audio_loadWaveResources`, `audio_playSound`, `audio_closeMciDevice`, `platform_requestExit`; the wipe dispatcher `gfx_wipeScreen` (`1020:0364`) and its six wipes (`1020:0512`..`1020:071c`). See `graphics.md` |
| Code6 | `1028` | `0x1b1e` | `resources` | `1028:0000`..`1028:1797` is the decompression stream (`resources_openStream`, `resources_readStream`, `resources_closeStream`) and the stored, RLE, and LZW codecs, both read and write sides. Every loader uses it for compressed chunks. `1028:17c8`..`1028:1b0d` are 50 thunks: `decoders_callLoadBmp`, `decoders_callLoadScreen`, three forwarders to graphics code, and 45 stubs that return a constant, mostly called from the TTM interpreter (OQ-14). See `resources.md` and `decoders.md` |
| Code7 | `1030` | `0x1bb4` | `decoders`, `gfx`, cursors | The BMP loader (`decoders_loadBmp`, `decoders_readBmpInfo`, `decoders_bmpPixelBytes`, `decoders_freeBmpInfo`, `decoders_expandAmgBits`) and the SCR loader (`decoders_loadScreen`); `gfx_freeBitmaps`, `gfx_countBitmapRecords`, `gfx_drawLine`, text (`gfx_drawText`, `gfx_loadFont`), `gfx_drawSpriteStretched`, saved rects (`gfx_saveRectBits`, `gfx_restoreRectBits`, `gfx_rectBitsSize`), cursor table (`platform_registerCursor` and friends). See `decoders.md` and `graphics.md` |
| Code8 | `1038` | `0x1ec8` | `decoders`, `gfx` | `1038:0000`..`1038:0619` is the chunk reader every loader uses (`decoders_openChunkFile`, `decoders_findChunk`, `decoders_chunkSize`, `decoders_closeChunkFile`, and helpers) plus `platform_nearMalloc`. Then `gfx_copyRect`, `gfx_presentRect`, the sprite blit (`gfx_drawSprite`, `gfx_drawSpritePlain`), scaling dead code (`gfx_rescaleSprite`, `gfx_doubleBitmap`, `gfx_halveBitmap`, `gfx_rescaleDisplay`), display setup (`gfx_initDisplay`, `gfx_closeDisplay`), `gfx_applyClip`, `gfx_drawRect`, `gfx_createColorBrush`. See `decoders.md` and `graphics.md` |
| Code9 | `1040` | `0x11db` | `gfx`, `decoders` | The bitmap builder (`gfx_buildBitmaps`, `gfx_buildBitmapMask`, `gfx_flipPixelRows`, `gfx_mirrorPixelRows`), `gfx_blitPixelRows`, `gfx_drawCircle`, `gfx_paletteColor`, the palette loader (`decoders_loadPalette`) and palette slots (`gfx_selectPalette`, `gfx_freePalette`), `gfx_drawPixel`, the bitmap matrix (`decoders_loadBmpMatrix`, `gfx_freeBmpMatrix`, `gfx_blitBmpMatrix`, `gfx_scrollBmpMatrix`), timer callback table. See `decoders.md` and `graphics.md` |
| Code10 | `1048` | `0x1f1f` | `ads` | Starts with the ADS loader: `ttm_loadTtmWithId`, `ads_loadAds`, its size table (`ads_nextInstruction`, table at `1048:0383`), and the section index (`ads_indexSections`, `ads_sectionSceneIds`). See `decoders.md` |
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
- `1048:0383`: ADS size table in the code segment, 35 opcodes with handler offsets at `+0x46`. Read by `ads_nextInstruction` (`1048:0303`).
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
- The 11 opcode jump tables (linear-search `switch`es in the `1048` and `1058` code segments): `scripts/re/jump-tables.json`.

`JOHNWALK.BMP` at `1068:27d2` is the name `0xf02f` compares against (`1058:079f`), and `Unable to load bitmap file %s` at `1068:27df` its failure log (`1058:07c5`); both are referenced only from case code the export missed before chunk 5. Other code loads `JOHNWALK.BMP` from the copy at `1068:0355`.
