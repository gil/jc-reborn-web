import { clockTick, makeTimers } from '../engine/timers.js';
import { drawIsland, makeIsland } from '../island/island.js';
import type { ParsedArchive } from '../resource/types.js';
import { StoryRandom } from '../story/random.js';
import { makeStoryWorld } from '../story/sequence.js';
import { isAtSpot } from '../story/story.js';
import { loadWalk, makeWalk, walkReset, walkStep, type Walk } from '../walk/walk.js';
import { RecordingIslandDevice } from './island-recorder.js';

export const WALK_CASES = 36;
const LEGS = 6;
const IDLE_BEATS = 8;
const LEG_BEATS = 1500;
const STEP_MS = 50;
const TICK_MS = 16;
const SPOTS = 6;
const HEADINGS = 8;
const DISCARD_STEP = 1009;

function beatTicks(beat: number): number {
  return Math.floor((STEP_MS * (beat + 1)) / TICK_MS) - Math.floor((STEP_MS * beat) / TICK_MS);
}

function legTarget(k: number, leg: number): [spot: number, heading: number] {
  const spot = leg === 0 ? 1 + (k % SPOTS) : (k + 3 * leg) % (SPOTS + 1);
  return [spot, (3 * k + 5 * leg + 1) % HEADINGS];
}

function stateRow(walk: Walk, random: StoryRandom): (string | number)[] {
  const { sequence } = walk.island.world;
  return [
    sequence.spot, sequence.heading, walk.targetSpot, walk.targetHeading, walk.wantedHeading, walk.segmentHeading, walk.segmentSpot,
    walk.routeFrom ? `${walk.routeFrom},${walk.routeTo}` : 0,
    walk.segment ? `${walk.segment}:${walk.record}` : 0,
    walk.frameSegment ? `${walk.frameSegment}:${walk.frameRecord}` : 0,
    walk.island.timers.walk, random.writeIndex,
  ];
}

export function traceWalkCase(archive: ParsedArchive, k: number): string[] {
  const device = new RecordingIslandDevice(archive);
  const random = new StoryRandom();
  const world = makeStoryWorld(random);
  const timers = makeTimers();
  const island = makeIsland(device, world, timers, { background: true, clouds: true, waves: true });
  drawIsland(island);
  Object.assign(world.island, { mode: 0, place: 0xffff, lowTide: k % 2, still: false, noRaft: false, holidayShown: true });
  world.sequence.holiday = 0;
  world.sequence.slot = 0;
  world.days.numDays = 1;
  random.discard(DISCARD_STEP * k);
  device.restart();
  drawIsland(island);
  const walk = makeWalk(island);
  loadWalk(walk);
  world.sequence.spot = 1 + Math.floor(k / SPOTS);
  world.sequence.heading = k % HEADINGS;
  device.events.length = 0;

  const rows: string[] = [];
  const flushEvents = (beat: number) => {
    for (const [event, ...values] of device.events) rows.push([k, beat, event, values.join(' ')].join('\t'));
    device.events.length = 0;
  };
  const flush = (beat: number) => {
    flushEvents(beat);
    rows.push([k, beat, 'state', stateRow(walk, random).join(' ')].join('\t'));
  };
  const stepOrStop = (beat: number, leg: number): boolean => {
    const eventsBefore = device.events.length;
    const lostBefore = walk.lostRoutes;
    walkStep(walk);
    if (walk.lostRoutes === lostBefore) return true;
    device.events.length = eventsBefore;
    flushEvents(beat);
    rows.push([k, beat, 'bad', leg].join('\t'));
    return false;
  };
  let beats = 0;
  const startBeat = () => {
    for (let i = beatTicks(beats); i > 0; i--) clockTick(timers);
    return beats++;
  };

  flush(-1);
  for (let leg = 0; leg < LEGS; leg++) {
    if (leg % 2 === 1) {
      world.sequence.spot = 1 + ((k + leg) % SPOTS);
      world.sequence.heading = (2 * k + leg) % HEADINGS;
    } else if (leg > 0) {
      for (let i = 0; i < IDLE_BEATS; i++) {
        const beat = startBeat();
        if (i === 0) {
          device.events.push(['reset', leg]);
          walkReset(walk);
        }
        if (!stepOrStop(beat, leg)) return rows;
        flush(beat);
      }
    }
    const [spot, heading] = legTarget(k, leg);
    let arrived = false;
    for (let i = 0; i < LEG_BEATS && !arrived; i++) {
      const beat = startBeat();
      arrived = isAtSpot(walk, spot, heading);
      device.events.push(['at', leg, spot, heading, arrived ? 1 : 0]);
      if (!arrived && !stepOrStop(beat, leg)) return rows;
      flush(beat);
    }
    if (!arrived) rows.push([k, beats - 1, 'stuck', leg].join('\t'));
  }
  return rows;
}
