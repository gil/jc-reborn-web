import { holidayOf, timeSlot, type DayCounters, type WallClock } from './calendar.js';
import type { RandomSource } from './random.js';
import {
  SCENES, SCENE_CLOSES, SCENE_NIGHT, SCENE_NO_HOLIDAY, SCENE_NO_ISLAND, SCENE_NO_LOW_TIDE, SCENE_NO_RAFT,
  SCENE_OPENS, SCENE_REPEATS, SCENE_STILL, type SceneEntry,
} from './scene-table.js';

export const NO_PLACE = 0xffff;
export const NO_TIDE = 0xffff;
export const MODE_ISLAND = 0;
export const MODE_NIGHT = 1;
export const MODE_NO_ISLAND = 2;

export const KIND_OPENING = 1;
export const KIND_MIDDLE = 2;
export const KIND_CLOSING = 4;
export const KIND_DAY = 0x80;

const SEQUENCE_BUDGET = 300;
const UNLIMITED_BUDGET = 999;
const QUEUE_LIMIT = 0x12a;
const LAST_DAY = 11;
const PLACE_LEFT = 0x20;
const PLACE_LOW = 0x10;
const PLACE_BITS = 0x3f;
const PLACE_QUARTERS: readonly (readonly [number, number])[] = [[0x01, 0x04], [0x02, 0x08], [0x04, 0x10], [0x08, 0x20]];

export interface IslandFlags {
  place: number;
  lowTide: number;
  mode: number;
  still: boolean;
  noRaft: boolean;
  holidayShown: boolean;
}

export interface StoryMemory {
  lastClosing: SceneEntry | null;
  lastExtra: SceneEntry | null;
  dayScene: SceneEntry | null;
  dayScenePicked: boolean;
  newSequence: boolean;
}

export interface Sequence {
  queue: SceneEntry[];
  position: number;
  slot: number;
  holiday: number;
  spot: number;
  heading: number;
}

export interface StoryWorld {
  random: RandomSource;
  days: DayCounters;
  memory: StoryMemory;
  island: IslandFlags;
  sequence: Sequence;
  startTime: number;
}

export function makeStoryWorld(random: RandomSource): StoryWorld {
  const island = {} as IslandFlags;
  resetIslandFlags(island);
  return {
    random,
    days: { numDays: 0, introduction: 0, year: 0, month: 0, day: 0 },
    memory: { lastClosing: null, lastExtra: null, dayScene: null, dayScenePicked: false, newSequence: false },
    island,
    sequence: { queue: [], position: 0, slot: 0, holiday: 0, spot: 0, heading: 0 },
    startTime: 900,
  };
}

export function resetIslandFlags(flags: IslandFlags): void {
  Object.assign(flags, { place: NO_PLACE, lowTide: NO_TIDE, mode: MODE_ISLAND, still: false, noRaft: false, holidayShown: true });
}

export function applySceneFlags(flags: IslandFlags, entry: SceneEntry): void {
  if (entry.flags & SCENE_NO_LOW_TIDE) flags.lowTide = 0;
  if (entry.flags & SCENE_NO_RAFT) flags.noRaft = true;
  if (entry.flags & SCENE_NO_HOLIDAY) flags.holidayShown = false;
  if (entry.flags & SCENE_STILL) flags.still = true;
  if (entry.flags & SCENE_NIGHT) flags.mode = MODE_NIGHT;
  if (entry.flags & SCENE_NO_ISLAND) flags.mode = MODE_NO_ISLAND;
  if (flags.place === NO_PLACE && entry.place & PLACE_BITS) flags.place = 0;
  if (entry.place & PLACE_LEFT) flags.place = 1;
  else if (entry.place & PLACE_LOW) flags.place = 2;
  for (const [from, to] of PLACE_QUARTERS) if (entry.place & from) flags.place |= to;
}

export function fitsIsland(place: number, entryPlace: number): boolean {
  if (place === NO_PLACE) return true;
  if (entryPlace & 0x20 && place & 0x2a) return false;
  if (entryPlace & 0x10 && place & 0x15) return false;
  if (entryPlace & 0x01) {
    if (!(entryPlace & 0x02) && place & 0x2a) return false;
    if (!(entryPlace & 0x04) && place & 0x30) return false;
  }
  if (entryPlace & 0x02) {
    if (!(entryPlace & 0x01) && place & 0x15) return false;
    if (!(entryPlace & 0x08) && place & 0x30) return false;
  }
  if (entryPlace & 0x04) {
    if (!(entryPlace & 0x08) && place & 0x2a) return false;
    if (!(entryPlace & 0x01) && place & 0x0c) return false;
  }
  if (entryPlace & 0x08) {
    if (!(entryPlace & 0x04) && place & 0x15) return false;
    if (!(entryPlace & 0x02) && place & 0x0c) return false;
  }
  return true;
}

