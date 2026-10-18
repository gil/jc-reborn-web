import { decodeBmp } from '../decode/bmp.js';
import { COPY_RECT } from '../gfx/gdi/dirty.js';
import { SURFACE_A, SURFACE_B, SURFACE_C, type Display } from '../gfx/gdi/display.js';
import { drawSprite, MIRROR, spriteSurface } from '../gfx/gdi/sprite.js';
import { makeDrawState, type Surface } from '../gfx/gdi/surface.js';
import type { ParsedArchive } from '../resource/types.js';
import { calcPath } from './calcpath.js';
import { UNDEF_NODE } from './calcpath-data.js';
import {
  walkData,
  walkDataBookmarks,
  walkDataBookmarksTurns,
  walkDataStartHeadings,
  walkDataEndHeadings,
} from './walk-data.js';

export interface WalkState {
  path: number[];
  pathIdx: number;
  currentSpot: number;
  currentHdg: number;
  nextSpot: number;       // -1 when on final segment's last turn
  nextHdg: number;        // -1 when walking forward (no pending turn)
  finalSpot: number;
  finalHdg: number;
  increment: number;
  lastTurn: boolean;
  hasArrived: boolean;
  isBehindTree: boolean;
  dataIdx: number;
}

export function walkInit(fromSpot: number, fromHdg: number, toSpot: number, toHdg: number): WalkState {
  const path = calcPath(fromSpot, toSpot);

  const ws: WalkState = {
    path,
    pathIdx: 0,
    currentSpot: fromSpot,
    currentHdg: fromHdg,
    nextSpot: -1,
    nextHdg: -1,
    finalSpot: toSpot,
    finalHdg: toHdg,
    increment: 0,
    lastTurn: false,
    hasArrived: false,
    isBehindTree: false,
    dataIdx: 0,
  };

  if (fromSpot === toSpot) {
    ws.nextSpot = -1;
    ws.nextHdg = toHdg;
    ws.lastTurn = true;
  } else {
    ws.pathIdx = 1;
    ws.nextSpot = path[1]!;
    ws.nextHdg = walkDataStartHeadings[fromSpot]![ws.nextSpot]!;
    ws.lastTurn = false;
  }

  const diff = (ws.nextHdg - fromHdg) & 0x07;
  if (diff !== 0) ws.increment = diff < 4 ? 1 : -1;

  return ws;
}

// Returns delay ticks: 6 while walking/turning, 80 when just arrived, 0 when done.
// Modifies ws in place.
export function walkAnimate(ws: WalkState): number {
  if (ws.hasArrived) return 0;

  if (ws.nextHdg !== -1) {
    // Turning phase
    if (((ws.nextHdg - ws.currentHdg) & 0x07) % 7 > 1) {
      // Still turning
      ws.currentHdg = (ws.currentHdg + ws.increment) & 7;
      ws.dataIdx = walkDataBookmarksTurns[ws.currentSpot]! + ws.currentHdg;
      if (ws.lastTurn) ws.dataIdx += 9;
    } else {
      // Turn complete
      if (ws.currentSpot !== ws.finalSpot) {
        ws.nextHdg = -1;
        ws.isBehindTree = (ws.currentSpot === 3 && ws.nextSpot === 4)
          || (ws.currentSpot === 4 && ws.nextSpot === 3);
        ws.dataIdx = walkDataBookmarks[ws.currentSpot]![ws.nextSpot]!;
      } else {
        // Arrived at destination
        ws.dataIdx = walkDataBookmarksTurns[ws.finalSpot]! + ws.finalHdg + 9;
        ws.hasArrived = true;
      }
    }
  } else {
    // Walking forward
    ws.dataIdx++;

    const row = walkData[ws.dataIdx]!;
    if (row[1] === 0) {
      // Reached end of walk segment: transition to turn at new spot
      ws.currentHdg = walkDataEndHeadings[ws.currentSpot]![ws.nextSpot]!;
      ws.currentSpot = ws.nextSpot;

      if (ws.currentSpot !== ws.finalSpot) {
        ws.pathIdx++;
        ws.nextSpot = ws.path[ws.pathIdx]!;
        ws.nextHdg = walkDataStartHeadings[ws.currentSpot]![ws.nextSpot]!;
      } else {
        ws.nextHdg = ws.finalHdg;
        ws.lastTurn = true;
      }

      const diff = (ws.nextHdg - ws.currentHdg) & 0x07;
      ws.increment = diff !== 0 ? (diff < 4 ? 1 : -1) : 0;

      ws.currentHdg = (ws.currentHdg + ws.increment) & 7;
      ws.dataIdx = walkDataBookmarksTurns[ws.currentSpot]! + ws.currentHdg;

      if (ws.lastTurn) {
        ws.dataIdx += 9;
        if (ws.currentHdg === ws.finalHdg) ws.hasArrived = true;
      }
    }
  }

  return ws.hasArrived ? 80 : 6;
}

