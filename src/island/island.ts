import { decodeBmp } from '../decode/bmp.js';
import { decodeScr } from '../decode/scr.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { SURFACE_A, SURFACE_B, SURFACE_C, type Display } from '../gfx/gdi/display.js';
import { drawSprite, MIRROR, spriteSurface } from '../gfx/gdi/sprite.js';
import { makeDrawState, rawIndices, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export interface IslandState {
  lowTide: boolean;
  night: boolean;
  raft: number;
  holiday: number;
  xPos: number;
  yPos: number;
}

export function randomIslandState(): IslandState {
  const r = Math.random;
  const lowTide = r() < 0.33;
  // Position ranges not checked against the original (OQ-24).
  const xPos = -114 + Math.floor(r() * 134);
  const yPos = -14  + Math.floor(r() * 99);
  return { lowTide, night: false, raft: 0, holiday: 0, xPos, yPos };
}

export interface IslandSprite {
  image: Surface;
  x: number;
  y: number;
}

export interface IslandRuntime {
  sprites: Surface[];   // all sprites from BACKGRND.BMP
  holiday: IslandSprite | null;
  state: IslandState;
  counter1: number;
  counter2: number;
}

const HIGH_TIDE_WAVES = [[270, 306, 3], [364, 319, 6], [518, 303, 9]] as const;
const LOW_TIDE_WAVES = [[129, 340, 39], [233, 323, 30], [367, 356, 33], [558, 323, 36]] as const;
const HOLIDAYS = [[410, 298, 0], [333, 286, 1], [404, 267, 2], [361, 155, 3]] as const;
const unclipped = makeDrawState();

function drawOn(surface: Surface, image: Surface | undefined, x: number, y: number, flags = 0): void {
  if (image) drawSprite(surface, unclipped, image, x, y, flags);
}

function loadSprites(archive: ParsedArchive, name: string): Surface[] {
  const resource = archive.byName.get(name);
  return resource ? decodeBmp(resource.payload).sprites.map(spriteSurface) : [];
}

function drawScreenIntoBackground(display: Display, payload: Uint8Array): void {
  const screen = decodeScr(payload);
  const { target } = display;
  display.target = SURFACE_C;
  display.blitScreen({ width: screen.width, height: screen.height, pixels: rawIndices(screen.indexed) }, 0, 0);
  display.target = target;
}

export function islandInit(display: Display, archive: ParsedArchive, state: IslandState): IslandRuntime {
  const background = display.surfaces[SURFACE_C]!;
  background.pixels.fill(0);
  const screen = archive.byName.get(state.night ? 'NIGHT.SCR' : `OCEAN0${Math.floor(Math.random() * 3)}.SCR`);
  if (screen) drawScreenIntoBackground(display, screen.payload);

  if (state.raft > 0) {
    const raft = loadSprites(archive, 'MRAFT.BMP')[state.raft - 1];
    const x = (state.lowTide ? 529 : 512) + state.xPos;
    const y = (state.lowTide ? 281 : 266) + state.yPos;
    drawOn(background, raft, x, y);
  }

  const sprites = loadSprites(archive, 'BACKGRND.BMP');
  const rt: IslandRuntime = { sprites, holiday: null, state, counter1: 0, counter2: 0 };

  // Clouds ignore the island offset (OQ-24).
  const windDir = Math.random() < 0.5;
  const r = Math.random;
  const numClouds = Math.floor(r() * 6);
  for (let i = 0; i < numClouds; i++) {
    const cloudNo = Math.floor(r() * 3);
    const [maxW, maxH] = cloudNo === 0 ? [640 - 129, 100 - 36]
      : cloudNo === 1 ? [640 - 192, 100 - 57]
      : [640 - 264, 100 - 76];
    const cx = Math.floor(r() * maxW);
    const cy = Math.floor(r() * maxH) + 25;
    drawOn(background, sprites[15 + cloudNo], cx, cy, windDir ? MIRROR : 0);
  }

  const onIsland = (x: number, y: number, sprNo: number) => drawOn(background, sprites[sprNo], x + state.xPos, y + state.yPos);
  onIsland(288, 279, 0);   // island body
  onIsland(442, 148, 13);  // trunk
  onIsland(365, 122, 12);  // leafs
  onIsland(396, 279, 14);  // palm shadow
  if (state.lowTide) {
    onIsland(249, 303, 1); // low tide shore
    onIsland(150, 328, 2); // rock
  }

  for (let i = 0; i < 4; i++) {
    const [x, y, sprNo] = nextWave(rt);
    drawOn(background, sprites[sprNo], x, y);
  }

  rt.holiday = placeHoliday(archive, state);
  if (rt.holiday) drawOn(background, rt.holiday.image, rt.holiday.x, rt.holiday.y);
  return rt;
}

function nextWave(rt: IslandRuntime): [number, number, number] {
  let wave: readonly [number, number, number];
  if (rt.state.lowTide) {
    rt.counter2 = (rt.counter2 + 1) % 4;
    wave = LOW_TIDE_WAVES[rt.counter2]!;
  } else {
    rt.counter2 = (rt.counter2 + 1) % 3;
    wave = HIGH_TIDE_WAVES[rt.counter2]!;
  }
  const placed: [number, number, number] = [wave[0] + rt.state.xPos, wave[1] + rt.state.yPos, wave[2] + rt.counter1];
  if (rt.counter2 === 0) rt.counter1 = (rt.counter1 + 1) % 2;
  return placed;
}

export function islandAnimate(rt: IslandRuntime, display: Display): void {
  const [x, y, sprNo] = nextWave(rt);
  const image = rt.sprites[sprNo];
  if (!image) return;
  drawOn(display.surfaces[SURFACE_B]!, image, x, y);
  display.dirty.add(x, y, image.width, image.height, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
  display.dirty.add(x, y, image.width, image.height, COPY_RECT, SURFACE_B, SURFACE_C, 0, null);
}

function placeHoliday(archive: ParsedArchive, state: IslandState): IslandSprite | null {
  if (!state.holiday) return null;
  const [x, y, sprNo] = HOLIDAYS[state.holiday - 1]!;
  const image = loadSprites(archive, 'HOLIDAY.BMP')[sprNo];
  return image ? { image, x: x + state.xPos, y: y + state.yPos } : null;
}

export function islandRedrawHoliday(rt: IslandRuntime, display: Display): void {
  const holiday = rt.holiday;
  if (!holiday) return;
  if (!display.dirty.overlaps(holiday.x, holiday.y, holiday.image.width, holiday.image.height, SURFACE_A, 0)) return;
  drawOn(display.surfaces[SURFACE_B]!, holiday.image, holiday.x, holiday.y);
}

export function showBackground(display: Display): void {
  const { source, target } = display;
  display.source = SURFACE_C;
  display.target = SURFACE_B;
  display.copyRect(0, 0, SCREEN_W, SCREEN_H);
  display.source = source;
  display.target = target;
  display.dirty.add(0, 0, SCREEN_W, SCREEN_H, COPY_RECT, SURFACE_B, SURFACE_A, 0, null);
}

export function clearBackground(display: Display): void {
  display.surfaces[SURFACE_C]!.pixels.fill(0);
  showBackground(display);
}

export function showScreen(display: Display, archive: ParsedArchive, name: string): boolean {
  const resource = archive.byName.get(name);
  if (!resource) return false;
  display.surfaces[SURFACE_C]!.pixels.fill(0);
  drawScreenIntoBackground(display, resource.payload);
  showBackground(display);
  return true;
}
