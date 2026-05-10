import type { Layer, Sprite } from '../types.js';
import type { TtmResource } from '../decode/ttm-loader.js';
import { makeLayer } from '../gfx/layer.js';

export const MAX_BMP_SLOTS = 6;

export interface TtmSlot {
  ttm: TtmResource | null;
  sprites: (Sprite[])[]; // [bmpSlotIdx][spriteIdx]
}

export interface TtmThread {
  slot: TtmSlot;
  isRunning: 0 | 1 | 2;        // 0=free 1=active 2=expired
  sceneSlot: number;
  sceneTag: number;
  sceneTimer: number;
  sceneIterations: number;
  ip: number;                  // instruction pointer into bytecode
  delay: number;               // frame delay (ticks)
  timer: number;               // countdown
  nextGotoOffset: number;
  selectedBmpSlot: number;
  fgColor: number;
  bgColor: number;
  layer: Layer;
  // Set by TIMER opcode so adsTick can apply the timer's delay then reset it,
  // preventing a double-wait when TIMER is immediately followed by UPDATE.
  timerYield: boolean;
}

export function makeThread(): TtmThread {
  return {
    slot: { ttm: null, sprites: Array.from({ length: MAX_BMP_SLOTS }, () => []) },
    isRunning: 0,
    sceneSlot: 0, sceneTag: 0, sceneTimer: 0, sceneIterations: 0,
    ip: 0, delay: 4, timer: 0, nextGotoOffset: 0,
    selectedBmpSlot: 0, fgColor: 15, bgColor: 0,
    layer: makeLayer(),
    timerYield: false,
  };
}
