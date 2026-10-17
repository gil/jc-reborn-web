import type { Sprite } from '../../types.js';
import { activeClip, plot, rawIndices, type ClipRect, type DrawState, type Surface } from './surface.js';

export const FLIP_VERTICAL = 1;
export const MIRROR = 2;

export function spriteSurface(sprite: Sprite): Surface {
  return { width: sprite.width, height: sprite.height, pixels: rawIndices(sprite.indexed) };
}

export function drawSprite(
  surface: Surface,
  state: DrawState,
  image: Surface,
  x: number,
  y: number,
  flags = 0,
  hasMirroredCopy = false,
): void {
  const mirror = (flags & MIRROR) !== 0;
  const flipVertical = (flags & FLIP_VERTICAL) !== 0 && !(mirror && hasMirroredCopy);
  blit(surface, activeClip(surface, state), image, x, y, image.width, image.height, mirror, flipVertical);
}

export function drawSpriteStretched(
  surface: Surface,
  state: DrawState,
  image: Surface,
  x: number,
  y: number,
  flags: number,
  width: number,
  height: number,
): void {
  blit(surface, activeClip(surface, state), image, x, y, width, height, (flags & MIRROR) !== 0, (flags & FLIP_VERTICAL) !== 0);
}

function blit(
  surface: Surface,
  clip: ClipRect,
  image: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror: boolean,
  flipVertical: boolean,
): void {
  for (let j = 0; j < height; j++) {
    const row = Math.floor((j * image.height) / height);
    const sourceY = flipVertical ? image.height - 1 - row : row;
    for (let i = 0; i < width; i++) {
      const column = Math.floor((i * image.width) / width);
      const sourceX = mirror ? image.width - 1 - column : column;
      const index = image.pixels[sourceY * image.width + sourceX]!;
      if (index !== 0) plot(surface, clip, x + i, y + j, index);
    }
  }
}
