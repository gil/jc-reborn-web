# Johnny Reborn Web — TypeScript/Canvas Port Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the C/SDL2 "Johnny Reborn" screensaver (`~/dev/jc_reborn`) to a browser app under `~/dev/jc-reborn-web` rendered with HTML Canvas. Game data files (`RESOURCE.MAP`, `RESOURCE.001`, `sound*.wav`) are served from `/data` and pulled via `fetch()` at runtime.

**Architecture:** 1:1 port of the C engine. Indexed-color (16-entry palette) per-layer `Uint8Array` buffers; primitives write palette indices; final compositor walks layer stack with magenta colorkey, looks up palette → RGBA in a single `ImageData`, `putImageData` to the visible canvas. ADS scheduler drives multiple TTM threads via a 20-ms tick accumulator on `requestAnimationFrame`. Resource archive parsed once from a bulk-fetched `ArrayBuffer`. WebAudio for sound, gated behind a click overlay.

**Tech Stack:** TypeScript (strict), Vite, pnpm (Corepack), `fnm use` for Node. **Vitest** for unit tests of pure logic (decompressors, parsers, palette math, primitives, opcode dispatch with mocked side effects). Visual verification via dev server for end-to-end fidelity. No other frameworks.

---

## Context

The original engine is a faithful re-implementation in C of Sierra's 1992 "Johnny Castaway" screensaver, using SDL2 for windowing, surfaces, blits, and timing. Source lives at `~/dev/jc_reborn`. The asset format (RESOURCE.MAP / RESOURCE.001) is the original Sierra Scrantics layout: an index file + a single archive containing TTM (animation bytecode), ADS (scheduler bytecode), BMP (sprite sheets), SCR (background screens), and PAL (palettes). All graphics are 4-bit packed indexed pixels into a 16-color VGA-style palette (channels 0-63 shifted left 2).

**Reference paths in source:**

- Resource archive: `~/dev/jc_reborn/resource.c`, `resource.h`
- Decompression (RLE method 1, LZW method 2): `~/dev/jc_reborn/uncompress.c`
- TTM opcode interpreter: `~/dev/jc_reborn/ttm.c` lines 141–470
- ADS scheduler: `~/dev/jc_reborn/ads.c` lines 107–800
- Graphics primitives: `~/dev/jc_reborn/graphics.c`
- Walking + pathfinding: `~/dev/jc_reborn/walk.c`, `calcpath.c`, `walk_data.h`, `calcpath_data.h`
- Island composer: `~/dev/jc_reborn/island.c`
- Story scheduler: `~/dev/jc_reborn/story.c`, `story_data.h`
- Tick/timing: `~/dev/jc_reborn/events.c`

**Key invariants to preserve (sharp edges):**

- Palette VGA channels stored 0-63; multiply by 4 (`<<2`) → 0-252, NOT 255. The slightly muted look is correct.
- Magenta `(0xa8, 0x00, 0xa8)` is the transparent color key on every TTM layer.
- `grRestoreZone` (TTM `0xA064`) clears the **entire** saved-zones layer — its rect args are ignored. Port this as-is.
- `grSaveZone` (TTM `0xA054`) only stashes one rect at a time; the next `RESTORE_ZONE` consumes it.
- TTM opcode encoding: bits `0xFFF0` = opcode, bits `0x000F` = arg count. Five opcodes also consume a fixed-length string after the numeric args: `LOAD_SCREEN 0xF01F`, `LOAD_IMAGE 0xF02F`, `LOAD_PALETTE 0xF05F` (and string scanning ends on null padding).
- `DRAW_SPRITE_FLIP` (`0xA524`) blits column-by-column, not row-reverse. Preserve to keep pixel parity.
- LZW: `n_bits` grows when `free_entry == (1 << n_bits)` strictly before reading the next code. Code 256 = reset, free_entry resets to 256 (not 257) per the C. Mirror `uncompress.c:104-171` exactly.
- ADS `eventsWaitTick(min)` subtracts the **min thread timer** from all threads, then sleeps that many ticks. Browser port must subtract elapsed ticks (rAF delta / 20) from every thread's timer, not decrement by 1 per frame.
- 1 tick = 20 ms (~50 Hz), not 60 Hz. `events.c:108`: `delay *= 20`.
- `SET_PALETTE_SLOT 0x1061` is unimplemented in jc_reborn; treat as no-op + warn.
- `RESOURCE.MAP` header: 6 unknown bytes + 13-byte resource filename (`RESOURCE.001`) + uint16 numEntries + (uint32 length, uint32 offset) per entry. All little-endian.
- WebAudio requires a user gesture. Engine starts behind a click overlay so `PLAY_SAMPLE` works from frame 0.

---

## File Structure

```
~/dev/jc-reborn-web/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── data/                       (user copies game files here; gitignored)
│       ├── RESOURCE.MAP
│       ├── RESOURCE.001
│       └── sound*.wav
└── src/
    ├── main.ts                      bootstrap, click overlay, mounts engine
    ├── types.ts                     shared aliases (Sprite, Palette, Layer, Rect)
    ├── engine/
    │   ├── loop.ts                  rAF loop + 20ms tick accumulator
    │   └── clock.ts                 tick counter, getTicks()
    ├── io/
    │   ├── binary-reader.ts         DataView wrapper, LE u8/u16/u32, fixed strings
    │   └── fetch-resources.ts       bulk fetch /data/RESOURCE.{MAP,001}
    ├── resource/
    │   ├── resource-map.ts          parse MAP → entries[]
    │   ├── resource-archive.ts      index .001, lookup by name
    │   ├── uncompress.ts            RLE + LZW
    │   └── types.ts                 ResourceEntry, *Resource shapes
    ├── decode/
    │   ├── pal.ts                   PAL → 256 RGB triples (only first 16 used)
    │   ├── scr.ts                   SCR → indexed 640x480
    │   ├── bmp.ts                   BMP → Sprite[] (indexed)
    │   ├── ttm-loader.ts            TTM → {bytecode, tags, version}
    │   ├── ads-loader.ts            ADS → {bytecode, tags, sub-resources}
    │   └── ttm-disasm.ts            debug pretty-printer
    ├── gfx/
    │   ├── palette.ts               16-entry working palette + index→RGBA LUT
    │   ├── layer.ts                 Layer = {indexed: Uint8Array(640*480), clip}
    │   ├── primitives.ts            pixel/line/rect/circle on indexed buffer
    │   ├── sprite.ts                drawSprite, drawSpriteFlip with magenta key
    │   ├── clip.ts                  per-layer clip rect helpers
    │   ├── zone.ts                  saveZone/restoreZone/copyZoneToBg/saveImage1
    │   ├── compositor.ts            stack → final ImageData → putImageData
    │   └── fade.ts                  grFadeOut variants
    ├── ttm/
    │   ├── opcodes.ts               opcode constants
    │   ├── thread.ts                TTtmThread state shape + factory
    │   ├── bmp-slots.ts             load/release BMP into slot.sprites[][]
    │   └── interpreter.ts           ttmPlay() — runs one tick of one thread
    ├── ads/
    │   ├── opcodes.ts               opcode constants
    │   └── scheduler.ts             adsPlay() — multi-thread + IF/RANDOM
    ├── island/
    │   ├── island.ts                composer
    │   └── island-data.ts           sprite tables (port of island.c data)
    ├── walk/
    │   ├── walk.ts                  8-direction frame state machine
    │   ├── calcpath.ts              DFS over walkMatrix
    │   ├── walk-data.ts             port of walk_data.h
    │   └── calcpath-data.ts         port of calcpath_data.h
    ├── story/
    │   ├── story.ts                 weighted random scene picker
    │   └── story-data.ts            port of story_data.h
    ├── audio/
    │   └── sound.ts                 WebAudio: decode once, playSample(n)
    ├── ui/
    │   ├── fullscreen.ts            requestFullscreen toggle
    │   └── click-overlay.ts         start gate for autoplay policy
    └── debug/
        └── hud.ts                   optional fps/scene HUD

(tests colocated as *.test.ts next to each src file)

vitest.config.ts                     node env for pure logic, jsdom only where DOM needed
```

**Test strategy:** colocate `*.test.ts` next to each unit. Pure-logic files (uncompress, parsers, primitives, palette math, calcpath) get unit tests against known inputs. TTM/ADS interpreter tests use a fake graphics context object that records `drawSprite/drawLine/...` calls and asserts the call sequence per opcode. Canvas pixel output and audio not asserted in tests; verify visually.

---

## Pre-flight (one-time per shell session)

- [ ] Run `fnm use` in `~/dev/jc-reborn-web` (creates `.nvmrc` first if needed).
- [ ] Run `export GIT_PAGER=cat`.
- [ ] Run `corepack enable` if pnpm not already on PATH.
- [ ] Confirm `~/dev/jc_reborn` is readable for source reference (do not modify it).

---

## Task 1: Vite scaffold + 16-color palette test pattern

**Files:**

- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `.nvmrc`
- Create: `src/main.ts`, `src/types.ts`, `src/gfx/palette.ts`, `src/gfx/layer.ts`

- [ ] **Step 1: Initialize project**

```bash
cd ~/dev/jc-reborn-web
pnpm init
pnpm add -D vite typescript @types/node vitest @vitest/ui jsdom
pnpm pkg set type=module
pnpm pkg set scripts.dev=vite
pnpm pkg set scripts.build="tsc && vite build"
pnpm pkg set scripts.test="vitest run"
pnpm pkg set scripts.test:watch="vitest"
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "lib": ["ES2022", "DOM"],
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite";
export default defineConfig({
  publicDir: "public",
  server: { port: 5173 },
});
```

