export type Palette = Uint8Array; // length 64 = 16 entries × RGBA

export interface Sprite {
  width: number;
  height: number;
  indexed: Uint8Array; // width*height palette indices
}

export interface Rect { x: number; y: number; w: number; h: number; }

export interface Layer {
  indexed: Uint8Array;       // 640*480 palette indices, 0xFF = transparent
  clip: Rect;                // current clip rect
}

export const SCREEN_W = 640;
export const SCREEN_H = 480;
export const TRANSPARENT = 0xff;
