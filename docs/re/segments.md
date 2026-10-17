# Segment Overview

Which NE segment holds which subsystem, based on the functions named so far. Update when a chunk learns more.

| Segment | Ghidra | Size | Main subsystem | Evidence |
| --- | --- | --- | --- | --- |
| Code1 | `1000` | `0x28a9` | `rtl` | Borland runtime helpers (`rtl_lxmul`, `rtl_scopy`, shifts) |
| Code2 | `1008` | `0x1711` | `platform` | `platform_winMain`, `platform_screenSaverProc`, `platform_defScreenSaverProc`, INI load/save, `platform_initSaver`; also `story_idleTick` |
| Code3 | `1010` | `0x1f6f` | `story` (island scene), mostly unclear | Only `story_drawIsland` named so far |
| Code4 | `1018` | `0x1f5f` | mixed: `story`, `ads`, `resources`, `walk` | `story_stepScene`, `ads_loadAdsById`, `resources_readResourceMap`, `walk_loadJohnWalkBmp`, `platform_messageBoxFromResource` |
| Code5 | `1020` | `0x083c` | `audio`, `gfx` transitions | `audio_loadWaveResources`, `audio_playSound`, `audio_closeMciDevice`, six `gfx_wipe*` functions, `platform_requestExit` |
| Code6 | `1028` | `0x1b1e` | unclear | Every loader calls `1028:0615`, `1028:0a0d`, `1028:0875` around the `:BIN:`/`:SCR:` chunks (likely decompression). Not named yet |
| Code7 | `1030` | `0x1bb4` | `decoders`, `gfx`, cursors | `decoders_loadBmp`, `decoders_readBmpInfo`, `decoders_loadScreen`, `gfx_drawLine`, `gfx_saveRectBits`, cursor table (`platform_registerCursor` and friends) |
| Code8 | `1038` | `0x1ec8` | `gfx` | `gfx_drawRect`, `gfx_createColorBrush`. Also holds the resource file helpers every loader calls (`1038:016b`, `1038:0215`, `1038:054b`), not named yet |
| Code9 | `1040` | `0x11db` | `gfx`, `decoders` | `gfx_drawCircle`, `gfx_drawPixel`, `gfx_blitPixelRows`, `decoders_loadPalette`, `decoders_loadBmpMatrix`, timer callback table |
| Code10 | `1048` | `0x1f1f` | `ads` | `ads_loadAds` |
| Code11 | `1050` | `0x0bc7` | unclear | No named function |
| Code12 | `1058` | `0x1c30` | unclear | No named function |
| Code13 | `1060` | `0x0a7e` | unclear | `platform_globalAllocLock`, `platform_globalUnlockFree`. `1060:007e` blits the offscreen image to the window on paint, not named yet |
| Data14 | `1068` | `0x47c0` | data | Auto data segment: globals, strings, heap, stack |

## Tables found

- `1068:0262`: three near pointers to `OCEAN00.SCR`, `OCEAN01.SCR`, `OCEAN02.SCR`. `story_drawIsland` (`1010:0136`) picks one at random.
- `1068:166e`: ADS file table, 17-byte entries: 2-byte id, 13-byte file name, 2-byte cached handle. First entry is id -2 with no name. Ids 101, 102, 104 to 111 map to `ACTIVITY.ADS` .. `WALKSTUF.ADS` (no id 103). Ends at id 0. Read by `ads_loadAdsById` (`1018:0c62`) and `1018:0d11`.
- `1068:3365`: archive table filled by `resources_readResourceMap` (`1018:1771`), 0x1c bytes per archive.

Strings with no code reference: `JOHNWALK.BMP` and `Unable to load bitmap file %s` at `1068:27d2` and `1068:27df`. Code loads `JOHNWALK.BMP` from the copy at `1068:0355` instead.