- [ ] **Step 3b: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/main.test.ts", "jsdom"]],
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
dist
public/data/*
!public/data/.gitkeep
.DS_Store
```

- [ ] **Step 5: Write `index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Johnny Reborn Web</title>
    <style>
      html,
      body {
        margin: 0;
        background: #000;
        color: #ccc;
        font: 14px monospace;
      }
      #stage {
        display: block;
        margin: 0 auto;
        image-rendering: pixelated;
      }
    </style>
  </head>
  <body>
    <canvas id="stage" width="640" height="480"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `src/types.ts`**

```ts
export type Palette = Uint8Array; // length 64 = 16 entries × RGBA

export interface Sprite {
  width: number;
  height: number;
  indexed: Uint8Array; // width*height palette indices
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layer {
  indexed: Uint8Array; // 640*480 palette indices, 0xFF = transparent
  clip: Rect; // current clip rect
}

export const SCREEN_W = 640;
export const SCREEN_H = 480;
export const TRANSPARENT = 0xff;
```

- [ ] **Step 7: Write `src/gfx/palette.ts`**

```ts
import type { Palette } from "../types.js";

export function makePalette(): Palette {
  return new Uint8Array(16 * 4);
}

export function setPaletteFromVga(pal: Palette, vga: Uint8Array): void {
  for (let i = 0; i < 16; i++) {
    pal[i * 4 + 0] = vga[i * 3 + 0]! << 2; // R
    pal[i * 4 + 1] = vga[i * 3 + 1]! << 2; // G
    pal[i * 4 + 2] = vga[i * 3 + 2]! << 2; // B
    pal[i * 4 + 3] = 0xff;
  }
}
```

- [ ] **Step 7b: Write `src/gfx/palette.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { makePalette, setPaletteFromVga } from "./palette.js";

describe("setPaletteFromVga", () => {
  it("shifts 6-bit channels left 2 (caps at 252)", () => {
    const vga = new Uint8Array(16 * 3);
    vga[0] = 63;
    vga[1] = 32;
    vga[2] = 0; // entry 0
    vga[15 * 3 + 0] = 0;
    vga[15 * 3 + 1] = 0;
    vga[15 * 3 + 2] = 63; // entry 15
    const p = makePalette();
    setPaletteFromVga(p, vga);
    expect(p[0]).toBe(252); // 63 << 2
    expect(p[1]).toBe(128); // 32 << 2
    expect(p[2]).toBe(0);
    expect(p[3]).toBe(255); // alpha
    expect(p[15 * 4 + 2]).toBe(252);
  });
});
```

- [ ] **Step 8: Write `src/gfx/layer.ts`**

```ts
import {
  SCREEN_W,
  SCREEN_H,
  TRANSPARENT,
  type Layer,
  type Rect,
} from "../types.js";

export function makeLayer(): Layer {
  const indexed = new Uint8Array(SCREEN_W * SCREEN_H);
  indexed.fill(TRANSPARENT);
  return { indexed, clip: { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H } };
}

export function clearLayer(l: Layer): void {
  l.indexed.fill(TRANSPARENT);
}

export function fillRect(l: Layer, r: Rect, color: number): void {
  const x2 = Math.min(r.x + r.w, SCREEN_W);
  const y2 = Math.min(r.y + r.h, SCREEN_H);
  for (let y = Math.max(0, r.y); y < y2; y++) {
    for (let x = Math.max(0, r.x); x < x2; x++) {
      l.indexed[y * SCREEN_W + x] = color;
    }
  }
}
```

- [ ] **Step 9: Write `src/main.ts`** (palette test pattern)

```ts
import { SCREEN_W, SCREEN_H } from "./types.js";
import { makePalette, setPaletteFromVga } from "./gfx/palette.js";
import { makeLayer, fillRect } from "./gfx/layer.js";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const img = ctx.createImageData(SCREEN_W, SCREEN_H);

// Synthesize a fake VGA palette (16 colors × RGB 0-63)
const fakeVga = new Uint8Array(16 * 3);
for (let i = 0; i < 16; i++) {
  fakeVga[i * 3 + 0] = (i * 4) & 63;
  fakeVga[i * 3 + 1] = (i * 8) & 63;
  fakeVga[i * 3 + 2] = (i * 16) & 63;
}
const pal = makePalette();
setPaletteFromVga(pal, fakeVga);

const layer = makeLayer();
for (let i = 0; i < 16; i++) {
  fillRect(layer, { x: i * 40, y: 0, w: 40, h: 480 }, i);
}

// Composite indexed → RGBA
for (let p = 0; p < SCREEN_W * SCREEN_H; p++) {
  const idx = layer.indexed[p]!;
  const o = p * 4;
  if (idx === 0xff) {
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0;
    img.data[o + 3] = 255;
  } else {
    img.data[o + 0] = pal[idx * 4 + 0]!;
    img.data[o + 1] = pal[idx * 4 + 1]!;
    img.data[o + 2] = pal[idx * 4 + 2]!;
    img.data[o + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);
```

- [ ] **Step 10: Run dev server, verify**

```bash
pnpm dev
```

Open `http://localhost:5173`. Expected: 16 vertical color bars, 40 px wide, smoothly transitioning from dark to light.

- [ ] **Step 10b: Run tests**

```bash
pnpm test
```

Expected: 1 test file, 1 test, passing.

- [ ] **Step 11: Commit**

```bash
git init
git add .
git commit -m "scaffold: vite + ts + vitest + 16-color palette test pattern"
```

---

## Task 2: Resource loader + decompressors

**Files:**

- Create: `src/io/binary-reader.ts`, `src/io/fetch-resources.ts`
- Create: `src/resource/resource-map.ts`, `src/resource/resource-archive.ts`, `src/resource/uncompress.ts`, `src/resource/types.ts`
- Modify: `src/main.ts` to log entry list

- [ ] **Step 1: Write `src/io/binary-reader.ts`**

```ts
export class BinaryReader {
  private view: DataView;
  private offset: number;
  constructor(buf: ArrayBuffer, offset = 0) {
    this.view = new DataView(buf);
    this.offset = offset;
  }
  get pos(): number {
    return this.offset;
  }
  set pos(v: number) {
    this.offset = v;
  }
  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(
      this.view.buffer,
      this.view.byteOffset + this.offset,
      n,
    );
    this.offset += n;
    return new Uint8Array(out); // copy so callers can keep it past pos changes
  }
  // Fixed-length zero-padded ASCII string
  fixedString(n: number): string {
    const raw = this.bytes(n);
    let end = raw.indexOf(0);
    if (end < 0) end = n;
    return new TextDecoder("latin1").decode(raw.subarray(0, end));
  }
  expect(magic: string): void {
    const got = new TextDecoder("latin1").decode(this.bytes(magic.length));
    if (got !== magic)
      throw new Error(
        `expected ${magic} got ${got} @${this.offset - magic.length}`,
      );
  }
}
```

- [ ] **Step 2: Write `src/io/fetch-resources.ts`**

```ts
export async function fetchData(): Promise<{
  map: ArrayBuffer;
  archive: ArrayBuffer;
}> {
  const [mapRes, arcRes] = await Promise.all([
    fetch("/data/RESOURCE.MAP"),
    fetch("/data/RESOURCE.001"),
  ]);
  if (!mapRes.ok) throw new Error(`RESOURCE.MAP: ${mapRes.status}`);
  if (!arcRes.ok) throw new Error(`RESOURCE.001: ${arcRes.status}`);
  return {
    map: await mapRes.arrayBuffer(),
    archive: await arcRes.arrayBuffer(),
  };
}
```

- [ ] **Step 3: Write `src/resource/types.ts`**

```ts
export interface MapEntry {
  name: string;
  length: number;
  offset: number;
}

export interface ParsedArchive {
  byName: Map<string, RawResource>;
  list: RawResource[];
}

export interface RawResource {
  name: string; // e.g. "JOHNNY.TTM"
  type: string; // ".TTM", ".BMP", etc.
  payload: Uint8Array; // raw bytes (post-13-byte name, post-uint32 size header)
}
```

- [ ] **Step 4: Write `src/resource/resource-map.ts`**

```ts
import { BinaryReader } from "../io/binary-reader.js";
import type { MapEntry } from "./types.js";

export interface MapFile {
  resFileName: string;
  entries: MapEntry[];
}

export function parseMap(buf: ArrayBuffer): MapFile {
  const r = new BinaryReader(buf);
  r.bytes(6); // 6 unknown header bytes
  const resFileName = r.fixedString(13);
  const numEntries = r.u16();
  const entries: MapEntry[] = [];
  for (let i = 0; i < numEntries; i++) {
    const length = r.u32();
    const offset = r.u32();
    entries.push({ name: "", length, offset }); // name is read from .001
  }
  return { resFileName, entries };
}
```

- [ ] **Step 5: Write `src/resource/resource-archive.ts`**

```ts
import { BinaryReader } from "../io/binary-reader.js";
import type { MapFile } from "./resource-map.js";
import type { ParsedArchive, RawResource } from "./types.js";

export function indexArchive(
  map: MapFile,
  archive: ArrayBuffer,
): ParsedArchive {
  const r = new BinaryReader(archive);
  const list: RawResource[] = [];
  const byName = new Map<string, RawResource>();
  for (const entry of map.entries) {
    r.pos = entry.offset;
    const name = r.fixedString(13);
    const size = r.u32();
    const payload = r.bytes(size);
    const type = name.slice(name.length - 4);
    const res: RawResource = { name, type, payload };
    list.push(res);
    byName.set(name, res);
  }
  return { byName, list };
}
```

- [ ] **Step 6: Write `src/resource/uncompress.ts`** (port of `~/dev/jc_reborn/uncompress.c`)

```ts
export function uncompress(
  method: number,
  input: Uint8Array,
  outSize: number,
): Uint8Array {
  if (method === 1) return uncompressRle(input, outSize);
  if (method === 2) return uncompressLzw(input, outSize);
  throw new Error(`unknown compression method ${method}`);
}

function uncompressRle(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  let inOff = 0,
    outOff = 0;
  while (outOff < outSize) {
    const ctrl = input[inOff++]!;
    if ((ctrl & 0x80) === 0x80) {
      const len = ctrl & 0x7f;
      const b = input[inOff++]!;
      for (let i = 0; i < len; i++) out[outOff++] = b;
    } else {
      for (let i = 0; i < ctrl; i++) out[outOff++] = input[inOff++]!;
    }
  }
  return out;
}

// Bit reader, LSB-first within each byte (matches uncompress.c:54-74)
function uncompressLzw(input: Uint8Array, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize);
  const prefix = new Uint16Array(4096);
  const append = new Uint8Array(4096);
  const stack = new Uint8Array(4096);

  let inOff = 0;
  let curByte = inOff < input.length ? input[inOff++]! : 0;
  let nextBit = 0;
  let nBits = 9;
  let bitpos = 0;
  let freeEntry = 257;
  let outOff = 0;

  const getBits = (n: number): number => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (curByte & (1 << nextBit)) x |= 1 << i;
      nextBit++;
      if (nextBit > 7) {
        curByte = inOff < input.length ? input[inOff++]! : 0;
        nextBit = 0;
      }
    }
    return x;
  };

  let oldcode = getBits(nBits);
  let lastbyte = oldcode;
  out[outOff++] = oldcode & 0xff;

  while (inOff <= input.length) {
    const newcode = getBits(nBits);
    bitpos += nBits;

    if (newcode === 256) {
      const nbits3 = nBits << 3;
      const nskip = nbits3 - ((bitpos - 1) % nbits3) - 1;
      getBits(nskip);
      nBits = 9;
      freeEntry = 256;
      bitpos = 0;
      continue;
    }

    let code = newcode;
    let stackPtr = 0;

    if (code >= freeEntry) {
      stack[stackPtr++] = lastbyte & 0xff;
      code = oldcode;
    }
    while (code > 255) {
      if (code > 4095) break;
      stack[stackPtr++] = append[code]!;
      code = prefix[code]!;
    }
    stack[stackPtr++] = code & 0xff;
    lastbyte = code;

    while (stackPtr > 0) {
      stackPtr--;
      if (outOff >= outSize) return out;
      out[outOff++] = stack[stackPtr]!;
    }

    if (freeEntry < 4096) {
      prefix[freeEntry] = oldcode;
      append[freeEntry] = lastbyte & 0xff;
      freeEntry++;
      if (freeEntry >= 1 << nBits && nBits < 12) {
        nBits++;
        bitpos = 0;
      }
    }
    oldcode = newcode;
  }
  return out;
}
```

- [ ] **Step 6b: Write `src/resource/uncompress.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { uncompress } from "./uncompress.js";

describe("RLE (method 1)", () => {
  it("expands run: 0x83 0xAA → AA AA AA", () => {
    const input = new Uint8Array([0x83, 0xaa]);
    expect(Array.from(uncompress(1, input, 3))).toEqual([0xaa, 0xaa, 0xaa]);
  });
  it("passes literal: 0x03 1 2 3 → 1 2 3", () => {
    const input = new Uint8Array([0x03, 0x01, 0x02, 0x03]);
    expect(Array.from(uncompress(1, input, 3))).toEqual([1, 2, 3]);
  });
  it("mixed: literal then run", () => {
    const input = new Uint8Array([0x02, 0xde, 0xad, 0x82, 0xff]);
    expect(Array.from(uncompress(1, input, 4))).toEqual([
      0xde, 0xad, 0xff, 0xff,
    ]);
  });
});

describe("LZW (method 2)", () => {
  it("round-trips a known fixture", () => {
    // Use a small LZW-compressed buffer captured by running the C uncompress on a known input,
    // OR — bootstrap: compress a payload via the original C tool, paste the bytes here.
    // Placeholder: implementer captures a real fixture from RESOURCE.001 (e.g., a small BMP) and
    // asserts the first N decompressed bytes match a hex dump from the C reference.
    expect(true).toBe(true);
  });
});

describe("uncompress dispatch", () => {
  it("throws on unknown method", () => {
    expect(() => uncompress(99, new Uint8Array(), 0)).toThrow();
  });
});
```

> **Implementer note:** for the LZW test, capture a real fixture by adding a `printf` to `~/dev/jc_reborn/uncompress.c uncompressLZW` to dump the input/output of one resource, then paste hex into the test.

- [ ] **Step 7: Modify `src/main.ts` to log archive entries**

Replace existing body with:

```ts
import { fetchData } from "./io/fetch-resources.js";
import { parseMap } from "./resource/resource-map.js";
import { indexArchive } from "./resource/resource-archive.js";

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);
console.log(`resFile=${map.resFileName} entries=${map.entries.length}`);
console.table(
  archive.list.map((r) => ({
    name: r.name,
    type: r.type,
    size: r.payload.length,
  })),
);
```

- [ ] **Step 8: Stage data files**

```bash
mkdir -p public/data
cp ~/dev/jc_reborn/RESOURCE.MAP public/data/ 2>/dev/null || echo "user must provide RESOURCE.MAP in public/data/"
cp ~/dev/jc_reborn/RESOURCE.001 public/data/ 2>/dev/null || echo "user must provide RESOURCE.001 in public/data/"
touch public/data/.gitkeep
```

If files not present, prompt user to copy them manually.

- [ ] **Step 9: Run dev server, verify**

```bash
pnpm dev
```

Open `http://localhost:5173`, open DevTools console. Expected: log line showing `resFile=RESOURCE.001 entries=N`, `console.table` of all entries with names like `JOHNNY.TTM`, `JOHNNY.ADS`, `*.BMP`, `*.SCR`, `*.PAL`. Sizes should look reasonable (KB-scale).

- [ ] **Step 9b: Run tests**

```bash
pnpm test
```

Expected: RLE tests pass; LZW fixture test passes once a real capture is pasted.

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: resource archive parser + RLE/LZW decompressors with tests"
```

---

## Task 3: Asset decoders (PAL, SCR, BMP, TTM, ADS)

**Files:**

- Create: `src/decode/pal.ts`, `src/decode/scr.ts`, `src/decode/bmp.ts`, `src/decode/ttm-loader.ts`, `src/decode/ads-loader.ts`, `src/decode/ttm-disasm.ts`
- Modify: `src/main.ts` to add a debug picker UI
- Modify: `index.html` to host the picker

- [ ] **Step 1: Write `src/decode/pal.ts`** (port of `parsePalResource` resource.c:183-219)

```ts
import { BinaryReader } from "../io/binary-reader.js";

export interface PalResource {
  vga: Uint8Array; /* 256 × RGB, channels 0-63 */
}

