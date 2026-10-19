import { SURFACE_A, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { MIRROR } from '../gfx/gdi/sprite.js';
import { redrawIslandOver, type Island } from '../island/island.js';
import type { SpriteSheet } from '../island/island-device.js';
import { MIRRORED_FRAME, ROUTES, SEGMENTS, STANDING_TURNS, WALKING_TURNS, type Route, type RouteChoice, type WalkFrame } from './walk-tables.js';

export const NO_HEADING = -1;
export const NO_SEGMENT = 0;
const WALK_BITMAPS = 'JOHNWALK.BMP';
const FIRST_SPOT = 1;
const FRAME_DELAY = 4;
const ROUTE_PERCENT = 100;
const SPRITE_BITS = 0x7fff;
const HEADING_BITS = 7;
const OPPOSITE = 4;
const WALK_RECTS = [[SURFACE_B, SURFACE_A, 0], [SURFACE_B, SURFACE_A, 1], [SURFACE_C, SURFACE_B, 0]] as const;

export interface Walk {
  island: Island;
  sheet: SpriteSheet | null;
  targetSpot: number;
  targetHeading: number;
  routeFrom: number;
  routeTo: number;
  segment: number;
  record: number;
  frameSegment: number;
  frameRecord: number;
  wantedHeading: number;
  segmentHeading: number;
  segmentSpot: number;
  /** Times the pick fell outside Johnny's group, where the original reads on into garbage (OQ-37). */
  lostRoutes: number;
}

export function makeWalk(island: Island): Walk {
  return {
    island, sheet: null, targetSpot: 0, targetHeading: 0, routeFrom: 0, routeTo: 0, segment: 0, record: 0,
    frameSegment: 0, frameRecord: 0, wantedHeading: 0, segmentHeading: 0, segmentSpot: 0, lostRoutes: 0,
  };
}

export function loadWalk(walk: Walk): boolean {
  if (!walk.sheet) {
    walk.sheet = walk.island.device.loadSheet(WALK_BITMAPS);
    const { sequence } = walk.island.world;
    walk.targetSpot = FIRST_SPOT;
    sequence.spot = FIRST_SPOT;
    sequence.heading = 0;
  }
  return walk.sheet !== null;
}

export function routeOf(from: number, to: number): Route | null {
  if (from === 0 || to === 0) return null;
  return ROUTES[from - 1]?.[to - 1] ?? null;
}

export function segmentFrames(id: number): readonly WalkFrame[] | null {
  return id >= 1 && id < SEGMENTS.length ? SEGMENTS[id]!.frames : null;
}

export function pickSegment(choices: readonly RouteChoice[], value: number): number {
  let i = 0;
  let left = value - choices[0]![1];
  while (left > 0 && ++i < choices.length) left -= choices[i]![1];
  return i < choices.length ? choices[i]![0] : NO_SEGMENT;
}

export function walkReset(walk: Walk): void {
  walk.routeFrom = 0;
  walk.routeTo = 0;
  walk.segment = 0;
  walk.wantedHeading = walk.island.world.sequence.heading;
}

export function walkStep(walk: Walk): void {
  if (walk.island.timers.walk === 0 && !advance(walk)) return;
  drawFrame(walk);
}

function advance(walk: Walk): boolean {
  const { sequence, random } = walk.island.world;
  if (walk.routeFrom === 0 && sequence.spot !== walk.targetSpot && routeOf(sequence.spot, walk.targetSpot)) {
    walk.routeFrom = sequence.spot;
    walk.routeTo = walk.targetSpot;
  }
  if (walk.routeFrom !== 0 && walk.segment === 0) {
    const choices = routeOf(walk.routeFrom, walk.routeTo)![sequence.spot - 1];
    if (!choices) return false;
    const id = pickSegment(choices, random.next() % ROUTE_PERCENT);
    if (id === NO_SEGMENT) loseRoute(walk);
    else startSegment(walk, id);
  }
  if (walk.targetHeading !== NO_HEADING && sequence.spot === walk.targetSpot && sequence.heading === walk.wantedHeading) {
    if (walk.wantedHeading === walk.targetHeading) {
      showTurn(walk, STANDING_TURNS);
      walk.targetHeading = NO_HEADING;
    } else {
      walk.wantedHeading = walk.targetHeading;
    }
  }
  if (sequence.heading !== walk.wantedHeading) {
    sequence.heading = (sequence.heading + turnStep(walk, sequence.heading - walk.wantedHeading)) & HEADING_BITS;
    showTurn(walk, sequence.spot === walk.targetSpot ? STANDING_TURNS : WALKING_TURNS);
  }
  if (walk.segment !== 0 && sequence.heading === walk.wantedHeading) {
    walk.frameSegment = walk.segment;
    walk.frameRecord = walk.record;
    walk.record++;
    if (walk.record === segmentFrames(walk.segment)!.length) endSegment(walk);
  }
  return true;
}

function startSegment(walk: Walk, id: number): void {
  const segment = SEGMENTS[id]!;
  walk.segment = id;
  walk.record = 0;
  walk.wantedHeading = segment.startHeading;
  walk.segmentHeading = segment.endHeading;
  walk.segmentSpot = segment.spot;
}

function loseRoute(walk: Walk): void {
  walk.routeFrom = 0;
  walk.routeTo = 0;
  walk.segment = 0;
  walk.lostRoutes++;
}

function endSegment(walk: Walk): void {
  const { sequence } = walk.island.world;
  sequence.heading = walk.segmentHeading;
  sequence.spot = walk.segmentSpot;
  walk.segment = 0;
  if (sequence.spot !== walk.targetSpot) return;
  walk.routeFrom = 0;
  walk.routeTo = 0;
}

function turnStep(walk: Walk, difference: number): number {
  if (difference === OPPOSITE || difference === -OPPOSITE) return (walk.island.world.random.next() & 1) === 0 ? 1 : -1;
  return difference < -OPPOSITE || (difference > 0 && difference < OPPOSITE) ? -1 : 1;
}

function showTurn(walk: Walk, turns: readonly number[]): void {
  const { sequence } = walk.island.world;
  walk.frameSegment = turns[sequence.spot] ?? 0;
  walk.frameRecord = sequence.heading;
}

function drawFrame(walk: Walk): void {
  const frame = segmentFrames(walk.frameSegment)?.[walk.frameRecord];
  if (!frame || !walk.sheet) return;
  const sprite = frame[0] & SPRITE_BITS;
  const image = walk.sheet.images[sprite];
  if (!image) return;
  const { island } = walk;
  const x = island.x + frame[1];
  const y = island.y + frame[2];
  island.device.drawSprite(walk.sheet, sprite, x, y, frame[0] & MIRRORED_FRAME ? MIRROR : 0);
  redrawIslandOver(island, image, x, y, false);
  for (const [source, target, age] of WALK_RECTS) island.device.addDirtyRect(x, y, image.width, image.height, source, target, age);
  island.timers.walk = FRAME_DELAY;
}