const DRAWN_LISTS = [
  [SURFACE_B, SURFACE_A, 0],
  [SURFACE_B, SURFACE_A, 1],
  [SURFACE_C, SURFACE_B, 0],
] as const;
const unclipped = makeDrawState();

export function walkDraw(ws: WalkState, display: Display, sprites: Surface[], bgSprites: Surface[], dx: number, dy: number): void {
  const [mirrored = 0, x = 0, y = 0, sprNo = 0] = walkData[ws.dataIdx]!;
  drawMarked(display, sprites[sprNo], x - 1 + dx, y + dy, mirrored ? MIRROR : 0);
  // Redraw palm tree on top when Johnny is behind it
  if (ws.isBehindTree) {
    drawMarked(display, bgSprites[13], 442 + dx, 148 + dy, 0);
    drawMarked(display, bgSprites[12], 365 + dx, 122 + dy, 0);
  }
}

export interface WalkContext {
  ws: WalkState;
  sprites: Surface[];
  bgSprites: Surface[];
  dx: number;
  dy: number;
  timer: number;
  done: boolean;
}

export function startWalk(
  archive: ParsedArchive,
  bgSprites: Surface[],
  fromSpot: number, fromHdg: number,
  toSpot: number, toHdg: number,
  dx: number, dy: number,
): WalkContext | null {
  const raw = archive.byName.get('JOHNWALK.BMP');
  if (!raw) {
    console.warn('JOHNWALK.BMP not found');
    return null;
  }
  return {
    ws: walkInit(fromSpot, fromHdg, toSpot, toHdg),
    sprites: decodeBmp(raw.payload).sprites.map(spriteSurface),
    bgSprites,
    dx,
    dy,
    timer: 0,
    done: false,
  };
}

export function walkTick(walk: WalkContext, display: Display, elapsed: number): void {
  if (walk.done) return;
  walk.timer -= elapsed;
  if (walk.timer <= 0) {
    walk.timer = walkAnimate(walk.ws);
    walk.done = walk.timer === 0;
  }
  // Drawn on the tick the walk ends too: the story waits out the arrival rest with Johnny on screen.
  walkDraw(walk.ws, display, walk.sprites, walk.bgSprites, walk.dx, walk.dy);
}

export function walkHold(walk: WalkContext, display: Display): void {
  if (!walk.ws.hasArrived) walkAnimate(walk.ws);
  walkDraw(walk.ws, display, walk.sprites, walk.bgSprites, walk.dx, walk.dy);
}

function drawMarked(display: Display, image: Surface | undefined, x: number, y: number, flags: number): void {
  if (!image) return;
  drawSprite(display.surfaces[SURFACE_B]!, unclipped, image, x, y, flags);
  for (const [source, target, age] of DRAWN_LISTS) {
    display.dirty.add(x, y, image.width, image.height + 2, COPY_RECT, source, target, age, null);
  }
}

export function walkDone(ws: WalkState): boolean {
  return ws.hasArrived && walkData[ws.dataIdx]![1] === 0;
}

export const SPOT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export { UNDEF_NODE };