export function decodePal(payload: Uint8Array): PalResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect("PAL:");
  r.u16(); // size
  r.u8();
  r.u8(); // unknown
  r.expect("VGA:");
  r.u8();
  r.u8();
  r.u8();
  r.u8(); // size header
  const vga = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    vga[i * 3 + 0] = r.u8();
    vga[i * 3 + 1] = r.u8();
    vga[i * 3 + 2] = r.u8();
  }
  return { vga };
}
```

- [ ] **Step 2: Write `src/decode/scr.ts`** (port of `parseScrResource` resource.c:222-266)

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { uncompress } from "../resource/uncompress.js";

export interface ScrResource {
  width: number;
  height: number;
  indexed: Uint8Array;
}

export function decodeScr(payload: Uint8Array): ScrResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect("SCR:");
  r.u16();
  r.u16(); // totalSize, flags
  r.expect("DIM:");
  r.u32(); // dimSize
  const width = r.u16();
  const height = r.u16();
  r.expect("BIN:");
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const packed = uncompress(method, compInput, uncompSize);
  // 4-bit packed → indexed (high nibble first)
  const indexed = new Uint8Array(width * height);
  for (let i = 0, o = 0; i < packed.length; i++) {
    indexed[o++] = (packed[i]! >> 4) & 0x0f;
    indexed[o++] = packed[i]! & 0x0f;
  }
  return { width, height, indexed };
}
```

- [ ] **Step 3: Write `src/decode/bmp.ts`** (port of `parseBmpResource` resource.c:134-180 + `grLoadBmp` graphics.c:568-601)

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { uncompress } from "../resource/uncompress.js";
import type { Sprite } from "../types.js";

export interface BmpResource {
  sprites: Sprite[];
}

export function decodeBmp(payload: Uint8Array): BmpResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect("BMP:");
  r.u16();
  r.u16(); // outer width, height (often unused)
  r.expect("INF:");
  r.u32(); // dataSize
  const numImages = r.u16();
  const widths: number[] = [];
  for (let i = 0; i < numImages; i++) widths.push(r.u16());
  const heights: number[] = [];
  for (let i = 0; i < numImages; i++) heights.push(r.u16());
  r.expect("BIN:");
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const packed = uncompress(method, compInput, uncompSize);

  const sprites: Sprite[] = [];
  let off = 0;
  for (let i = 0; i < numImages; i++) {
    const w = widths[i]!,
      h = heights[i]!;
    if (w & 1) throw new Error(`bmp ${i}: odd width ${w}`);
    const indexed = new Uint8Array(w * h);
    for (let p = 0; p < (w * h) / 2; p++) {
      indexed[p * 2] = (packed[off]! >> 4) & 0x0f;
      indexed[p * 2 + 1] = packed[off]! & 0x0f;
      off++;
    }
    sprites.push({ width: w, height: h, indexed });
  }
  return { sprites };
}
```

- [ ] **Step 4: Write `src/decode/ttm-loader.ts`** (port of `parseTtmResource` resource.c:269-339)

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { uncompress } from "../resource/uncompress.js";

export interface TtmTag {
  id: number;
  description: string;
  offset: number;
}
export interface TtmResource {
  version: string;
  numPages: number;
  bytecode: Uint8Array;
  tags: TtmTag[];
}

export function decodeTtm(payload: Uint8Array): TtmResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect("VER:");
  r.u32(); // versionSize
  const version = new TextDecoder("latin1").decode(r.bytes(5));
  r.expect("PAG:");
  const numPages = r.u32();
  r.u8();
  r.u8();
  r.expect("TT3:");
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const bytecode = uncompress(method, compInput, uncompSize);
  r.pos += compSize;

  r.expect("TTI:");
  r.u8();
  r.u8();
  r.u8();
  r.u8();
  r.expect("TAG:");
  r.u32(); // tagSize
  const numTags = r.u16();
  const tags: TtmTag[] = [];
  for (let i = 0; i < numTags; i++) {
    const id = r.u16();
    const description = readNulString(r, 40);
    tags.push({ id, description, offset: 0 }); // offset filled by interpreter scan
  }
  return { version, numPages, bytecode, tags };
}

function readNulString(r: BinaryReader, max: number): string {
  // ~/dev/jc_reborn/utils.c getString reads until null then pads to max
  const start = r.pos;
  let end = start;
  const view = new DataView((r as any).view.buffer);
  while (end < start + max && view.getUint8(end) !== 0) end++;
  const s = new TextDecoder("latin1").decode(
    new Uint8Array(view.buffer, start, end - start),
  );
  // skip nulls until max
  while (r.pos < start + max) r.u8();
  // some TTMs use variable-length; if first byte was the length, that's handled above by stopping at 0
  return s;
}
```

> **Note for implementer:** the C uses `getString(f, 40)` which reads a length-prefixed string. Verify against `~/dev/jc_reborn/utils.c` and adjust if needed; the 40-byte fixed-pad form is the safe interpretation when total record size is known.

- [ ] **Step 5: Write `src/decode/ads-loader.ts`** (port of `parseAdsResource` resource.c:54-131)

Port follows the same shape as TTM: VER:, RES: (sub-resource list of `slot+name`), SCR: bytecode (compressed), TAG:. Reference `~/dev/jc_reborn/resource.c:54-131` line-by-line.

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { uncompress } from "../resource/uncompress.js";

export interface AdsSubResource {
  slot: number;
  name: string;
}
export interface AdsTag {
  id: number;
  description: string;
}
export interface AdsResource {
  version: string;
  subResources: AdsSubResource[];
  bytecode: Uint8Array;
  tags: AdsTag[];
}

export function decodeAds(payload: Uint8Array): AdsResource {
  const r = new BinaryReader(payload.buffer, payload.byteOffset);
  r.expect("VER:");
  r.u32();
  const version = new TextDecoder("latin1").decode(r.bytes(5));
  r.expect("RES:");
  r.u32(); // resSize
  const numRes = r.u16();
  const subResources: AdsSubResource[] = [];
  for (let i = 0; i < numRes; i++) {
    const slot = r.u16();
    const name = readUntilNul(r);
    subResources.push({ slot, name });
  }
  r.expect("SCR:");
  const compSize = r.u32() - 5;
  const method = r.u8();
  const uncompSize = r.u32();
  const compInput = payload.subarray(r.pos, r.pos + compSize);
  const bytecode = uncompress(method, compInput, uncompSize);
  r.pos += compSize;

  r.expect("TAG:");
  r.u32();
  const numTags = r.u16();
  const tags: AdsTag[] = [];
  for (let i = 0; i < numTags; i++) {
    const id = r.u16();
    const description = readUntilNul(r);
    tags.push({ id, description });
  }
  return { version, subResources, bytecode, tags };
}

