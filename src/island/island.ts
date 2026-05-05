import { drawSprite, drawSpriteFlip } from '../gfx/sprite.js';
import { decodeScr } from '../decode/scr.js';
import { decodeBmp } from '../decode/bmp.js';
import type { ParsedArchive } from '../resource/types.js';
import type { Layer, Sprite } from '../types.js';
import { SCREEN_W, SCREEN_H, TRANSPARENT } from '../types.js';

export interface IslandState {
  lowTide: boolean;
  night: boolean;
  raft: number;     // 0=none, 1-5
  holiday: number;  // 0=none, 1=Halloween, 2=StPatrick, 3=Xmas, 4=NewYear
  xPos: number;
  yPos: number;
}

export function randomIslandState(): IslandState {
  const r = Math.random;
  const lowTide = r() < 0.33;
  // xPos/yPos ranges from story.c:135-144 (medium zoom — most common)
  const xPos = -114 + Math.floor(r() * 134);
  const yPos = -14  + Math.floor(r() * 99);
  return { lowTide, night: false, raft: 0, holiday: 0, xPos, yPos };
}

export interface IslandRuntime {
  bgLayer: Layer;
  sprites: Sprite[];   // all sprites from BACKGRND.BMP
  state: IslandState;
  counter1: number;
  counter2: number;
}

// Draw helper: applies xPos/yPos island offset
function blit(rt: IslandRuntime, x: number, y: number, sprNo: number, flip = false): void {
  const sp = rt.sprites[sprNo];
  if (!sp) return;
  const dx = x + rt.state.xPos, dy = y + rt.state.yPos;
  if (flip) drawSpriteFlip(rt.bgLayer, sp, dx, dy);
  else drawSprite(rt.bgLayer, sp, dx, dy);
}

// Draw helper with no offset (clouds use grDx=grDy=0)
function blitNoOffset(rt: IslandRuntime, x: number, y: number, sprNo: number, flip = false): void {
  const sp = rt.sprites[sprNo];
  if (!sp) return;
  if (flip) drawSpriteFlip(rt.bgLayer, sp, x, y);
  else drawSprite(rt.bgLayer, sp, x, y);
}

export function islandInit(archive: ParsedArchive, state: IslandState): IslandRuntime {
  // Allocate background layer
  const indexed = new Uint8Array(SCREEN_W * SCREEN_H);
  indexed.fill(TRANSPARENT);
  const bgLayer: Layer = { indexed, clip: { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H } };

  // Load and blit background screen (ocean or night)
  const scrName = state.night
    ? 'NIGHT.SCR'
    : `OCEAN0${Math.floor(Math.random() * 3)}.SCR`;
  const scrRaw = archive.byName.get(scrName);
  if (scrRaw) {
    const scr = decodeScr(scrRaw.payload);
    indexed.set(scr.indexed);
  }

  // Load MRAFT.BMP for raft sprite
  if (state.raft > 0) {
    const raftRaw = archive.byName.get('MRAFT.BMP');
    if (raftRaw) {
      const raftBmp = decodeBmp(raftRaw.payload);
      const xRaft = state.lowTide ? 529 : 512;
      const yRaft = state.lowTide ? 281 : 266;
      const sp = raftBmp.sprites[state.raft - 1];
      if (sp) drawSprite(bgLayer, sp, xRaft + state.xPos, yRaft + state.yPos);
    }
  }

  // Load BACKGRND.BMP — all other sprites come from here
  const bmpRaw = archive.byName.get('BACKGRND.BMP');
  const sprites: Sprite[] = bmpRaw ? decodeBmp(bmpRaw.payload).sprites : [];
  const rt: IslandRuntime = { bgLayer, sprites, state, counter1: 0, counter2: 0 };

  // Clouds (grDx=grDy=0 in C — no island offset)
  const windDir = Math.random() < 0.5;
  let numClouds: number;
  const r = Math.random;
  if (r() < 0.5) numClouds = 1;
  else if (r() < 0.5) numClouds = 0;
  else if (r() < 0.75) numClouds = 2;
  else if (r() < 0.75) numClouds = 3;
  else if (r() < 0.75) numClouds = 4;
  else numClouds = 5;

  for (let i = 0; i < numClouds; i++) {
    const cloudNo = Math.floor(r() * 3);
    const [maxW, maxH] = cloudNo === 0 ? [640 - 129, 135 - 36]
      : cloudNo === 1 ? [640 - 192, 135 - 57]
      : [640 - 264, 135 - 76];
    const cx = Math.floor(r() * maxW);
    const cy = Math.floor(r() * maxH);
    blitNoOffset(rt, cx, cy, 15 + cloudNo, windDir);
  }

  // Island static elements (with xPos/yPos offset)
  blit(rt, 288, 279,  0);   // island body
  blit(rt, 442, 148, 13);   // trunk
  blit(rt, 365, 122, 12);   // leafs
  blit(rt, 396, 279, 14);   // palm shadow

  if (state.lowTide) {
    blit(rt, 249, 303, 1);  // low tide shore
    blit(rt, 150, 328, 2);  // rock
  }

  // Prime wave animation (4 initial cycles)
  for (let i = 0; i < 4; i++) islandAnimate(rt);

  return rt;
}

// Called every 8 ticks (delay set in adsInitIsland).
// Cycles wave sprites using two rolling counters (port of island.c:islandAnimate).
export function islandAnimate(rt: IslandRuntime): void {
  if (rt.state.lowTide) {
    rt.counter2 = (rt.counter2 + 1) % 4;
    switch (rt.counter2) {
      case 0: blit(rt, 129, 340, 39 + rt.counter1); break; // rock waves
      case 1: blit(rt, 233, 323, 30 + rt.counter1); break; // low tide left
      case 2: blit(rt, 367, 356, 33 + rt.counter1); break; // low tide center
      case 3: blit(rt, 558, 323, 36 + rt.counter1); break; // low tide right
    }
  } else {
    rt.counter2 = (rt.counter2 + 1) % 3;
    switch (rt.counter2) {
      case 0: blit(rt, 270, 306, 3 + rt.counter1); break;  // high tide left
      case 1: blit(rt, 364, 319, 6 + rt.counter1); break;  // high tide center
      case 2: blit(rt, 518, 303, 9 + rt.counter1); break;  // high tide right
    }
  }
  if (rt.counter2 === 0) rt.counter1 = (rt.counter1 + 1) % 3;
}

// Returns a holiday overlay layer (or null if no holiday).
export function islandInitHoliday(archive: ParsedArchive, state: IslandState): Layer | null {
  if (!state.holiday) return null;
  const raw = archive.byName.get('HOLIDAY.BMP');
  if (!raw) return null;
  const sprites = decodeBmp(raw.payload).sprites;
  const indexed = new Uint8Array(SCREEN_W * SCREEN_H);
  indexed.fill(TRANSPARENT);
  const layer: Layer = { indexed, clip: { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H } };
  // holiday sprite indices and positions from island.c
  const configs: Array<[number, number, number]> = [
    [410, 298, 0], // Halloween
    [333, 286, 1], // St Patrick
    [404, 267, 2], // Christmas
    [361, 155, 3], // New Year
  ];
  const [x, y, sprNo] = configs[state.holiday - 1]!;
  const sp = sprites[sprNo];
  if (sp) drawSprite(layer, sp, x + state.xPos, y + state.yPos);
  return layer;
}
