import type { Timers } from '../engine/timers.js';
import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { MIRROR } from '../gfx/gdi/sprite.js';
import type { Surface } from '../gfx/gdi/surface.js';
import { MODE_ISLAND, MODE_NO_ISLAND, NO_PLACE, NO_TIDE, type StoryWorld } from '../story/sequence.js';
import { SCREEN_H, SCREEN_W } from '../types.js';
import type { IslandDevice, SpriteSheet } from './island-device.js';

export interface IslandSettings {
  background: boolean;
  clouds: boolean;
  waves: boolean;
}

export interface Drifter {
  x: number;
  y: number;
  frame: number;
  kind: number;
  period: number;
  countdown: number;
}

export interface Island {
  device: IslandDevice;
  world: StoryWorld;
  timers: Timers;
  settings: IslandSettings;
  speed: number;
  background: SpriteSheet | null;
  raft: SpriteSheet | null;
  holidays: SpriteSheet | null;
  x: number;
  y: number;
  raftFrame: number;
  surf: [number, number, number];
  wind: number;
  clouds: Drifter[];
  cloudCount: number;
  cloudsLeft: [number, number, number];
  waves: Drifter[];
  waveCount: number;
  wavesLeft: [number, number, number, number];
}

type Spot = readonly [x: number, y: number, w: number, h: number, sprite: number, counter: number];

const OCEANS = ['OCEAN00.SCR', 'OCEAN01.SCR', 'OCEAN02.SCR'];
const NIGHT = 'NIGHT.SCR';
const NIGHT_SLOT = 12;
const FILL_COLOR = 5;
const GLINT_COLOR = 15;
const ISLAND_X = 0x121;
const ISLAND_Y = 0x117;
const NO_SPRITE = -1;
const SURF_PERIOD = 4;
const SURF_FRAMES = 3;
const WAVE_PERIOD = 10;
const CLOUD_RECORDS = 15;
const WAVE_RECORDS = 30;
const LAST_RAFT = 5;
const TTM_LEFT = 0x110;

const HIGH_TIDE_SURF: readonly Spot[] = [[0x10f, 0x132, 0x48, 0x1d, 3, 0], [0x16d, 0x13f, 0x9c, 0x19, 6, 1], [0x207, 0x12f, 0x41, 0x20, 9, 2]];
const LOW_TIDE_SURF: readonly Spot[] = [
  [0xea, 0x143, 0x78, 0x30, 30, 0], [0x170, 0x164, 0xab, 0x1c, 33, 1], [0x22f, 0x143, 0x51, 0x30, 36, 2], [0x82, 0x154, 0x61, 0x1d, 39, 0],
];
const HOLIDAY_SPOTS: Readonly<Record<number, readonly [sprite: number, x: number, y: number, w: number, h: number]>> = {
  1: [0, 0x19b, 0x12a, 0x28, 0x22],
  2: [2, 0x195, 0x10b, 0x38, 0x41],
  3: [3, 0x16a, 0x9b, 0x98, 0x2f],
  4: [1, 0x14e, 0x11e, 0x80, 0x30],
};
const CLOUD_SPRITES = [15, 16, 17];
const WAVE_FRAMES: readonly (readonly number[])[] = [[18, 19, 20, 21, 20, 19, 18], [22, 23, 24, 25, 24, 23, 22], [26, 27, 28, 29, 28, 27, 26]];
const WAVE_AREAS: readonly (readonly [x: number, y: number, w: number, h: number])[] = [
  [-10, 0xf9, 0x28a, 0x28], [-40, 0x121, 0x2a8, 0x5d], [-70, 0x17e, 0x2c6, 0x8e],
];
const GLINT = 0;
const SMALL = 0;
const MEDIUM = 1;
const LARGE = 2;

const drifter = (): Drifter => ({ x: 0, y: 0, frame: 0, kind: 0, period: 0, countdown: 0 });

export function makeIsland(device: IslandDevice, world: StoryWorld, timers: Timers, settings: IslandSettings): Island {
  return {
    device, world, timers, settings, speed: 0,
    background: null, raft: null, holidays: null,
    x: 0, y: 0, raftFrame: 0, surf: [0, 0, 0], wind: 1,
    clouds: Array.from({ length: CLOUD_RECORDS }, drifter), cloudCount: 0, cloudsLeft: [0, 0, 0],
    waves: Array.from({ length: WAVE_RECORDS }, drifter), waveCount: 0, wavesLeft: [0, 0, 0, 0],
  };
}