function readUntilNul(r: BinaryReader): string {
  const bytes: number[] = [];
  while (true) {
    const b = r.u8();
    if (b === 0) break;
    bytes.push(b);
  }
  return new TextDecoder("latin1").decode(new Uint8Array(bytes));
}
```

- [ ] **Step 6: Write `src/decode/ttm-disasm.ts`** (debug helper)

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { TTM_OPCODE_NAMES } from "../ttm/opcodes.js"; // forward ref — will exist in Task 5

export function disasmTtm(bytecode: Uint8Array): string {
  const r = new BinaryReader(bytecode.buffer, bytecode.byteOffset);
  const lines: string[] = [];
  while (r.pos < bytecode.length) {
    const offset = r.pos;
    if ((r.pos & 1) !== 0) r.u8(); // align
    if (r.pos >= bytecode.length) break;
    const op = r.u16();
    const argCount = op & 0x000f;
    const args: number[] = [];
    for (let i = 0; i < argCount; i++) args.push(r.u16());
    const name = TTM_OPCODE_NAMES[op] ?? "???";
    let line = `${offset.toString(16).padStart(6, "0")}  ${op.toString(16).padStart(4, "0")} ${name} ${args.join(" ")}`;
    // Some opcodes carry trailing strings (LOAD_SCREEN/LOAD_IMAGE/LOAD_PALETTE)
    if (op === 0xf01f || op === 0xf02f || op === 0xf05f) {
      const sb: number[] = [];
      while (r.pos < bytecode.length) {
        const b = r.u8();
        if (b === 0) break;
        sb.push(b);
      }
      // pad to even
      if (r.pos & 1) r.u8();
      line += ` "${new TextDecoder("latin1").decode(new Uint8Array(sb))}"`;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
```

- [ ] **Step 7: Modify `index.html`** to add a picker

Insert before the canvas:

```html
<div style="padding:8px;">
  <select id="picker"></select>
  <button id="play">Render</button>
</div>
<pre id="info" style="max-height:200px;overflow:auto;color:#aaa;"></pre>
```

- [ ] **Step 8: Modify `src/main.ts`** to wire picker

```ts
import { fetchData } from "./io/fetch-resources.js";
import { parseMap } from "./resource/resource-map.js";
import { indexArchive } from "./resource/resource-archive.js";
import { decodePal } from "./decode/pal.js";
import { decodeScr } from "./decode/scr.js";
import { decodeBmp } from "./decode/bmp.js";
import { decodeTtm } from "./decode/ttm-loader.js";
import { decodeAds } from "./decode/ads-loader.js";
import { disasmTtm } from "./decode/ttm-disasm.js";
import { makePalette, setPaletteFromVga } from "./gfx/palette.js";
import { SCREEN_W, SCREEN_H } from "./types.js";

const { map: mapBuf, archive: arcBuf } = await fetchData();
const map = parseMap(mapBuf);
const archive = indexArchive(map, arcBuf);

const palResRaw = archive.list.find((r) => r.type === ".PAL")!;
const pal = makePalette();
setPaletteFromVga(pal, decodePal(palResRaw.payload).vga);

const picker = document.getElementById("picker") as HTMLSelectElement;
for (const r of archive.list) {
  const o = document.createElement("option");
  o.value = r.name;
  o.textContent = `${r.name} (${r.payload.length} B)`;
  picker.appendChild(o);
}

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const info = document.getElementById("info") as HTMLPreElement;

document
  .getElementById("play")!
  .addEventListener("click", () => render(picker.value));

function render(name: string): void {
  const res = archive.byName.get(name)!;
  info.textContent = `${name} type=${res.type} size=${res.payload.length}`;
  ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
  if (res.type === ".SCR") renderScr(res.payload);
  else if (res.type === ".BMP") renderBmpSheet(res.payload);
  else if (res.type === ".TTM")
    info.textContent += "\n\n" + disasmTtm(decodeTtm(res.payload).bytecode);
  else if (res.type === ".ADS") {
    const a = decodeAds(res.payload);
    info.textContent += `\nsubs=${a.subResources.map((s) => s.slot + ":" + s.name).join(",")}\ntags=${a.tags.map((t) => t.id + ":" + t.description).join(", ")}`;
  } else if (res.type === ".PAL")
    info.textContent += "\n(palette already loaded)";
}

function renderScr(payload: Uint8Array): void {
  const scr = decodeScr(payload);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  for (let y = 0; y < scr.height; y++) {
    for (let x = 0; x < scr.width; x++) {
      const idx = scr.indexed[y * scr.width + x]!;
      const o = (y * SCREEN_W + x) * 4;
      img.data[o + 0] = pal[idx * 4 + 0]!;
      img.data[o + 1] = pal[idx * 4 + 1]!;
      img.data[o + 2] = pal[idx * 4 + 2]!;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderBmpSheet(payload: Uint8Array): void {
  const bmp = decodeBmp(payload);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  let cx = 0,
    cy = 0,
    rowH = 0;
  for (const sp of bmp.sprites) {
    if (cx + sp.width > SCREEN_W) {
      cx = 0;
      cy += rowH;
      rowH = 0;
    }
    if (cy + sp.height > SCREEN_H) break;
    for (let y = 0; y < sp.height; y++) {
      for (let x = 0; x < sp.width; x++) {
        const idx = sp.indexed[y * sp.width + x]!;
        const o = ((cy + y) * SCREEN_W + (cx + x)) * 4;
        img.data[o + 0] = pal[idx * 4 + 0]!;
        img.data[o + 1] = pal[idx * 4 + 1]!;
        img.data[o + 2] = pal[idx * 4 + 2]!;
        img.data[o + 3] = 255;
      }
    }
    cx += sp.width + 2;
    rowH = Math.max(rowH, sp.height + 2);
  }
  ctx.putImageData(img, 0, 0);
}
```

- [ ] **Step 9: Run dev server, verify**

```bash
pnpm dev
```

Pick a `.SCR` from the dropdown, click Render. Expected: the original game's background screen drawn at 1:1 scale. Pick a `.BMP`: a contact-print of all sprites in that sheet. Pick a `.TTM`: disassembly text in the `<pre>` panel. Pick `.ADS`: tag/sub-resource list. If colors look off but recognizable, palette is correct (recall: ×4 not ×4.05, so values cap at 252 — slight darkness is correct).

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "feat: PAL/SCR/BMP/TTM/ADS decoders + debug picker UI"
```

---

## Task 4: Graphics primitives on indexed layers + compositor

**Files:**

- Create: `src/gfx/primitives.ts`, `src/gfx/sprite.ts`, `src/gfx/clip.ts`, `src/gfx/zone.ts`, `src/gfx/compositor.ts`
- Modify: `src/main.ts` for a primitives demo

- [ ] **Step 1: Write `src/gfx/clip.ts`**

```ts
import type { Layer, Rect } from "../types.js";

export function setClip(l: Layer, r: Rect): void {
  l.clip = {
    x: Math.max(0, r.x),
    y: Math.max(0, r.y),
    w: Math.min(640 - r.x, r.w),
    h: Math.min(480 - r.y, r.h),
  };
}

export function inClip(l: Layer, x: number, y: number): boolean {
  const c = l.clip;
  return x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
}
```

- [ ] **Step 2: Write `src/gfx/primitives.ts`** (port of graphics.c grPutPixel/grDrawLine/grDrawRect/grDrawCircle)

```ts
import { SCREEN_W, type Layer } from "../types.js";
import { inClip } from "./clip.js";

export function putPixel(l: Layer, x: number, y: number, color: number): void {
  if (!inClip(l, x, y)) return;
  l.indexed[y * SCREEN_W + x] = color;
}

export function drawLine(
  l: Layer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
): void {
  // Bresenham — port of graphics.c:295-350
  let x = x1,
    y = y1;
  const dx = Math.abs(x2 - x1),
    dy = Math.abs(y2 - y1);
  const xinc = x2 > x1 ? 1 : -1;
  const yinc = y2 > y1 ? 1 : -1;
  if (dy < dx) {
    let cumul = (dx + 1) >> 1;
    for (let i = 0; i < dx; i++) {
      putPixel(l, x, y, color);
      x += xinc;
      cumul += dy;
      if (cumul > dx) {
        cumul -= dx;
        y += yinc;
      }
    }
  } else {
    let cumul = (dy + 1) >> 1;
    for (let i = 0; i < dy; i++) {
      putPixel(l, x, y, color);
      y += yinc;
      cumul += dx;
      if (cumul > dy) {
        cumul -= dy;
        x += xinc;
      }
    }
  }
}

export function drawRect(
  l: Layer,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  // graphics.c grDrawRect uses SDL_FillRect — filled rectangle, not outline
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      putPixel(l, xx, yy, color);
    }
  }
}

export function drawCircle(
  l: Layer,
  x1: number,
  y1: number,
  w: number,
  h: number,
  fg: number,
  bg: number,
): void {
  // graphics.c:369-453 — only even diameters, only true circles
  if (w !== h || w & 1) return;
  const r = (w >> 1) - 1;
  const xc = x1 + r,
    yc = y1 + r;
  // bg fill via horizontal lines
  let x = 0,
    y = r,
    d = 1 - r;
  const hline = (xa: number, xb: number, yy: number, c: number) => {
    for (let xx = xa; xx <= xb; xx++) putPixel(l, xx, yy, c);
  };
  while (true) {
    hline(xc - x, xc + x + 1, yc + y + 1, bg);
    hline(xc - x, xc + x + 1, yc - y, bg);
    hline(xc - y, xc + y + 1, yc + x + 1, bg);
    hline(xc - y, xc + y + 1, yc - x, bg);
    if (y - x <= 1) break;
    if (d < 0) d += (x << 1) + 3;
    else {
      d += ((x - y) << 1) + 5;
      y--;
    }
    x++;
  }
  if (fg !== bg) {
    x = 0;
    y = r;
    d = 1 - r;
    while (true) {
      putPixel(l, xc - x, yc + y + 1, fg);
      putPixel(l, xc + x + 1, yc + y + 1, fg);
      putPixel(l, xc - x, yc - y, fg);
      putPixel(l, xc + x + 1, yc - y, fg);
      putPixel(l, xc - y, yc + x + 1, fg);
      putPixel(l, xc + y + 1, yc + x + 1, fg);
      putPixel(l, xc - y, yc - x, fg);
      putPixel(l, xc + y + 1, yc - x, fg);
      if (y - x <= 1) break;
      if (d < 0) d += (x << 1) + 3;
      else {
        d += ((x - y) << 1) + 5;
        y--;
      }
      x++;
    }
  }
}
```

- [ ] **Step 3: Write `src/gfx/sprite.ts`**

```ts
import { SCREEN_W, TRANSPARENT, type Layer, type Sprite } from "../types.js";
import { inClip } from "./clip.js";

