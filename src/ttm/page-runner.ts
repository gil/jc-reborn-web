import { readTtmInstruction } from '../decode/ttm-bytecode.js';
import type { TtmResource } from '../decode/ttm-loader.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import type { DrawState } from '../gfx/gdi/surface.js';
import { setPaletteColors } from '../gfx/palette.js';
import { SCREEN_H, SCREEN_W, type Palette } from '../types.js';
import type { TtmDevice } from './device.js';
import { OP } from './opcodes.js';
import { zoneId, type TtmThread } from './state.js';

export interface TtmEnv {
  device: TtmDevice;
  draw: DrawState;
  islandX: number;
  islandY: number;
  pendingPalette: Uint8Array | null;
  mirrorNextLoad: boolean;
  keepDrawings: boolean;
}

export interface PageResult {
  ran: boolean;
  delay: number | null;
  gotoPage: number | null;
  purge: boolean;
}

interface Run {
  delay: number | null;
  gotoPage: number | null;
  purge: boolean;
  screenLoaded: boolean;
  callDepth: number;
  callX: number;
  callY: number;
}

const WALK_BITMAPS = 'JOHNWALK.BMP';
const SPRITE_OPCODES: ReadonlySet<number> = new Set([
  OP.DRAW_SPRITE,
  OP.DRAW_SPRITE_STRETCHED,
  OP.DRAW_SPRITE_FLIPPED,
  OP.DRAW_SPRITE_FLIPPED_STRETCHED,
  OP.DRAW_SPRITE_MIRRORED,
  OP.DRAW_SPRITE_MIRRORED_STRETCHED,
  OP.DRAW_SPRITE_MIRRORED_FLIPPED,
  OP.DRAW_SPRITE_MIRRORED_FLIPPED_STRETCHED,
]);

const int8 = (value: number) => (value << 24) >> 24;
const int16 = (value: number) => (value << 16) >> 16;
const isDrawOpcode = (opcode: number) => (opcode & 0xf000) === 0xa000;
const isStretched = (opcode: number) => (opcode & 0x0f) === 6;

export function makeTtmEnv(device: TtmDevice, draw: DrawState): TtmEnv {
  return { device, draw, islandX: 0, islandY: 0, pendingPalette: null, mirrorNextLoad: false, keepDrawings: false };
}

export function runTtmPage(env: TtmEnv, thread: TtmThread, page: number): PageResult {
  const run: Run = { delay: null, gotoPage: null, purge: false, screenLoaded: false, callDepth: 0, callX: 0, callY: 0 };
  const ran = runPage(env, thread, page, run);
  return { ran, delay: run.delay, gotoPage: run.gotoPage, purge: run.purge };
}

export function pageOfTag(ttm: TtmResource, tag: number): number {
  for (let page = 0; page < ttm.pageOffsets.length; page++) {
    const first = readTtmInstruction(ttm.bytecode, ttm.pageOffsets[page]!);
    if ((first.opcode === OP.TAG || first.opcode === OP.LOCAL_TAG) && first.args[0] === tag) return page;
  }
  return -1;
}

export function randomDelay(random: number, low: number, high: number): number {
  const remainder = int16((random & 0xffff) % ((high - low) & 0xffff));
  return int16(low + Math.abs(remainder));
}

export function activatePendingPalette(env: TtmEnv, palette: Palette): void {
  if (!env.pendingPalette) return;
  setPaletteColors(palette, env.pendingPalette);
  env.pendingPalette = null;
}