export function drawIntro(device: IslandDevice): void {
  device.setSource(SURFACE_B);
  device.setTarget(SURFACE_B);
  device.loadScreen('INTRO.SCR');
  device.setTarget(SURFACE_A);
  device.copyRect(0, 0, SCREEN_W, SCREEN_H);
}

export function drawIsland(island: Island): boolean {
  const { device, world } = island;
  const flags = world.island;
  if (world.sequence.holiday !== 0 && !island.holidays) island.holidays = device.loadSheet('HOLIDAY.BMP');
  if (!island.background) {
    island.background = device.loadSheet('BACKGRND.BMP');
    island.raft = device.loadSheet('MRAFT.BMP');
    if (!island.background) island.cloudCount = island.waveCount = 0;
    return island.background !== null && island.raft !== null;
  }
  device.setTarget(SURFACE_C);
  if (!island.settings.background || flags.mode === MODE_NO_ISLAND) device.fillRect(0, 0, SCREEN_W, SCREEN_H, FILL_COLOR);
  else if (flags.mode === MODE_ISLAND && world.sequence.slot < NIGHT_SLOT) device.loadScreen(OCEANS[island.world.random.next() % OCEANS.length]!);
  else device.loadScreen(NIGHT);
  if (flags.lowTide === NO_TIDE) flags.lowTide = island.world.random.next() & 1;
  placeIsland(island);
  island.x -= ISLAND_X;
  island.y -= ISLAND_Y;
  if (flags.mode !== MODE_NO_ISLAND) {
    drawRaft(island, true);
    sprite(island, 0, 0x121, 0x117);
    if (flags.lowTide === 1) {
      sprite(island, 1, 0xfa, 0x12f);
      sprite(island, 2, 0x97, 0x148);
    }
    island.timers.surf = 0;
    island.surf = [2, 2, 2];
    drawSurf(island);
    sprite(island, 14, 0x18d, 0x117);
    sprite(island, 13, 0x1bb, 0x94);
    sprite(island, 12, 0x16e, 0x7a);
  }
  device.setSource(SURFACE_C);
  device.setTarget(SURFACE_B);
  device.copyRect(0, 0, SCREEN_W, SCREEN_H);
  device.addDirtyRect(0, 0, SCREEN_W, SCREEN_H, SURFACE_B, SURFACE_A, 0);
  island.waveCount = !island.settings.waves || flags.still ? 0 : WAVE_RECORDS;
  resetOceanWaves(island);
  island.cloudCount = island.settings.clouds ? CLOUD_RECORDS : 0;
  initClouds(island);
  animateIsland(island, true);
  drawHoliday(island, true);
  return true;
}

export function animateIsland(island: Island, first: boolean): void {
  const flags = island.world.island;
  if (flags.mode === MODE_NO_ISLAND) return;
  island.device.setTarget(SURFACE_B);
  island.device.setSource(SURFACE_C);
  animateOceanWaves(island);
  if (first) animateClouds(island);
  if (!first && flags.still) return;
  drawSurf(island);
  drawRaft(island, false);
}

export function ttmOffset(island: Island, left: boolean): { x: number; y: number } {
  if (island.world.island.mode === MODE_NO_ISLAND) return { x: 0, y: 0 };
  return { x: island.x + 1 + (left ? TTM_LEFT : 0), y: island.y };
}

export function drawHoliday(island: Island, full: boolean): void {
  const flags = island.world.island;
  const spot = HOLIDAY_SPOTS[island.world.sequence.holiday];
  if (!spot || !island.holidays || !flags.holidayShown || flags.mode === MODE_NO_ISLAND) return;
  const [index, dx, dy, w, h] = spot;
  const x = island.x + dx;
  const y = island.y + dy;
  if (full || island.device.dirtyOverlaps(x, y, w, h, SURFACE_A, 0)) island.device.drawSprite(island.holidays, index, x, y, 0);
}

export function rectOverlap(x: number, y: number, w: number, h: number, rx: number, ry: number, rw: number, rh: number): number {
  const inside = !(x < rx || rx + rw <= x + w || y < ry || ry + rh <= y + h);
  const touches = !(x + w < rx || rx + rw <= x || y + h < ry || ry + rh <= y);
  return Number(inside) + Number(touches);
}

