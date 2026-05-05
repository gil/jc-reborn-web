import { drawSprite, drawSpriteFlip } from '../gfx/sprite.js';
import { clearLayer } from '../gfx/layer.js';
import type { Layer, Sprite } from '../types.js';
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
// Modifies ws in place. Draws one frame to layer using sprites (JOHNWALK.BMP[0])
// and bgSprites (BACKGRND.BMP, for palm tree when behind it).
// dx/dy are the island xPos/yPos offsets applied to all draw coordinates.
export function walkAnimate(
  ws: WalkState,
  layer: Layer,
  sprites: Sprite[],
  bgSprites: Sprite[],
  dx: number,
  dy: number,
): number {
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

  // Draw current frame
  const row = walkData[ws.dataIdx]!;
  clearLayer(layer);

  const sp = sprites[row[3]!];
  if (sp) {
    const x = row[1]! - 1 + dx;
    const y = row[2]! + dy;
    if (row[0]) drawSpriteFlip(layer, sp, x, y);
    else drawSprite(layer, sp, x, y);
  }

  // Redraw palm tree on top when Johnny is behind it
  if (ws.isBehindTree) {
    const trunk = bgSprites[13];
    const leafs = bgSprites[12];
    if (trunk) drawSprite(layer, trunk, 442 + dx, 148 + dy);
    if (leafs) drawSprite(layer, leafs, 365 + dx, 122 + dy);
  }

  return ws.hasArrived ? 80 : 6;
}

// Returns true once the walk has fully completed (hasArrived + delay expired).
export function walkDone(ws: WalkState): boolean {
  return ws.hasArrived && walkData[ws.dataIdx]![1] === 0;
}

// Spot index → name for debug
export const SPOT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export { UNDEF_NODE };