function runPage(env: TtmEnv, thread: TtmThread, page: number, run: Run): boolean {
  const ttm = thread.slot.ttm;
  if (!ttm || page < 0 || page >= ttm.pageCount || page >= ttm.pageOffsets.length) return false;
  run.gotoPage = null;
  let offset = ttm.pageOffsets[page]!;
  for (;;) {
    const instruction = readTtmInstruction(ttm.bytecode, offset);
    offset = instruction.next;
    const opcode = remap(instruction.opcode);
    if (opcode === OP.UPDATE) break;
    env.device.setSurfaces(SURFACE_B, SURFACE_B);
    const args = instruction.args.map(int16);
    applyOffsets(env, run, opcode, args);
    if ((opcode & 0xf000) === 0xc000) {
      if (!thread.replay && opcode === OP.PLAY_SAMPLE) env.device.playSound(args[0]!);
    } else if (isDrawOpcode(opcode)) {
      drawOpcode(env, thread, opcode, args);
    } else {
      controlOpcode(env, thread, run, opcode, args, instruction.text ?? '');
    }
    if (isDrawOpcode(opcode)) markDrawn(env, thread, opcode, args);
  }
  if (run.screenLoaded) {
    const clipOn = env.draw.clipOn;
    env.draw.clipOn = false;
    env.device.addDirtyRect(0, 0, SCREEN_W, SCREEN_H, SURFACE_B, SURFACE_A, 0);
    env.draw.clipOn = clipOn;
    run.screenLoaded = false;
  }
  return true;
}

function remap(opcode: number): number {
  if (opcode === OP.PLAY_SAMPLE_ALIAS) return OP.PLAY_SAMPLE;
  if (opcode === OP.STOP_SAMPLE_ALIAS) return OP.STOP_SAMPLE;
  return opcode;
}

function applyOffsets(env: TtmEnv, run: Run, opcode: number, args: number[]): void {
  if (opcode === OP.MARK_ZONE_DIRTY) return;
  if (run.callDepth > 0 && isDrawOpcode(opcode)) shift(args, run.callX, run.callY, opcode === OP.DRAW_LINE);
  const islandOpcode = isDrawOpcode(opcode) || opcode === OP.SET_CLIP_ZONE || opcode === OP.COPY_TO_BACKGROUND;
  if (islandOpcode && (env.islandX !== 0 || env.islandY !== 0)) {
    shift(args, env.islandX, env.islandY, opcode === OP.DRAW_LINE || opcode === OP.SET_CLIP_ZONE);
  }
}

function shift(args: number[], dx: number, dy: number, bothCorners: boolean): void {
  args[0] = int16((args[0] ?? 0) + dx);
  args[1] = int16((args[1] ?? 0) + dy);
  if (!bothCorners) return;
  args[2] = int16((args[2] ?? 0) + dx);
  args[3] = int16((args[3] ?? 0) + dy);
}

function drawOpcode(env: TtmEnv, thread: TtmThread, opcode: number, args: number[]): void {
  const { device, draw } = env;
  const [x = 0, y = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.DRAW_PIXEL:
      device.setPixel(x, y, int8(draw.foreground));
      return;
    case OP.DRAW_LINE:
      device.drawLine(x, y, a2, a3);
      return;
    case OP.DRAW_RECT:
    case OP.DRAW_RECT_OUTLINE:
      draw.fill = opcode === OP.DRAW_RECT;
      device.drawRect(x, y, a2, a3);
      draw.fill = true;
      return;
    case OP.DRAW_CIRCLE:
    case OP.DRAW_CIRCLE_OUTLINE: {
      draw.fill = opcode === OP.DRAW_CIRCLE;
      const r = a3 >> 1;
      device.drawCircle(r, int16(x + r), int16(y + r));
      draw.fill = true;
      return;
    }
    case OP.SAVE_ZONE:
    case OP.RESTORE_ZONE:
      if (!thread.replay && a2 > 0 && a3 > 0 && x + a2 <= SCREEN_W && y + a3 <= SCREEN_H) zoneEffect(env, thread, opcode, x, y, a2, a3);
      return;
  }
  if (!SPRITE_OPCODES.has(opcode)) return;
  const bitmaps = thread.slot.bitmaps[a3];
  const image = bitmaps?.images[a2];
  if (!bitmaps || !image) return;
  const flags = (opcode >> 4) & 0x0f;
  if (isStretched(opcode)) device.drawSpriteStretched(image, x, y, flags, a4, a5);
  else device.drawSprite(image, bitmaps.mirrored, x, y, flags);
}