export function redrawIslandOver(island: Island, image: Surface, x: number, y: number, scenery: boolean): void {
  const { device } = island;
  const w = image.width;
  const h = image.height;
  const over = (rx: number, ry: number, rw: number, rh: number) => rectOverlap(x, y, w, h, island.x + rx, island.y + ry, rw, rh) !== 0;
  const under = ([rx, ry, rw, rh]: Spot) => rectOverlap(x, y + h, w, 1, island.x + rx, island.y + ry, rw, rh) !== 0;
  device.setClip({ x1: x, y1: y, x2: x + w, y2: y + h });
  if (!scenery) {
    if (y + h < island.y + 0x125 && over(0x1bb, 0x94, 0x16, 0x91)) sprite(island, 13, 0x1bb, 0x94);
  } else {
    if (over(0, 0xd6, 0x280, 0x10a)) {
      if (island.world.island.lowTide === 1) {
        if (over(0x97, 0x148, 0x39, 0x1e)) sprite(island, 2, 0x97, 0x148);
        if (under(LOW_TIDE_SURF[3]!)) drawSurfSpot(island, LOW_TIDE_SURF[3]!);
        if (over(0x121, 0x117, 0x117, 0x33)) sprite(island, 0, 0x121, 0x117);
        if (over(0xfa, 0x12f, 0x17c, 0x45)) sprite(island, 1, 0xfa, 0x12f);
        for (const spot of LOW_TIDE_SURF.slice(0, 3)) if (under(spot)) drawSurfSpot(island, spot);
      } else {
        if (over(0x121, 0x117, 0x117, 0x33)) sprite(island, 0, 0x121, 0x117);
        for (const spot of HIGH_TIDE_SURF) if (under(spot)) drawSurfSpot(island, spot);
      }
    }
    if (over(0x1bb, 0x94, 0x16, 0x91)) sprite(island, 13, 0x1bb, 0x94);
    if (over(0x16e, 0x7a, 0x94, 0x45)) sprite(island, 12, 0x16e, 0x7a);
    if (over(0x18d, 0x117, 0x68, 0x26)) sprite(island, 14, 0x18d, 0x117);
  }
  device.setClip(null);
}

function sprite(island: Island, index: number, dx: number, dy: number): void {
  if (island.background) island.device.drawSprite(island.background, index, island.x + dx, island.y + dy, 0);
}

function image(island: Island, index: number): Surface | undefined {
  return island.background?.images[index];
}

function randomPlace(island: Island, spriteIndex: number, xBase: number, yBase: number, xRange: number, yRange: number): [number, number] {
  const { random } = island.world;
  if (spriteIndex !== NO_SPRITE) {
    const picture = image(island, spriteIndex)!;
    xRange -= picture.width;
    yRange -= picture.height;
  }
  if (xRange < 0 || yRange < 0) return [0, 0];
  const x = xBase + (xRange === 0 ? 0 : random.next() % xRange);
  const y = yBase + (yRange === 0 ? 0 : random.next() % yRange);
  return [x, y];
}

function placeIsland(island: Island): void {
  const flags = island.world.island;
  if (flags.place === NO_PLACE) flags.place = 0;
  const place = flags.place;
  if (place & 2) {
    [island.x, island.y] = [0x121, 299];
    return;
  }
  if (place & 1) {
    [island.x, island.y] = [0x11, 0x135];
    return;
  }
  let [left, width, height]: [number, number, number] = flags.lowTide === 1 ? [0xa8, 0x6f, 0x3b] : [0x43, 0xe2, 0x81];
  let top = 0xff;
  if (place !== 0) {
    if (place === 0x10 || place === 0x20 || place === 0x30) top = Math.trunc(height / 2) + 0xff;
    if (!((place & 4 && place & 0x10) || (place & 8 && place & 0x20))) height = Math.trunc(height / 2);
    if (place === 8 || place === 0x20 || place === 0x28) left += Math.trunc(width / 2);
    if (!((place & 4 && place & 8) || (place & 0x10 && place & 0x20))) width = Math.trunc(width / 2);
  }
  [island.x, island.y] = randomPlace(island, NO_SPRITE, left, top, width, height);
}

function drawRaft(island: Island, full: boolean): void {
  if (full) island.raftFrame = Math.min(Math.max(island.world.days.numDays - 1, 1), LAST_RAFT);
  const flags = island.world.island;
  if (!island.raft || island.raftFrame === 0 || flags.noRaft) return;
  const index = island.raftFrame - 1;
  const picture = island.raft.images[index];
  if (!picture) return;
  const [x, y]: [number, number] = flags.lowTide === 0 ? [island.x + 0x201, island.y + 0x10a] : [island.x + 0x212, island.y + 0x119];
  if (!full && !island.device.dirtyOverlaps(x, y, picture.width, picture.height, SURFACE_A, 0)) return;
  island.device.drawSprite(island.raft, index, x, y, 0);
  if (!full) redrawIslandOver(island, picture, x, y, true);
}

