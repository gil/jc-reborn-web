export type Palette = Uint8Array; // length 64 = 16 entries × RGBA

export interface Sprite {
  width: number;
  height: number;
  indexed: Uint8Array; // width*height palette indices
}

export const SCREEN_W = 640;
export const SCREEN_H = 480;
export const TRANSPARENT = 0xff;
