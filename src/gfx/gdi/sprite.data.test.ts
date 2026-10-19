import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../decode/bmp.js';
import { hasCorpus, loadArchive } from '../../testing/corpus.js';
import { drawSprite, FLIP_VERTICAL, MIRROR, spriteSurface } from './sprite.js';
import { makeDrawState, makeSurface } from './surface.js';

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

});