function zoneEffect(env: TtmEnv, thread: TtmThread, opcode: number, x: number, y: number, w: number, h: number): void {
  const { device } = env;
  const slot = thread.slot;
  if (opcode === OP.SAVE_ZONE) {
    slot.zones[0] = { x, y, w, h };
    device.setSurfaces(SURFACE_B, SURFACE_A);
    device.saveZone(zoneId(slot.id, 0), x, y, w, h);
  } else {
    const zone = slot.zones[0];
    device.setSurfaces(SURFACE_B, SURFACE_B);
    if (zone) device.restoreZone(zoneId(slot.id, 0), zone.x, zone.y, zone.w, zone.h);
  }
  device.setSurfaces(SURFACE_B, SURFACE_B);
}

function markDrawn(env: TtmEnv, thread: TtmThread, opcode: number, args: number[]): void {
  const [x = 0, y = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.DRAW_PIXEL:
      addDrawnRect(env, x, y, 8, 1);
      return;
    case OP.DRAW_LINE:
      addDrawnRect(env, Math.min(x, a2), Math.min(y, a3), Math.abs(x - a2) + 8, Math.abs(y - a3) + 2);
      return;
    case OP.DRAW_CIRCLE:
    case OP.DRAW_CIRCLE_OUTLINE:
      addDrawnRect(env, x - 20, y, a2 + 48, a3 + 1);
      return;
    case OP.MARK_ZONE_DIRTY: {
      const zone = thread.slot.zones[x];
      if (zone) addDrawnRect(env, zone.x, zone.y, zone.w, zone.h);
      return;
    }
  }
  if (SPRITE_OPCODES.has(opcode)) {
    const image = thread.slot.bitmaps[a3]?.images[a2];
    if (!image) return;
    if (isStretched(opcode)) addDrawnRect(env, x, y, a4, a5);
    else if (image.width !== 0) addDrawnRect(env, x, y, image.width, image.height + 2);
    return;
  }
  addDrawnRect(env, x, y, a2 + 8, a3 + 2);
}

function addDrawnRect(env: TtmEnv, x: number, y: number, w: number, h: number): void {
  const [left, top, width, height] = [x, y, w, h].map(int16) as [number, number, number, number];
  env.device.addDirtyRect(left, top, width, height, SURFACE_B, SURFACE_A, 0);
  env.device.addDirtyRect(left, top, width, height, SURFACE_B, SURFACE_A, 1);
  if (!env.keepDrawings) env.device.addDirtyRect(left, top, width, height, SURFACE_C, SURFACE_B, 0);
}