export function advanceDays(world: StoryWorld, clock: WallClock): void {
  const { days, memory } = world;
  if (days.year !== clock.year || days.month !== clock.month || days.day !== clock.day) {
    if (days.numDays < days.introduction) days.numDays++;
    if (days.numDays > LAST_DAY || days.numDays < 2) {
      days.introduction = 1;
      days.numDays = 1;
    }
    days.year = clock.year;
    days.month = clock.month;
    days.day = clock.day;
  }
  if (memory.newSequence && memory.dayScenePicked && days.introduction <= days.numDays) days.introduction++;
  memory.dayScenePicked = false;
  memory.newSequence = false;
}

export function pickScene(world: StoryWorld, kind: number, slot: number, budget: number): SceneEntry | null {
  const { random, days, island } = world;
  if (kind === KIND_CLOSING) {
    budget = UNLIMITED_BUDGET;
  } else if (kind === KIND_DAY) {
    if (random.next() % 10 !== 0) return null;
    days.introduction = days.numDays;
    budget = UNLIMITED_BUDGET;
  }
  const marked: SceneEntry[] = [];
  let total = 0;
  for (const entry of SCENES) {
    const matches = kind === KIND_DAY && entry.day === days.introduction
      || (entry.flags & kind) !== 0 && entry.tag !== 0 && entry.fromSlot <= slot && entry.day === 0
        && slot < entry.toSlot && Math.trunc(entry.length / 2) < budget && fitsIsland(island.place, entry.place);
    if (!matches) continue;
    marked.push(entry);
    total += entry.weight;
  }
  if (total === 0) return null;
  let left = (random.next() % total) + 1;
  for (const entry of marked) {
    left -= entry.weight;
    if (left <= 0) return entry;
  }
  return null;
}

export function buildQueue(world: StoryWorld, slot: number): SceneEntry[] {
  const { random, memory, island, days } = world;
  let closing: SceneEntry | null = null;
  let extra: SceneEntry | null = null;
  const day = pickScene(world, KIND_DAY, slot, 0);
  if (day && day !== memory.lastClosing && day !== memory.lastExtra) {
    memory.dayScene = day;
    if (day.flags & SCENE_CLOSES) closing = day;
    else extra = day;
  }
  while (!closing || closing === memory.lastClosing || (extra && closing.flags & SCENE_OPENS)) {
    closing = pickScene(world, KIND_CLOSING, slot, 0);
  }
  let budget = SEQUENCE_BUDGET - closing.length;
  applySceneFlags(island, closing);
  memory.lastClosing = closing;
  if (extra) {
    budget -= extra.length;
    applySceneFlags(island, extra);
  }
  memory.lastExtra = extra;
  if (closing.day === days.introduction || extra?.day === days.introduction) memory.dayScenePicked = true;

  const queue: SceneEntry[] = [];
  let extraLeft = extra !== null;
  if (closing.flags & SCENE_OPENS) {
    budget = 0;
  } else if (extra && extra.flags & SCENE_OPENS && random.percent(50) !== 0) {
    queue.push(extra);
    extraLeft = false;
  } else {
    const opening = pickScene(world, KIND_OPENING, slot, budget);
    if (!opening) return [];
    queue.push(opening);
    budget -= opening.length;
    applySceneFlags(island, opening);
  }
  while (budget !== 0 && queue.length < QUEUE_LIMIT) {
    if (extraLeft && random.percent(5) !== 0) {
      queue.push(extra!);
      extraLeft = false;
      continue;
    }
    const entry = pickScene(world, KIND_MIDDLE, slot, budget);
    if (!entry) break;
    let count = 1;
    if (entry.flags & SCENE_REPEATS) {
      do {
        do count = random.percent(10, 20, 30, 20, 10, 10); while (count === 0);
      } while (count > 1 && entry.length * count > budget);
    }
    for (; count !== 0 && queue.length < QUEUE_LIMIT; count--) {
      queue.push(entry);
      budget -= entry.length;
      applySceneFlags(island, entry);
    }
  }
  queue.push(closing);
  return queue;
}

export function newSequence(world: StoryWorld, clock: WallClock): void {
  const { sequence } = world;
  sequence.queue = [];
  sequence.position = 0;
  sequence.slot = timeSlot(clock, world.startTime);
  sequence.holiday = holidayOf(clock);
  resetIslandFlags(world.island);
  advanceDays(world, clock);
  sequence.queue = buildQueue(world, sequence.slot);
  const first = sequence.queue[0];
  if (first) {
    sequence.spot = first.spotStart;
    sequence.heading = first.hdgStart;
  }
}
