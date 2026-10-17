import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../decode/bmp.js';
import { hasCorpus, loadArchive } from '../../testing/corpus.js';
import { SCREEN_H, SCREEN_W, TRANSPARENT } from '../../types.js';
import { makeLayer } from '../layer.js';
import { drawSprite as drawLayerSprite, drawSpriteFlip as drawLayerSpriteFlip } from '../sprite.js';
import { drawSprite, FLIP_VERTICAL, MIRROR, spriteSurface } from './sprite.js';
import { makeDrawState, makeSurface, type Surface } from './surface.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

describe.skipIf(!hasCorpus)('every BMP image drawn by the model', () => {
  it('keeps its pixels for flags 0, 1, 2, and 3', () => {
    // SCRANTIC 1038:0ae4
    const hashes = Object.fromEntries(
      bitmaps().map(({ name, payload }) => {
        const hash = createHash('sha256');
        for (const sprite of decodeBmp(payload).sprites) {
          const image = spriteSurface(sprite);
          for (const flags of [0, FLIP_VERTICAL, MIRROR, FLIP_VERTICAL | MIRROR]) {
            const surface = makeSurface(sprite.width, sprite.height);
            drawSprite(surface, makeDrawState(), image, 0, 0, flags);
            hash.update(surface.pixels);
          }
        }
        return [name, hash.digest('hex')];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });

  it('matches the old layer pipeline for plain and mirrored sprites', () => {
    // SCRANTIC 1038:0ae4
    const layer = makeLayer();
    const sameInSpriteRect = (surface: Surface) => {
      let same = true;
      for (let y = 0; y < Math.min(surface.height, SCREEN_H); y++) {
        for (let x = 0; x < surface.width; x++) {
          const old = layer.indexed[y * SCREEN_W + x]!;
          if (surface.pixels[y * surface.width + x] !== (old === TRANSPARENT ? 0 : old)) same = false;
          layer.indexed[y * SCREEN_W + x] = TRANSPARENT;
        }
      }
      return same;
    };
    const wrong = bitmaps().flatMap(({ name, payload }) =>
      decodeBmp(payload).sprites.flatMap((sprite, i) => {
        if (sprite.width > SCREEN_W) return [];
        const image = spriteSurface(sprite);
        return [0, MIRROR].flatMap((flags) => {
          (flags ? drawLayerSpriteFlip : drawLayerSprite)(layer, sprite, 0, 0);
          const surface = makeSurface(sprite.width, sprite.height);
          drawSprite(surface, makeDrawState(), image, 0, 0, flags);
          return sameInSpriteRect(surface) ? [] : [`${name}#${i} flags ${flags}`];
        });
      }),
    );
    expect(wrong).toEqual([]);
  });
});