function surfSpots(island: Island): readonly Spot[] {
  return island.world.island.lowTide === 0 ? HIGH_TIDE_SURF : LOW_TIDE_SURF;
}

function drawSurfSpot(island: Island, [dx, dy, , , base, counter]: Spot): void {
  sprite(island, base + island.surf[counter]!, dx, dy);
}

function drawSurf(island: Island): void {
  let advanced = false;
  if (island.timers.surf === 0) {
    island.timers.surf = SURF_PERIOD;
    const surf = island.surf;
    if (surf[0] === surf[2]) surf[0]++;
    else if (surf[1] === surf[0]) surf[2]++;
    else surf[1]++;
    for (let i = 0; i < surf.length; i++) if (surf[i]! >= SURF_FRAMES) surf[i] = 0;
    advanced = true;
  }
  for (const spot of surfSpots(island)) {
    const [dx, dy, w, h] = spot;
    const x = island.x + dx;
    const y = island.y + dy;
    if (!advanced && !island.device.dirtyOverlaps(x, y, w, h, SURFACE_A, 0)) continue;
    drawSurfSpot(island, spot);
    island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 0);
    if (island.world.island.still) island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_C, 0);
  }
}

function count(counts: number[], index: number, by: number): void {
  counts[index] = counts[index]! + by;
}

function setCloud(island: Island, cloud: Drifter, kind: number, xBase: number, xRange: number): void {
  cloud.kind = kind;
  count(island.cloudsLeft, kind, -1);
  [cloud.x, cloud.y] = randomPlace(island, CLOUD_SPRITES[kind]!, xBase, 1, xRange, 0x8b);
}

function initClouds(island: Island): void {
  const { random } = island.world;
  island.cloudsLeft = [8, 4, 2];
  island.wind = random.percent(50) === 0 ? 1 : -1;
  for (const cloud of island.clouds) {
    cloud.x = 0;
    cloud.y = 0;
    if (random.percent(30) === 0) continue;
    const pick = random.percent(5, 10, 15);
    const left = island.cloudsLeft;
    let kind: number | null = null;
    if (pick === 1 && left[LARGE]) kind = LARGE;
    else if ((pick === 1 || pick === 2) && left[MEDIUM]) kind = MEDIUM;
    else if (pick >= 1 && left[SMALL]) kind = SMALL;
    if (kind === null) continue;
    setCloud(island, cloud, kind, 0, SCREEN_W);
    cloud.period = (random.next() % 5) + 6;
    cloud.countdown = random.next() % cloud.period;
    cloud.frame = 0;
  }
}

function animateClouds(island: Island): void {
  const { random } = island.world;
  const { device } = island;
  const active = island.clouds.slice(0, island.cloudCount);
  for (const cloud of active) {
    if (cloud.x !== 0 || cloud.y !== 0) continue;
    const pick = random.percent(20, 30, 50);
    const kind = pick === 1 ? LARGE : pick === 2 ? MEDIUM : pick === 3 ? SMALL : null;
    if (kind === null || island.cloudsLeft[kind] === 0) continue;
    setCloud(island, cloud, kind, island.wind === 1 ? -1000 : SCREEN_W, 1000);
    cloud.countdown = 0;
    cloud.frame = 0;
    cloud.period = (random.next() % 5) + 6;
  }
  for (const cloud of active) {
    if (cloud.x === 0 && cloud.y === 0) continue;
    if (cloud.countdown-- !== 0) continue;
    const picture = image(island, CLOUD_SPRITES[cloud.kind]!)!;
    cloud.countdown = cloud.period;
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_A, 0);
    cloud.x += island.wind;
    if ((island.wind < 0 && cloud.x + picture.width < 0) || (island.wind > 0 && cloud.x > SCREEN_W)) {
      cloud.x = 0;
      cloud.y = 0;
      count(island.cloudsLeft, cloud.kind, 1);
    }
  }
  for (const cloud of active) {
    if (cloud.x === 0 && cloud.y === 0) continue;
    const index = CLOUD_SPRITES[cloud.kind]!;
    const picture = image(island, index)!;
    const due = cloud.countdown === cloud.period || device.dirtyOverlaps(cloud.x, cloud.y, picture.width, picture.height, SURFACE_A, 0);
    if (!due || cloud.x + picture.width <= 0 || cloud.x >= SCREEN_W) continue;
    device.drawSprite(island.background!, index, cloud.x, cloud.y, island.wind < 1 ? 0 : MIRROR);
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_A, 0);
    device.addDirtyRect(cloud.x, cloud.y, picture.width, picture.height, SURFACE_B, SURFACE_C, 0);
    redrawIslandOver(island, picture, cloud.x, cloud.y, true);
  }
}

