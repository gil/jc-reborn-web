import type { TtmResource } from '../decode/ttm-loader.js';
import type { ClipRect, DrawState, Surface } from '../gfx/gdi/surface.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const BMP_SLOTS = 6;
export const PALETTE_SLOTS = 6;
export const ZONE_SLOTS = 12;

export interface Bitmaps {
  images: Surface[];
  mirrored: boolean;
}

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TtmSlot {
  id: number;
  ttm: TtmResource | null;
  bitmaps: (Bitmaps | null)[];
  palettes: (Uint8Array | null)[];
  zones: (Zone | null)[];
}

export interface TtmThread {
  slot: TtmSlot;
  isRunning: 0 | 1 | 2;
  sceneSlot: number;
  sceneTag: number;
  sceneTimer: number;
  sceneIterations: number;
  delay: number;
  timer: number;
  tagPage: number;
  page: number;
  nextPage: number;
  replay: boolean;
  purged: boolean;
  paletteSlot: number;
  bmpSlot: number;
  zoneSlot: number;
  foreground: number;
  background: number;
  clipOn: boolean;
  clip: ClipRect;
}

const wholeScreen = (): ClipRect => ({ x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 });

export function makeTtmSlot(id: number, ttm: TtmResource | null): TtmSlot {
  return {
    id,
    ttm,
    bitmaps: new Array<Bitmaps | null>(BMP_SLOTS).fill(null),
    palettes: new Array<Uint8Array | null>(PALETTE_SLOTS).fill(null),
    zones: new Array<Zone | null>(ZONE_SLOTS).fill(null),
  };
}

export function makeThread(slot: TtmSlot = makeTtmSlot(0, null)): TtmThread {
  return {
    slot,
    isRunning: 0,
    sceneSlot: 0,
    sceneTag: 0,
    sceneTimer: 0,
    sceneIterations: 0,
    delay: 0,
    timer: 0,
    tagPage: 0,
    page: 0,
    nextPage: -1,
    replay: false,
    purged: false,
    paletteSlot: 0,
    bmpSlot: 0,
    zoneSlot: 0,
    foreground: 0x0f,
    background: 0x0f,
    clipOn: true,
    clip: wholeScreen(),
  };
}

export function zoneId(slotId: number, zone: number): number {
  return slotId * ZONE_SLOTS + zone;
}

export function loadThreadDrawState(thread: TtmThread, draw: DrawState): void {
  draw.foreground = thread.foreground;
  draw.background = thread.background;
  draw.clipOn = thread.clipOn;
  draw.clip = { ...thread.clip };
}

export function resetDrawClip(draw: DrawState): void {
  draw.clipOn = true;
  draw.clip = wholeScreen();
}