function controlOpcode(env: TtmEnv, thread: TtmThread, run: Run, opcode: number, args: number[], text: string): void {
  const { device, draw } = env;
  const slot = thread.slot;
  const replay = thread.replay;
  const [a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0] = args;
  switch (opcode) {
    case OP.SCREEN_TO_BACKGROUND:
      if (!replay) screenToBackground(env, run);
      return;
    case OP.FREE_PALETTE:
      if (replay) return;
      if (slot.palettes[thread.paletteSlot] === env.pendingPalette) env.pendingPalette = null;
      slot.palettes[thread.paletteSlot] = null;
      return;
    case OP.FREE_IMAGES:
      if (!replay) slot.bitmaps[thread.bmpSlot] = null;
      return;
    case OP.FREE_ZONE:
      if (!replay) slot.zones[thread.zoneSlot] = null;
      return;
    case OP.PURGE:
      run.purge = true;
      return;
    case OP.KEEP_DRAWINGS:
      env.keepDrawings = true;
      return;
    case OP.ERASE_DRAWINGS:
      env.keepDrawings = false;
      return;
    case OP.SET_DELAY:
      run.delay = a0;
      return;
    case OP.SET_BMP_SLOT:
      thread.bmpSlot = a0;
      return;
    case OP.SET_PALETTE_SLOT:
      thread.paletteSlot = a0;
      if (!replay) env.pendingPalette = slot.palettes[a0] ?? null;
      return;
    case OP.SET_ZONE_SLOT:
      thread.zoneSlot = a0;
      return;
    case OP.GOTO_TAG: {
      const page = slot.ttm ? pageOfTag(slot.ttm, a0 & 0xffff) : -1;
      run.gotoPage = page < 0 ? null : page;
      return;
    }
    case OP.SET_COLORS:
      thread.foreground = draw.foreground = a0 & 0xff;
      thread.background = draw.background = a1 & 0xff;
      return;
    case OP.MIRROR_NEXT_LOAD:
      if (!replay) env.mirrorNextLoad = true;
      return;
    case OP.RANDOM_DELAY:
      if (!replay) run.delay = randomDelay(device.random(), a0, a1);
      return;
    case OP.CALL_PAGE:
      callPage(env, thread, run, a0, a1, a2);
      return;
    case OP.DIRTY_SCREEN:
      if (!replay) addDrawnRect(env, 0, 0, SCREEN_W, SCREEN_H);
      return;
    case OP.SET_CLIP_ZONE:
      thread.clipOn = draw.clipOn = true;
      thread.clip = { x1: a0, y1: a1, x2: a2, y2: a3 };
      draw.clip = { ...thread.clip };
      return;
    case OP.COPY_TO_BACKGROUND:
      if (replay) return;
      copyToBackground(env, a0, a1, a2, a3);
      device.addDirtyRect(a0, a1, a2, a3, SURFACE_B, SURFACE_A, 0);
      return;
    case OP.COPY_SURFACE_RECT:
      if (replay) return;
      device.setSurfaces(surfaceByNumber(a4), surfaceByNumber(a5));
      device.copyRect(a0, a1, a2, a3);
      device.setSurfaces(SURFACE_A, SURFACE_B);
      return;
    case OP.LOAD_SCREEN:
      if (replay) return;
      device.loadScreen(text);
      screenToBackground(env, run);
      return;
    case OP.LOAD_IMAGE:
      if (!replay) loadImage(env, thread, text);
      return;
    case OP.LOAD_PALETTE: {
      if (replay) return;
      const palette = device.loadPalette(text);
      slot.palettes[thread.paletteSlot] = palette;
      env.pendingPalette = palette;
      return;
    }
  }
}

function callPage(env: TtmEnv, thread: TtmThread, run: Run, x: number, y: number, tag: number): void {
  run.callDepth++;
  run.callX = x;
  run.callY = y;
  const purgedBefore = run.purge;
  const page = thread.slot.ttm ? pageOfTag(thread.slot.ttm, tag & 0xffff) : -1;
  if (page >= 0) runPage(env, thread, page, run);
  if (!purgedBefore) run.purge = false;
  run.callDepth--;
}

function screenToBackground(env: TtmEnv, run: Run): void {
  run.screenLoaded = true;
  copyToBackground(env, 0, 0, SCREEN_W, SCREEN_H);
  env.device.dropDirtyList(SURFACE_C, SURFACE_B, 0);
}

function copyToBackground(env: TtmEnv, x: number, y: number, w: number, h: number): void {
  env.device.setSurfaces(SURFACE_B, SURFACE_C);
  env.device.copyRect(x, y, w, h);
  env.device.setSurfaces(SURFACE_B, SURFACE_B);
}

function surfaceByNumber(n: number): number {
  if (n === 0) return SURFACE_A;
  if (n === 2) return SURFACE_C;
  return SURFACE_B;
}

function loadImage(env: TtmEnv, thread: TtmThread, name: string): void {
  thread.slot.bitmaps[thread.bmpSlot] = name.toUpperCase() === WALK_BITMAPS ? env.device.walkBitmaps() : env.device.loadBitmaps(name, env.mirrorNextLoad);
  env.mirrorNextLoad = false;
}