function resetOceanWaves(island: Island): void {
  island.wavesLeft = [30, 4, 2, 1];
  for (const wave of island.waves) {
    wave.x = 0;
    wave.y = 0;
  }
}

function spawnWave(island: Island, wave: Drifter, pick: number): void {
  const { random } = island.world;
  if (pick === 1) {
    if (!island.wavesLeft[GLINT]) return;
    wave.kind = GLINT;
    wave.period = (random.next() % 30) + 10;
    wave.countdown = wave.period;
    [wave.x, wave.y] = randomPlace(island, NO_SPRITE, 0, 0xd6, 0x280, 0x23);
    const hidden = rectOverlap(wave.x, wave.y, 1, 1, island.x + 0x1bb, island.y + 0x94, 0x16, 0x91) !== 0
      || rectOverlap(wave.x, wave.y, 1, 1, island.x + 0x16e, island.y + 0x7a, 0x94, 0x45) !== 0;
    if (hidden) {
      wave.x = 0;
      wave.y = 0;
    } else {
      island.wavesLeft[GLINT]--;
    }
    return;
  }
  const kind = pick - 1;
  if (kind < 1 || kind > 3 || !island.wavesLeft[kind]) return;
  wave.kind = kind;
  wave.frame = 0;
  wave.period = random.percent(30, 50);
  wave.countdown = wave.period;
  const [x, y, w, h] = WAVE_AREAS[kind - 1]!;
  [wave.x, wave.y] = randomPlace(island, NO_SPRITE, x, y, w, h);
  count(island.wavesLeft, kind, -1);
}

function animateOceanWaves(island: Island): void {
  const { random } = island.world;
  const { device, timers } = island;
  for (const wave of island.waves.slice(0, island.waveCount)) {
    if (wave.x === 0 && wave.y === 0 && random.percent(35) !== 0 && island.speed > 100) spawnWave(island, wave, random.percent(35, 5, 5, 5));
    if (wave.x === 0 && wave.y === 0) continue;
    if (wave.kind === GLINT) {
      device.drawLine(wave.x, wave.y, wave.x + 1, wave.y, GLINT_COLOR);
      device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_B, SURFACE_A, 0);
      if (timers.waves === 0 && wave.countdown-- === 0) {
        device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_B, SURFACE_A, 1);
        device.addDirtyRect(wave.x, wave.y, 1, 1, SURFACE_C, SURFACE_B, 0);
        wave.x = 0;
        wave.y = 0;
        island.wavesLeft[GLINT]++;
      }
      continue;
    }
    if (timers.waves === 0) {
      wave.x += island.wind;
      if (wave.countdown-- === 0) {
        wave.countdown = wave.period;
        wave.frame++;
      }
    }
    const index = WAVE_FRAMES[wave.kind - 1]![wave.frame];
    if (index === undefined) {
      wave.x = 0;
      wave.y = 0;
      count(island.wavesLeft, wave.kind, 1);
      continue;
    }
    const picture = image(island, index)!;
    const spots = island.world.island.lowTide === 1 ? LOW_TIDE_SURF.slice(0, 3) : HIGH_TIDE_SURF;
    const behindSurf = spots.some(([dx, dy, w, h]) => rectOverlap(wave.x, wave.y, picture.width, picture.height, island.x + dx, island.y + dy, w, h) === 2);
    if (behindSurf) continue;
    device.drawSprite(island.background!, index, wave.x, wave.y, 0);
    redrawIslandOver(island, picture, wave.x, wave.y, true);
    markIslandDrawn(island, wave.x, wave.y, picture.width, picture.height);
  }
  if (timers.waves === 0) timers.waves = WAVE_PERIOD;
}

function markIslandDrawn(island: Island, x: number, y: number, w: number, h: number): void {
  island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 0);
  island.device.addDirtyRect(x, y, w, h, SURFACE_B, SURFACE_A, 1);
  island.device.addDirtyRect(x, y, w, h, SURFACE_C, SURFACE_B, 0);
}
