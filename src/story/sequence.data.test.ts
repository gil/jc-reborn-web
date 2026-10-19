import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../testing/corpus.js';
import type { WallClock } from './calendar.js';
import { StoryRandom } from './random.js';
import type { SceneEntry } from './scene-table.js';
import { makeStoryWorld, newSequence, type StoryWorld } from './sequence.js';

const CASES = 16;
const BUILDS = 30;
const DISCARDS = [0, 1, 55, 56, 1000, 4096, 31337, 65535];
const START_TIMES = [900, 0, 1230, 2330];
const FIRST_DATES = [[1992, 10, 29], [1992, 12, 24], [1992, 12, 31], [1993, 1, 1], [1993, 3, 16], [1992, 6, 1]] as const;

function buildClock(k: number, b: number): WallClock {
  const [year, month, day] = FIRST_DATES[k % FIRST_DATES.length]!;
  const ms = Date.UTC(year, month - 1, day, (3 * k) % 24, (7 * k) % 60) + (Math.trunc(b / 3) * 1440 + 97 * b) * 60_000;
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const index = (entry: SceneEntry | null) => entry?.index ?? -1;
const bit = (value: boolean) => (value ? 1 : 0);

function stateRow(world: StoryWorld, random: StoryRandom): number[] {
  const { sequence, days, island, memory } = world;
  return [
    sequence.slot, sequence.holiday, days.numDays, days.introduction, days.year, days.month, days.day,
    island.place, island.lowTide, island.mode, bit(island.still), bit(island.noRaft), bit(island.holidayShown),
    sequence.spot, sequence.heading, index(memory.lastClosing), index(memory.lastExtra), index(memory.dayScene),
    bit(memory.dayScenePicked), bit(memory.newSequence), random.writeIndex,
  ];
}

function traceCase(k: number): string[] {
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  world.days = { numDays: k % 13, introduction: (5 * k) % 13, ...(k % 2 ? { year: 1992, month: 6, day: 1 } : { year: 0, month: 0, day: 0 }) };
  world.startTime = START_TIMES[k % START_TIMES.length]!;
  random.discard(DISCARDS[k % DISCARDS.length]!);
  const rows: string[] = [];
  for (let b = 0; b < BUILDS; b++) {
    world.memory.newSequence = true;
    newSequence(world, buildClock(k, b));
    rows.push([k, b, 'queue', world.sequence.queue.map((entry) => entry.index).join(' ')].join('\t'));
    rows.push([k, b, 'state', stateRow(world, random).join(' ')].join('\t'));
  }
  return rows;
}

describe.skipIf(!hasFixture('story/sequences.tsv'))('sequence builder matches the original SCRANTIC.SCR', () => {
  it('builds the same queues and state over 16 cases of 30 sequences', () => {
    // SCRANTIC 1018:0540 1018:0b87 1018:089b 1018:0d50 1018:0eb5 1010:1c41 1018:1e60 1018:1ef5
    const original = new Map<number, string[]>();
    for (const [k, b, event, values] of readFixtureRows('story/sequences.tsv')) {
      const key = Number(k);
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([k, b, event, values ?? ''].join('\t'));
    }
    expect([...original.keys()]).toEqual(Array.from({ length: CASES }, (_, k) => k));
    const wrong: string[] = [];
    for (const [k, rows] of original) {
      const ours = traceCase(k);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`case ${k} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`case ${k}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});