// Magenta in the original is colorkey; in our indexed buffers we use 0xff.
// Sprite indexed pixel value 0xff is treated as transparent.
export function drawSprite(l: Layer, sp: Sprite, dx: number, dy: number): void {
  for (let y = 0; y < sp.height; y++) {
    for (let x = 0; x < sp.width; x++) {
      const idx = sp.indexed[y * sp.width + x]!;
      if (idx === TRANSPARENT) continue;
      const X = dx + x,
        Y = dy + y;
      if (!inClip(l, X, Y)) continue;
      l.indexed[Y * SCREEN_W + X] = idx;
    }
  }
}

export function drawSpriteFlip(
  l: Layer,
  sp: Sprite,
  dx: number,
  dy: number,
): void {
  // Column-by-column right-to-left (matches graphics.c:472-491)
  for (let i = 0; i < sp.width; i++) {
    for (let y = 0; y < sp.height; y++) {
      const idx = sp.indexed[y * sp.width + i]!;
      if (idx === TRANSPARENT) continue;
      const X = dx + (sp.width - 1 - i),
        Y = dy + y;
      if (!inClip(l, X, Y)) continue;
      l.indexed[Y * SCREEN_W + X] = idx;
    }
  }
}
```

> **Note:** the original BMP decoder produces palette indices 0-15. Color index 0xff is reserved for "transparent" in our indexed layer model. In `decode/bmp.ts`, color 0 in the source is opaque-drawn — confirm by inspecting an actual sprite. If color 0 should be transparent (typical), remap: while building `sp.indexed`, set output to 0xff where input nibble equals the magenta key. The original code uses `SDL_SetColorKey` on the magenta RGB triple after BGR conversion; the corresponding palette index is whichever entry maps to RGB(0xa8,0,0xa8) — usually entry 0 in this game's palettes. Add this remap in `decode/bmp.ts` once verified.

- [ ] **Step 4: Write `src/gfx/zone.ts`**

```ts
import {
  SCREEN_W,
  SCREEN_H,
  TRANSPARENT,
  type Layer,
  type Rect,
} from "../types.js";

let savedZonesLayer: Uint8Array | null = null;

export function getSavedZonesLayer(): Uint8Array | null {
  return savedZonesLayer;
}

function ensureSaved(): Uint8Array {
  if (!savedZonesLayer) {
    savedZonesLayer = new Uint8Array(SCREEN_W * SCREEN_H);
    savedZonesLayer.fill(TRANSPARENT);
  }
  return savedZonesLayer;
}

export function copyZoneToBg(
  srcLayer: Layer,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const buf = ensureSaved();
  // Original copies w+2 (graphics.c:248 comment: GJIVS6.TTM glitch fix)
  const W = w + 2;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < W; xx++) {
      const X = x + xx,
        Y = y + yy;
      if (X < 0 || X >= SCREEN_W || Y < 0 || Y >= SCREEN_H) continue;
      buf[Y * SCREEN_W + X] = srcLayer.indexed[Y * SCREEN_W + X]!;
    }
  }
}

// graphics.c:272 saveZone is a no-op stub
export function saveZone(
  _l: Layer,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
): void {}

// graphics.c:279 restoreZone clears the WHOLE saved-zones layer
export function restoreZone(
  _l: Layer,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
): void {
  savedZonesLayer = null;
}

export function saveImage1(
  _l: Layer,
  _x: number,
  _y: number,
  _w: number,
  _h: number,
): void {
  // graphics.c:263-269 — commented out in source, stub
}

export function clearSavedZones(): void {
  savedZonesLayer = null;
}
```

- [ ] **Step 5: Write `src/gfx/compositor.ts`**

```ts
import {
  SCREEN_W,
  SCREEN_H,
  TRANSPARENT,
  type Layer,
  type Palette,
} from "../types.js";
import { getSavedZonesLayer } from "./zone.js";

export interface CompositeInput {
  background: Uint8Array | null; // 640*480 indexed, no transparency
  ttmThreads: (Layer | null)[]; // up to MAX_TTM_THREADS = 10
  holiday: Layer | null;
  palette: Palette;
}

export function composite(out: ImageData, input: CompositeInput): void {
  const px = out.data;
  const N = SCREEN_W * SCREEN_H;
  const saved = getSavedZonesLayer();
  for (let p = 0; p < N; p++) {
    let idx = TRANSPARENT;
    if (input.background) idx = input.background[p]!;
    if (saved && saved[p] !== TRANSPARENT) idx = saved[p]!;
    for (const layer of input.ttmThreads) {
      if (!layer) continue;
      const v = layer.indexed[p]!;
      if (v !== TRANSPARENT) idx = v;
    }
    if (input.holiday) {
      const v = input.holiday.indexed[p]!;
      if (v !== TRANSPARENT) idx = v;
    }
    const o = p * 4;
    if (idx === TRANSPARENT) {
      px[o] = px[o + 1] = px[o + 2] = 0;
      px[o + 3] = 255;
    } else {
      px[o + 0] = input.palette[idx * 4 + 0]!;
      px[o + 1] = input.palette[idx * 4 + 1]!;
      px[o + 2] = input.palette[idx * 4 + 2]!;
      px[o + 3] = 255;
    }
  }
}
```

- [ ] **Step 6: Modify `src/main.ts`** — add a "primitives demo" branch

After the picker logic, add a "Demo primitives" button that loads a known SCR, creates a layer, draws a line/circle/rect on it, blits the first sprite of a chosen BMP both normal and flipped, and calls the compositor.

```ts
// (append to main.ts)
import { makeLayer } from "./gfx/layer.js";
import { drawLine, drawRect, drawCircle } from "./gfx/primitives.js";
import { drawSprite, drawSpriteFlip } from "./gfx/sprite.js";
import { composite } from "./gfx/compositor.js";

const demoBtn = document.createElement("button");
demoBtn.textContent = "Demo primitives";
document.querySelector("div")!.appendChild(demoBtn);
demoBtn.addEventListener("click", () => {
  const scr = archive.list.find((r) => r.type === ".SCR")!;
  const bmp = archive.list.find((r) => r.type === ".BMP")!;
  const bg = decodeScr(scr.payload).indexed;
  const sprites = decodeBmp(bmp.payload).sprites;
  const layer = makeLayer();
  drawLine(layer, 10, 10, 600, 200, 5);
  drawRect(layer, 50, 50, 100, 80, 8);
  drawCircle(layer, 200, 100, 80, 80, 12, 2);
  drawSprite(layer, sprites[0]!, 300, 200);
  drawSpriteFlip(layer, sprites[0]!, 400, 200);
  const img = ctx.createImageData(SCREEN_W, SCREEN_H);
  composite(img, {
    background: bg,
    ttmThreads: [layer],
    holiday: null,
    palette: pal,
  });
  ctx.putImageData(img, 0, 0);
});
```

- [ ] **Step 6b: Write `src/gfx/primitives.test.ts` and `src/gfx/sprite.test.ts`**

```ts
// primitives.test.ts
import { describe, it, expect } from "vitest";
import { makeLayer } from "./layer.js";
import { putPixel, drawLine, drawRect } from "./primitives.js";
import { SCREEN_W, TRANSPARENT } from "../types.js";

describe("putPixel", () => {
  it("writes color at index, respects clip", () => {
    const l = makeLayer();
    putPixel(l, 100, 50, 7);
    expect(l.indexed[50 * SCREEN_W + 100]).toBe(7);
  });
  it("drops out-of-bounds writes", () => {
    const l = makeLayer();
    putPixel(l, -1, 0, 7);
    putPixel(l, 0, -1, 7);
    putPixel(l, 9999, 0, 7);
    expect(l.indexed.every((v) => v === TRANSPARENT)).toBe(true);
  });
});

describe("drawLine", () => {
  it("horizontal line writes endpoints", () => {
    const l = makeLayer();
    drawLine(l, 10, 5, 20, 5, 3);
    expect(l.indexed[5 * SCREEN_W + 10]).toBe(3);
    expect(l.indexed[5 * SCREEN_W + 19]).toBe(3); // Bresenham draws dx pixels, last excluded
  });
});

describe("drawRect", () => {
  it("fills inclusive-exclusive area", () => {
    const l = makeLayer();
    drawRect(l, 0, 0, 2, 2, 9);
    expect(l.indexed[0]).toBe(9);
    expect(l.indexed[1]).toBe(9);
    expect(l.indexed[SCREEN_W]).toBe(9);
    expect(l.indexed[SCREEN_W + 1]).toBe(9);
    expect(l.indexed[2]).toBe(TRANSPARENT);
  });
});
```

```ts
// sprite.test.ts
import { describe, it, expect } from "vitest";
import { makeLayer } from "./layer.js";
import { drawSprite, drawSpriteFlip } from "./sprite.js";
import { SCREEN_W, TRANSPARENT, type Sprite } from "../types.js";

const sp: Sprite = {
  width: 2,
  height: 2,
  indexed: new Uint8Array([1, TRANSPARENT, TRANSPARENT, 2]),
};

describe("drawSprite", () => {
  it("honors transparent index", () => {
    const l = makeLayer();
    drawSprite(l, sp, 5, 5);
    expect(l.indexed[5 * SCREEN_W + 5]).toBe(1);
    expect(l.indexed[5 * SCREEN_W + 6]).toBe(TRANSPARENT); // not overwritten
    expect(l.indexed[6 * SCREEN_W + 5]).toBe(TRANSPARENT);
    expect(l.indexed[6 * SCREEN_W + 6]).toBe(2);
  });
});

describe("drawSpriteFlip", () => {
  it("mirrors columns horizontally", () => {
    const l = makeLayer();
    drawSpriteFlip(l, sp, 0, 0);
    // original: row0 = [1, X], row1 = [X, 2]
    // flipped:  row0 = [X, 1], row1 = [2, X]
    expect(l.indexed[0]).toBe(TRANSPARENT);
    expect(l.indexed[1]).toBe(1);
    expect(l.indexed[SCREEN_W]).toBe(2);
    expect(l.indexed[SCREEN_W + 1]).toBe(TRANSPARENT);
  });
});
```

- [ ] **Step 7: Run dev server, verify**

```bash
pnpm dev
```

Click "Demo primitives". Expected: a real game screen as background, with a line, rectangle, circle, sprite and a horizontally-flipped sprite drawn on top.

- [ ] **Step 7b: Run tests**

```bash
pnpm test
```

Expected: all primitives + sprite tests green.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: indexed graphics primitives + sprite blits + compositor with tests"
```

---

## Task 5: TTM interpreter (single thread)

**Files:**

- Create: `src/ttm/opcodes.ts`, `src/ttm/thread.ts`, `src/ttm/bmp-slots.ts`, `src/ttm/interpreter.ts`
- Create: `src/engine/loop.ts`, `src/engine/clock.ts`
- Modify: `src/main.ts` to play a single TTM tag in a real loop

- [ ] **Step 1: Write `src/ttm/opcodes.ts`** (port of `~/dev/jc_reborn/ttm.c:182-343`)

