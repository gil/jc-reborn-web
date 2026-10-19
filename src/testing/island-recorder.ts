import { SURFACE_A } from '../gfx/gdi/display.js';
import type { ClipRect } from '../gfx/gdi/surface.js';
import { drawHoliday, drawIsland, animateIsland, makeIsland, type Island } from '../island/island.js';
import { loadSheet, type IslandDevice, type SpriteSheet } from '../island/island-device.js';
import { clockTick, makeTimers } from '../engine/timers.js';
import type { ParsedArchive } from '../resource/types.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const ISLAND_CASES = 24;
export const ISLAND_STEPS = 60;
const PLACES = [0xffff, 0, 1, 2, 0x10, 0x14, 0x24, 0x28, 0x0c, 0x30];

type Event = (string | number)[];

export class RecordingIslandDevice implements IslandDevice {
  readonly events: Event[] = [];
  private source = SURFACE_A;
  private target = SURFACE_A;
  private clip: ClipRect | null = null;
  private overlapCalls = 0;

  constructor(private readonly archive: ParsedArchive) {}

  restart(): void {
    this.events.length = 0;
    this.overlapCalls = 0;
  }

  loadSheet(name: string): SpriteSheet | null {
    this.events.push(['sheet', name]);
    return loadSheet(this.archive, name);
  }

  loadScreen(name: string): void {
    this.events.push(['screen', this.target, name]);
  }

  setSource(surface: number): void {
    this.source = surface;
  }

  setTarget(surface: number): void {
    this.target = surface;
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    this.events.push(['fill', this.target, x, y, w, h, color]);
  }

  drawSprite(sheet: SpriteSheet, index: number, x: number, y: number, flags: number): void {
    const clip = this.clip ? [1, this.clip.x1, this.clip.y1, this.clip.x2, this.clip.y2] : [0, 0, 0, SCREEN_W - 1, SCREEN_H - 1];
    this.events.push(['sprite', this.target, sheet.name, index, x, y, flags, ...clip]);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    this.events.push(['line', this.target, x1, y1, x2, y2, color]);
  }

  copyRect(x: number, y: number, w: number, h: number): void {
    this.events.push(['copy', this.source, this.target, x, y, w, h]);
  }

  addDirtyRect(x: number, y: number, w: number, h: number, source: number, target: number, age: number): void {
    this.events.push(['dirty', source, target, age, x, y, w, h]);
  }

  dirtyOverlaps(x: number, y: number, w: number, h: number, target: number, age: number): boolean {
    const answer = this.overlapCalls++ % 3 === 1;
    this.events.push(['overlaps', target, age, x, y, w, h, answer ? 1 : 0]);
    return answer;
  }

  setClip(clip: ClipRect | null): void {
    this.clip = clip;
  }
}

function stateRow(island: Island, random: StoryRandom): (string | number)[] {
  const flags = island.world.island;
  const record = (d: { x: number; y: number; frame: number; kind: number; period: number; countdown: number }) =>
    [d.x, d.y, d.frame, d.kind, d.period, d.countdown].join(',');
  return [
    island.x, island.y, flags.lowTide, flags.place, island.raftFrame, ...island.surf, island.wind,
    island.timers.surf, island.timers.waves, ...island.cloudsLeft, ...island.wavesLeft, random.writeIndex,
    ...island.clouds.map(record), ...island.waves.map(record),
  ];
}

export function traceIslandCase(archive: ParsedArchive, k: number): string[] {
  const device = new RecordingIslandDevice(archive);
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  const timers = makeTimers();
  const island = makeIsland(device, world, timers, { background: true, clouds: true, waves: true });
  drawIsland(island);
  Object.assign(world.island, {
    mode: [0, 0, 0, 1, 2][k % 5]!,
    place: PLACES[k % PLACES.length]!,
    lowTide: [0xffff, 0, 1][k % 3]!,
    still: k % 7 === 3,
    noRaft: k % 6 === 5,
    holidayShown: k % 4 !== 2,
  });
  world.sequence.holiday = k % 5;
  world.sequence.slot = k % 2 ? 13 : 0;
  world.days.numDays = [1, 3, 9][k % 3]!;
  island.settings = { background: k % 8 !== 7, clouds: k % 9 !== 8, waves: k % 10 !== 9 };
  island.speed = k % 2 === 0 ? 200 : 0;
  random.discard(997 * k);
  const rows: string[] = [];
  const flush = (step: number) => {
    for (const [event, ...values] of device.events) rows.push([k, step, event, values.join(' ')].join('\t'));
    rows.push([k, step, 'state', stateRow(island, random).join(' ')].join('\t'));
    device.events.length = 0;
  };
  device.restart();
  drawIsland(island);
  flush(-1);
  for (let step = 0; step < ISLAND_STEPS; step++) {
    for (let i = 0; i < 1 + (step % 4); i++) clockTick(timers);
    animateIsland(island, false);
    drawHoliday(island, false);
    flush(step);
  }
  return rows;
}