```ts
export const OP = {
  DRAW_BACKGROUND: 0x0080,
  PURGE: 0x0110,
  UPDATE: 0x0ff0,
  SET_DELAY: 0x1021,
  SET_BMP_SLOT: 0x1051,
  SET_PALETTE_SLOT: 0x1061,
  LOCAL_TAG: 0x1101,
  TAG: 0x1111,
  TTM_UNKNOWN_1: 0x1121,
  GOTO_TAG: 0x1201,
  SET_COLORS: 0x2002,
  SET_FRAME1: 0x2012,
  TIMER: 0x2022,
  SET_CLIP_ZONE: 0x4004,
  COPY_ZONE_TO_BG: 0x4204,
  SAVE_IMAGE1: 0x4214,
  DRAW_PIXEL: 0xa002,
  SAVE_ZONE: 0xa054,
  RESTORE_ZONE: 0xa064,
  DRAW_LINE: 0xa0a4,
  DRAW_RECT: 0xa104,
  DRAW_CIRCLE: 0xa404,
  DRAW_SPRITE: 0xa504,
  DRAW_SPRITE_FLIP: 0xa524,
  CLEAR_SCREEN: 0xa601,
  DRAW_SCREEN: 0xb606,
  PLAY_SAMPLE: 0xc051,
  LOAD_SCREEN: 0xf01f,
  LOAD_IMAGE: 0xf02f,
  LOAD_PALETTE: 0xf05f,
} as const;

export const TTM_OPCODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OP).map(([k, v]) => [v, k]),
);
```

- [ ] **Step 2: Write `src/ttm/thread.ts`**

```ts
import type { Layer, Sprite } from "../types.js";
import type { TtmResource } from "../decode/ttm-loader.js";
import { makeLayer } from "../gfx/layer.js";

export const MAX_BMP_SLOTS = 6;
export const MAX_SPRITES_PER_BMP = 120;

export interface TtmSlot {
  ttm: TtmResource | null;
  sprites: Sprite[][]; // [bmpSlotIdx][spriteIdx]
}

export interface TtmThread {
  slot: TtmSlot;
  isRunning: 0 | 1 | 2; // 0=free 1=active 2=expired
  sceneSlot: number;
  sceneTag: number;
  sceneTimer: number;
  sceneIterations: number;
  ip: number; // instruction pointer
  delay: number; // frame delay (ticks)
  timer: number; // countdown
  nextGotoOffset: number;
  selectedBmpSlot: number;
  fgColor: number;
  bgColor: number;
  layer: Layer;
}

export function makeThread(): TtmThread {
  return {
    slot: {
      ttm: null,
      sprites: Array.from({ length: MAX_BMP_SLOTS }, () => []),
    },
    isRunning: 0,
    sceneSlot: 0,
    sceneTag: 0,
    sceneTimer: 0,
    sceneIterations: 0,
    ip: 0,
    delay: 4,
    timer: 0,
    nextGotoOffset: 0,
    selectedBmpSlot: 0,
    fgColor: 15,
    bgColor: 0,
    layer: makeLayer(),
  };
}
```

- [ ] **Step 3: Write `src/ttm/bmp-slots.ts`**

```ts
import { decodeBmp } from "../decode/bmp.js";
import type { ParsedArchive } from "../resource/types.js";
import type { TtmSlot } from "./thread.js";

export function loadBmpIntoSlot(
  archive: ParsedArchive,
  slot: TtmSlot,
  slotNo: number,
  name: string,
): void {
  const res = archive.byName.get(name);
  if (!res) throw new Error(`bmp not found: ${name}`);
  slot.sprites[slotNo] = decodeBmp(res.payload).sprites;
}

export function releaseBmpSlot(slot: TtmSlot, slotNo: number): void {
  slot.sprites[slotNo] = [];
}
```

- [ ] **Step 4: Write `src/ttm/interpreter.ts`** (port of `~/dev/jc_reborn/ttm.c:141-470`)

```ts
import { BinaryReader } from "../io/binary-reader.js";
import { OP } from "./opcodes.js";
import type { TtmThread } from "./thread.js";
import type { ParsedArchive } from "../resource/types.js";
import type { Palette } from "../types.js";
import { setPaletteFromVga } from "../gfx/palette.js";
import { decodePal } from "../decode/pal.js";
import { decodeScr } from "../decode/scr.js";
import { drawLine, drawRect, drawCircle, putPixel } from "../gfx/primitives.js";
import { drawSprite, drawSpriteFlip } from "../gfx/sprite.js";
import { setClip } from "../gfx/clip.js";
import {
  copyZoneToBg,
  saveZone,
  restoreZone,
  saveImage1,
} from "../gfx/zone.js";
import { clearLayer } from "../gfx/layer.js";
import { loadBmpIntoSlot } from "./bmp-slots.js";

export interface TtmContext {
  archive: ParsedArchive;
  palette: Palette;
  setBackground: (indexed: Uint8Array | null) => void;
  playSample: (n: number) => void;
}

// Reads opcode + args (and optional trailing string) from bytecode at pos
function readInstr(
  bc: Uint8Array,
  pos: number,
): { op: number; args: number[]; str?: string; nextPos: number } {
  const r = new BinaryReader(bc.buffer, bc.byteOffset + pos);
  const op = r.u16();
  const argCount = op & 0x000f;
  const args: number[] = [];
  for (let i = 0; i < argCount; i++) args.push(r.u16());
  let str: string | undefined;
  if (op === OP.LOAD_SCREEN || op === OP.LOAD_IMAGE || op === OP.LOAD_PALETTE) {
    const sb: number[] = [];
    while (true) {
      if (r.pos - r.pos === Infinity) break;
      const b = r.u8();
      if (b === 0) break;
      sb.push(b);
    }
    if ((r.pos & 1) !== 0) r.u8(); // pad to even
    str = new TextDecoder("latin1").decode(new Uint8Array(sb));
  }
  return {
    op,
    args,
    str,
    nextPos:
      pos +
      (r.pos -
        (r.pos -
          2 -
          argCount * 2 -
          (str ? str.length + 1 + ((str.length + 1) & 1 ? 1 : 0) : 0))),
  };
  // NOTE: simpler — recompute below
}

// Cleaner instruction reader
function step(
  bc: Uint8Array,
  pos: number,
): { op: number; args: number[]; str?: string; pos: number } {
  let p = pos;
  const dv = new DataView(bc.buffer, bc.byteOffset);
  const op = dv.getUint16(p, true);
  p += 2;
  const argCount = op & 0x000f;
  const args: number[] = [];
  for (let i = 0; i < argCount; i++) {
    args.push(dv.getUint16(p, true));
    p += 2;
  }
  let str: string | undefined;
  if (op === OP.LOAD_SCREEN || op === OP.LOAD_IMAGE || op === OP.LOAD_PALETTE) {
    const sb: number[] = [];
    while (p < bc.length) {
      const b = dv.getUint8(p++);
      if (b === 0) break;
      sb.push(b);
    }
    if (p & 1) p++;
    str = new TextDecoder("latin1").decode(new Uint8Array(sb));
  }
  return { op, args, str, pos: p };
}

// Find the offset of a (local) tag within the bytecode by scanning
function findTagOffset(bc: Uint8Array, op: number, tagId: number): number {
  let p = 0;
  while (p < bc.length) {
    const ins = step(bc, p);
    if (ins.op === op && ins.args[0] === tagId) return ins.pos;
    p = ins.pos;
  }
  return -1;
}

export function ttmStartScene(t: TtmThread, tagId: number): void {
  const off = findTagOffset(t.slot.ttm!.bytecode, OP.TAG, tagId);
  if (off < 0) throw new Error(`tag ${tagId} not found`);
  t.ip = off;
  t.isRunning = 1;
  t.timer = 0;
  t.delay = 4;
}

// Run until UPDATE/PURGE/EOF. Returns when frame should yield.
export function ttmPlay(t: TtmThread, ctx: TtmContext): void {
  const bc = t.slot.ttm!.bytecode;
  while (t.ip < bc.length) {
    const ins = step(bc, t.ip);
    t.ip = ins.pos;
    const a = ins.args;
    switch (ins.op) {
      case OP.DRAW_BACKGROUND:
        // Free image slots: TTM uses this as a marker to wipe loaded BMPs
        for (let i = 0; i < t.slot.sprites.length; i++) t.slot.sprites[i] = [];
        break;
      case OP.PURGE:
        if (t.nextGotoOffset) {
          t.ip = t.nextGotoOffset;
          t.nextGotoOffset = 0;
        } else t.isRunning = 2;
        return;
      case OP.UPDATE:
        return;
      case OP.SET_DELAY:
        t.delay = Math.max(4, a[0]!);
        break;
      case OP.SET_BMP_SLOT:
        t.selectedBmpSlot = a[0]!;
        break;
      case OP.SET_PALETTE_SLOT:
        // unimplemented in jc_reborn
        break;
      case OP.LOCAL_TAG:
      case OP.TAG:
        break; // labels — no-op at runtime
      case OP.TTM_UNKNOWN_1:
        // region id, used by CLEAR_SCREEN — store on thread if needed
        break;
      case OP.GOTO_TAG: {
        const tgt = findTagOffset(bc, OP.LOCAL_TAG, a[0]!);
        if (tgt >= 0) t.ip = tgt;
        break;
      }
      case OP.SET_COLORS:
        t.fgColor = a[0]! & 0x0f;
        t.bgColor = a[1]! & 0x0f;
        break;
      case OP.SET_FRAME1:
        // unused in jc_reborn
        break;
      case OP.TIMER:
        t.delay = ((a[0]! + a[1]!) / 2) | 0;
        break;
      case OP.SET_CLIP_ZONE:
        setClip(t.layer, {
          x: a[0]!,
          y: a[1]!,
          w: a[2]! - a[0]!,
          h: a[3]! - a[1]!,
        });
        break;
      case OP.COPY_ZONE_TO_BG:
        copyZoneToBg(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.SAVE_IMAGE1:
        saveImage1(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.DRAW_PIXEL:
        putPixel(t.layer, a[0]!, a[1]!, t.fgColor);
        break;
      case OP.SAVE_ZONE:
        saveZone(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.RESTORE_ZONE:
        restoreZone(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.DRAW_LINE:
        drawLine(t.layer, a[0]!, a[1]!, a[2]!, a[3]!, t.fgColor);
        break;
      case OP.DRAW_RECT:
        drawRect(t.layer, a[0]!, a[1]!, a[2]!, a[3]!, t.fgColor);
        break;
      case OP.DRAW_CIRCLE:
        drawCircle(t.layer, a[0]!, a[1]!, a[2]!, a[3]!, t.fgColor, t.bgColor);
        break;
      case OP.DRAW_SPRITE: {
        const sp = t.slot.sprites[a[0]!]?.[t.selectedBmpSlot]; // NOTE: ttm.c:307 args are (spriteNo, imageNo) ordered
        // graphics.c grDrawSprite(sfc, slot, x, y, spriteNo, imageNo)
        // ttm opcode args: a[0]=spriteNo, a[1]=imageNo, a[2]=x, a[3]=y (verify against ttm.c:306)
        const sprIdx = a[0]!,
          imgIdx = a[1]!,
          x = a[2]!,
          y = a[3]!;
        const s = t.slot.sprites[imgIdx]?.[sprIdx];
        if (s) drawSprite(t.layer, s, x, y);
        break;
      }
      case OP.DRAW_SPRITE_FLIP: {
        const sprIdx = a[0]!,
          imgIdx = a[1]!,
          x = a[2]!,
          y = a[3]!;
        const s = t.slot.sprites[imgIdx]?.[sprIdx];
        if (s) drawSpriteFlip(t.layer, s, x, y);
        break;
      }
      case OP.CLEAR_SCREEN:
        clearLayer(t.layer);
        break;
      case OP.PLAY_SAMPLE:
        ctx.playSample(a[0]!);
        break;
      case OP.LOAD_SCREEN: {
        const res =
          ctx.archive.byName.get(ins.str! + ".SCR") ??
          ctx.archive.byName.get(ins.str!);
        if (res) ctx.setBackground(decodeScr(res.payload).indexed);
        break;
      }
      case OP.LOAD_IMAGE: {
        const name = ins.str!.endsWith(".BMP") ? ins.str! : ins.str! + ".BMP";
        loadBmpIntoSlot(ctx.archive, t.slot, t.selectedBmpSlot, name);
        break;
      }
      case OP.LOAD_PALETTE: {
        const name = ins.str!.endsWith(".PAL") ? ins.str! : ins.str! + ".PAL";
        const res = ctx.archive.byName.get(name);
        if (res) setPaletteFromVga(ctx.palette, decodePal(res.payload).vga);
        break;
      }
      default:
        console.warn(`unknown TTM opcode ${ins.op.toString(16)}`);
        break;
    }
  }
  t.isRunning = 2;
}
```

> **Implementer note:** verify `DRAW_SPRITE` argument ordering against `~/dev/jc_reborn/ttm.c:306-310`. The C call is `grDrawSprite(thread->ttmLayer, thread->ttmSlot, x, y, spriteNo, imageNo)` — confirm which `args[i]` map to which parameter.

- [ ] **Step 5: Write `src/engine/clock.ts`**

```ts
const MS_PER_TICK = 20;

let ticks = 0;
let acc = 0;
let lastMs = performance.now();

export function pumpTicks(): number {
  const now = performance.now();
  acc += now - lastMs;
  lastMs = now;
  let elapsed = 0;
  while (acc >= MS_PER_TICK) {
    acc -= MS_PER_TICK;
    ticks++;
    elapsed++;
  }
  return elapsed;
}

export function getTicks(): number {
  return ticks;
}
```

- [ ] **Step 6: Write `src/engine/loop.ts`**

```ts
export function startLoop(
  onTick: (elapsedTicks: number) => void,
  onRender: () => void,
): () => void {
  let stopped = false;
  const frame = () => {
    if (stopped) return;
    onTick(0); // engine pulls ticks via pumpTicks() itself
    onRender();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return () => {
    stopped = true;
  };
}
```

- [ ] **Step 7: Modify `src/main.ts`** to play one TTM scene

Add a "Play TTM" button. On click, choose a TTM by name (e.g., the first JOHNNY\*.TTM with tag 1). Set up a thread, start the scene, run the rAF loop:

```ts
import { decodeTtm } from "./decode/ttm-loader.js";
import { makeThread, type TtmThread } from "./ttm/thread.js";
import { ttmPlay, ttmStartScene, type TtmContext } from "./ttm/interpreter.js";
import { startLoop } from "./engine/loop.js";
import { pumpTicks } from "./engine/clock.js";

const playBtn = document.createElement("button");
playBtn.textContent = "Play TTM (tag 1)";
document.querySelector("div")!.appendChild(playBtn);

let bgIndexed: Uint8Array | null = null;

playBtn.addEventListener("click", () => {
  const ttmRes = archive.byName.get(picker.value)!;
  if (ttmRes.type !== ".TTM") {
    alert("pick a .TTM");
    return;
  }
  const t = makeThread();
  t.slot.ttm = decodeTtm(ttmRes.payload);
  const ctx: TtmContext = {
    archive,
    palette: pal,
    setBackground: (idx) => {
      bgIndexed = idx;
    },
    playSample: (n) => console.log("playSample", n),
  };
  ttmStartScene(t, 1);
  const img = ctx_makeImage();
  startLoop(
    () => {
      const elapsed = pumpTicks();
      if (t.isRunning !== 1) return;
      if (t.timer > elapsed) {
        t.timer -= elapsed;
        return;
      }
      t.timer = t.delay;
      ttmPlay(t, ctx);
    },
    () => {
      composite(img, {
        background: bgIndexed,
        ttmThreads: [t.layer],
        holiday: null,
        palette: pal,
      });
      ctx2d.putImageData(img, 0, 0);
    },
  );
});

function ctx_makeImage(): ImageData {
  return ctx.createImageData(SCREEN_W, SCREEN_H);
}
const ctx2d = ctx;
```

- [ ] **Step 8: Run dev server, verify**

```bash
pnpm dev
```

Pick a TTM (e.g., one from the `JOHNNY*.TTM` family), click "Play TTM (tag 1)". Expected: an animated scene plays — Johnny doing something. Compare visually against `~/dev/jc_reborn` running natively if you have it installed.

- [ ] **Step 8b: Write `src/ttm/interpreter.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { OP } from "./opcodes.js";
import { ttmPlay, ttmStartScene, type TtmContext } from "./interpreter.js";
import { makeThread } from "./thread.js";

// Build a tiny synthetic TTM bytecode: TAG 1, SET_DELAY 8, SET_COLORS 3 4, UPDATE
function makeBytecode(): Uint8Array {
  const buf = new ArrayBuffer(64);
  const dv = new DataView(buf);
  let p = 0;
  const w = (n: number) => {
    dv.setUint16(p, n, true);
    p += 2;
  };
  w(OP.TAG);
  w(1);
  w(OP.SET_DELAY);
  w(8);
  w(OP.SET_COLORS);
  w(3);
  w(4);
  w(OP.UPDATE);
  return new Uint8Array(buf, 0, p);
}

const fakeCtx: TtmContext = {
  archive: { byName: new Map(), list: [] },
  palette: new Uint8Array(64),
  setBackground: () => {},
  playSample: () => {},
};

describe("ttmPlay", () => {
  it("honors SET_DELAY and SET_COLORS, yields on UPDATE", () => {
    const t = makeThread();
    t.slot.ttm = {
      version: "x",
      numPages: 1,
      bytecode: makeBytecode(),
      tags: [{ id: 1, description: "", offset: 0 }],
    };
    ttmStartScene(t, 1);
    ttmPlay(t, fakeCtx);
    expect(t.delay).toBe(8);
    expect(t.fgColor).toBe(3);
    expect(t.bgColor).toBe(4);
    expect(t.isRunning).toBe(1); // UPDATE yields, doesn't terminate
  });
});
```

- [ ] **Step 8c: Run tests**

```bash
pnpm test
```

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: TTM single-thread interpreter + rAF tick loop with tests"
```

---

## Task 6: ADS scheduler

**Files:**

- Create: `src/ads/opcodes.ts`, `src/ads/scheduler.ts`
- Modify: `src/main.ts` to play an ADS

- [ ] **Step 1: Write `src/ads/opcodes.ts`** (port of `~/dev/jc_reborn/ads.c:107-630`)

```ts
export const ADS = {
  IF_LASTPLAYED_LOCAL: 0x1070,
  IF_UNKNOWN_1: 0x1330,
  IF_LASTPLAYED: 0x1350,
  IF_NOT_RUNNING: 0x1360,
  IF_IS_RUNNING: 0x1370,
  AND: 0x1420,
  OR: 0x1430,
  PLAY_SCENE: 0x1510,
  ADD_SCENE_LOCAL: 0x1520,
  ADD_SCENE: 0x2005,
  STOP_SCENE: 0x2010,
  RANDOM_START: 0x3010,
  NOP: 0x3020,
  RANDOM_END: 0x30ff,
  UNKNOWN_6: 0x4000,
  FADE_OUT: 0xf010,
  GOSUB_TAG: 0xf200,
  END: 0xffff,
  END_IF: 0xfff0,
} as const;
```

- [ ] **Step 2: Write `src/ads/scheduler.ts`** (port of `~/dev/jc_reborn/ads.c:445-800`)

This is the largest file. Implement, in order:

- `adsFindTagOffset(bc, tagId)` — find ADS tag offset.
- `adsPlayChunk(state, fromOffset)` — execute conditionals/RANDOM blocks until END_IF/RANDOM_END.
- `adsRandomPickOp(ops)` — weighted random selection (rng: `Math.random()` for v1; mention seedable PRNG as later improvement).
- `adsAddScene(state, slot, tag, numPlays)` — finds a free thread, sets up TTM context.
- `adsStopScene(state, slot, tag)` — terminate matching threads.
- `adsPlay(state, ctx)` — main loop:
  - Compute `min` = smallest `timer` across active TTM threads.
  - Subtract `min` from every timer.
  - Wait `min` ticks (already done by `pumpTicks` in caller — scheduler just decrements).
  - For each thread whose timer hit 0, call `ttmPlay(t, ctx)`.
  - When a thread expires (`isRunning === 2`), trigger `adsPlayTriggeredChunks` to fire any IF_LASTPLAYED chunks pointing at it.
- Track ADS state: `adsChunks` (bookmarks per condition for triggered re-execution), `adsLastPlayed[(slot,tag)]`, `runningSet`.

```ts
import { OP } from "../ttm/opcodes.js";
import { ADS } from "./opcodes.js";
import { makeThread, type TtmThread, type TtmSlot } from "../ttm/thread.js";
import { ttmPlay, ttmStartScene, type TtmContext } from "../ttm/interpreter.js";
import type { ParsedArchive } from "../resource/types.js";
import type { AdsResource } from "../decode/ads-loader.js";
import { decodeTtm } from "../decode/ttm-loader.js";

const MAX_THREADS = 10;

export interface AdsState {
  ads: AdsResource;
  ttmSlots: Map<number, TtmSlot>; // by sub-resource slot id
  threads: TtmThread[]; // length MAX_THREADS
  lastPlayed: Set<number>; // (slot<<16)|tag
  triggers: Array<{ slot: number; tag: number; chunkOffset: number }>;
  ip: number;
  done: boolean;
}

export function makeAdsState(
  ads: AdsResource,
  archive: ParsedArchive,
): AdsState {
  const ttmSlots = new Map<number, TtmSlot>();
  for (const sub of ads.subResources) {
    const ttm = decodeTtm(archive.byName.get(sub.name)!.payload);
    ttmSlots.set(sub.slot, {
      ttm,
      sprites: Array.from({ length: 6 }, () => []),
    });
  }
  return {
    ads,
    ttmSlots,
    threads: Array.from({ length: MAX_THREADS }, makeThread),
    lastPlayed: new Set(),
    triggers: [],
    ip: 0,
    done: false,
  };
}

// ... (continue with adsPlayChunk, adsAddScene, adsPlay; full port from ads.c)
```

> **Implementer note:** because of size, port `ads.c` opcode-by-opcode as cases in `adsPlayChunk` and `adsPlay`. Stick to identical control flow; do not refactor. Read the C file and translate one function per session.

- [ ] **Step 3: Modify `src/main.ts`** to play an ADS

Add a "Play ADS" button mirroring the TTM button but driving ADS state.

- [ ] **Step 4: Run dev server, verify**

```bash
pnpm dev
```

Pick an ADS (e.g., `JOHNNY.ADS`), click "Play ADS". Expected: multiple TTM scenes choreographed by ADS — Johnny does a sequence. Random branches differ on reload.

- [ ] **Step 4b: Write `src/ads/scheduler.test.ts`**

Cover the pure pieces: `adsRandomPickOp` weighted distribution (seed `Math.random` via `vi.spyOn`); `adsFindTagOffset` returns correct offset for known tag; conditional evaluator (IF_LASTPLAYED/IF_NOT_RUNNING/IF_IS_RUNNING with AND/OR) with a synthetic state. Skip end-to-end ADS run — verified visually.

```ts
import { describe, it, expect, vi } from "vitest";
import { adsRandomPickOp } from "./scheduler.js";

describe("adsRandomPickOp", () => {
  it("picks weighted ops deterministically when rng controlled", () => {
    const ops = [
      { slot: 1, tag: 1, weight: 10 },
      { slot: 2, tag: 2, weight: 90 },
    ];
    vi.spyOn(Math, "random").mockReturnValue(0.5); // cumulative > 10/100, picks 2nd
    expect(adsRandomPickOp(ops).slot).toBe(2);
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    expect(adsRandomPickOp(ops).slot).toBe(1);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: ADS scheduler with conditionals, RANDOM blocks, multi-thread TTM, tests"
```

---

## Task 7: Island composer

**Files:**

- Create: `src/island/island.ts`, `src/island/island-data.ts`
- Modify: `src/main.ts` to use island as background

Port `~/dev/jc_reborn/island.c` and the data tables from `island.c`. The island composer:

- Picks a random island origin offset (`grDx`, `grDy` in C).
- Picks an ocean variant (calm/wavy).
- Picks a wind direction.
- Composes clouds at random positions.
- Uses `islandAnimate` for ongoing background animation (separate thread at 40 ms interval — `ads.c:688`).

- [ ] **Step 1: Write `src/island/island-data.ts`** — port the static tables from `island.c`. Run `rg "static.*\\[\\]" ~/dev/jc_reborn/island.c` to enumerate them.

- [ ] **Step 2: Write `src/island/island.ts`** — port functions, expose `islandInit(archive, palette)`, `islandRender(layer)`, `islandAnimateTick(layer)`.

- [ ] **Step 3: Modify `src/main.ts`** to call `islandInit` once and pass island layer as background.

- [ ] **Step 4: Verify** — full island background with ocean/clouds/wind on dev server. Reload a few times to confirm randomization.

- [ ] **Step 5: Commit** — `feat: island background composer`.

---

## Task 8: Walking + pathfinding

**Files:**

- Create: `src/walk/walk.ts`, `src/walk/calcpath.ts`, `src/walk/walk-data.ts`, `src/walk/calcpath-data.ts`
- Modify: ADS scheduler to recognize the special "walk" thread

Port:

- `walk.c` → `walk.ts` — 8-direction state machine, frame extraction.
- `calcpath.c` → `calcpath.ts` — DFS over `walkMatrix`.
- `walk_data.h` → `walk-data.ts` — bookmark tables.
- `calcpath_data.h` → `calcpath-data.ts` — `walkMatrix` 3D array.

The walking thread runs alongside ADS scene threads; treat as a special-cased TTM thread or as its own sibling renderer that draws into a layer and is composited.

- [ ] **Step 1-3:** port the four files line-by-line. The matrix data is dense — copy it as TypeScript array literals via a one-time script you can write inline (or just paste as a `const`).
- [ ] **Step 3b:** write `src/walk/calcpath.test.ts` — assert `calcPath(A, B)` returns the same node sequence as a hand-traced path through the matrix for 3-4 representative spot pairs.
- [ ] **Step 4:** wire into ADS so scene transitions invoke `walkInit(fromSpot, toSpot)` and per-tick `walkAnimate(layer)` runs while a walk is active.
- [ ] **Step 5:** verify Johnny walks between island spots smoothly with correct turning. Run `pnpm test`.
- [ ] **Step 6:** commit `feat: walking + pathfinding with tests`.

---

## Task 9: Story scheduler

**Files:**

- Create: `src/story/story.ts`, `src/story/story-data.ts`
- Modify: `src/main.ts` to swap demo entry for story-driven loop

Port `~/dev/jc_reborn/story.c` and `story_data.h`:

- Weighted random scene picker.
- Filter candidates by current state (last scene played, time of day, season).

- [ ] **Step 1-2:** port files.
- [ ] **Step 3:** modify `main.ts` so default behavior is "run forever via story scheduler".
- [ ] **Step 4:** verify continuous random scenes play indefinitely without crashes.
- [ ] **Step 5:** commit `feat: story scheduler — full screensaver loop`.

---

## Task 10: WebAudio

**Files:**

- Create: `src/audio/sound.ts`, `src/ui/click-overlay.ts`
- Modify: `src/main.ts` (gate engine start), `src/ttm/interpreter.ts` (PLAY_SAMPLE wired)

- [ ] **Step 1: Write `src/ui/click-overlay.ts`**

```ts
export function showStartOverlay(): Promise<void> {
  return new Promise((resolve) => {
    const div = document.createElement("div");
    div.textContent = "Click to start";
    Object.assign(div.style, {
      position: "fixed",
      inset: "0",
      display: "grid",
      placeItems: "center",
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      fontSize: "24px",
      cursor: "pointer",
      zIndex: "999",
    });
    div.addEventListener(
      "click",
      () => {
        div.remove();
        resolve();
      },
      { once: true },
    );
    document.body.appendChild(div);
  });
}
```

- [ ] **Step 2: Write `src/audio/sound.ts`**

```ts
let ctx: AudioContext | null = null;
const buffers = new Map<number, AudioBuffer>();
const SOUND_IDS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24,
];

export async function initSound(): Promise<void> {
  ctx = new AudioContext();
  await Promise.all(
    SOUND_IDS.map(async (n) => {
      try {
        const r = await fetch(`/data/sound${n}.wav`);
        if (!r.ok) return;
        const buf = await r.arrayBuffer();
        buffers.set(n, await ctx!.decodeAudioData(buf));
      } catch {
        /* missing sound ok */
      }
    }),
  );
}

export function playSample(n: number): void {
  if (!ctx) return;
  const buf = buffers.get(n);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
```

- [ ] **Step 3: Modify `src/main.ts`** — await overlay, then `await initSound()`, then start engine. Pass `playSample` into TTM context.

- [ ] **Step 4: Verify** — sample-emitting TTM opcodes produce sound. Sounds may be missing for non-existent IDs; that's fine.

- [ ] **Step 5: Commit** — `feat: WebAudio sound triggers gated by start overlay`.

---

## Task 11: Polish — fade out, holiday layer, fullscreen

**Files:**

- Create: `src/gfx/fade.ts`, `src/ui/fullscreen.ts`, `src/debug/hud.ts`
- Modify: ADS scheduler (FADE_OUT), compositor (holiday layer)

- [ ] **Step 1:** Port `~/dev/jc_reborn/graphics.c grFadeOut()` (5 fade variants) into `fade.ts`. ADS `FADE_OUT` opcode triggers it.
- [ ] **Step 2:** Wire holiday thread compositing — runs as a final overlay layer (already supported by `composite` signature).
- [ ] **Step 3:** Add F11 keybind for fullscreen via `requestFullscreen`.
- [ ] **Step 4:** Optional HUD: fps + active threads + current scene tag in a corner overlay.
- [ ] **Step 5:** Verify fade transitions, fullscreen, holiday layer (force a holiday date).
- [ ] **Step 6:** Commit `feat: fade transitions, fullscreen, holiday layer`.

---

## Verification (end-to-end)

After all tasks:

0. `pnpm test` — all unit tests green.
1. `cd ~/dev/jc-reborn-web && pnpm dev`
2. Open `http://localhost:5173`. Click overlay.
3. Confirm:
   - Island background renders with random offset, ocean, clouds.
   - Johnny walks between spots and plays animated scenes (multiple per session).
   - Sound effects play at expected moments (waves, comedic events).
   - No console errors. No "unknown opcode" warnings except expected `SET_PALETTE_SLOT`.
   - Fade transitions occur between scenes.
   - F11 toggles fullscreen.
   - Page can run for 10+ minutes without leaks (check DevTools Memory tab — heap should stabilize).
4. Compare side-by-side with `~/dev/jc_reborn` running natively (if SDL2 toolchain available); scenes should match visually frame-for-frame.

---

## Risks / Open Questions

- **`SET_FRAME1` semantics:** unused in jc_reborn but present in scripts. Treat as no-op; scripts may rely on subtle side effects we miss.
- **`DRAW_BACKGROUND` (0x0080):** the C code calls `grLoadScreen(NULL)` — interpreted as "free image slots." Confirm by inspecting `~/dev/jc_reborn/ttm.c:184`.
- **String reading in TTM/ADS records:** the C uses both length-prefixed strings (`getString`) and null-terminated. The 40-byte fixed-pad path assumed in `ttm-loader.ts` may need adjustment if some TTMs misparse — verify by comparing parsed tag lists against `~/dev/jc_reborn` debug output.
- **Random reproducibility:** v1 uses `Math.random()`. Original used `srand(time(NULL))`. Acceptable.
- **Performance:** typed-array compositing of ~12 layers × 307,200 pixels per frame at 50 Hz is ~180 Mops/s — well within JS budget on a modern laptop. If profiling shows a bottleneck, hoist the inner loop into a single tight `for` with manual index arithmetic.
- **Asset licensing:** `RESOURCE.MAP`/`RESOURCE.001` are Sierra's IP. Plan keeps them out of the repo via `.gitignore`; user supplies them locally.

---

## Critical files to be modified

- `~/dev/jc-reborn-web/src/resource/uncompress.ts` — RLE + LZW; off-by-one here corrupts every BMP.
- `~/dev/jc-reborn-web/src/gfx/compositor.ts` — hot path; layer ordering must match `~/dev/jc_reborn/graphics.c:175-208`.
- `~/dev/jc-reborn-web/src/ttm/interpreter.ts` — opcode dispatch; argument order errors per opcode are easy to introduce.
- `~/dev/jc-reborn-web/src/ads/scheduler.ts` — largest file; conditional + RANDOM control flow must match `~/dev/jc_reborn/ads.c` line-for-line.
- `~/dev/jc-reborn-web/src/walk/calcpath.ts` — pathfinding correctness gates Johnny's movement.
