import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unpackChunk } from '../resource/uncompress.js';
import { concat } from '../testing/build-chunks.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { packNibbles } from '../testing/nibbles.js';
import { decodeBmp } from './bmp.js';
import { chunkBody } from './chunks.js';

const bitmaps = () => loadArchive().list.filter((resource) => resource.type === '.BMP');

describe.skipIf(!hasCorpus)('every BMP resource', () => {
  it('has even widths and a BMP:BIN: exactly as long as its images need', () => {
    // SCRANTIC 1030:000e
    const wrong = bitmaps().flatMap(({ name, payload }) => {
      const needed = decodeBmp(payload).sprites.reduce((total, { width, height }) => total + Math.ceil(width / 2) * height, 0);
      const packedSize = unpackChunk(chunkBody(payload, 'BMP:BIN:')!).length;
      return packedSize === needed ? [] : [`${name}: needs ${needed} bytes, has ${packedSize}`];
    });
    expect(bitmaps()).toHaveLength(117);
    expect(wrong).toEqual([]);
  });

  it('keeps its decoded sprites', () => {
    const hashes = Object.fromEntries(
      bitmaps().map(({ name, payload }) => {
        const { sprites } = decodeBmp(payload);
        const hash = createHash('sha256');
        for (const sprite of sprites) hash.update(sprite.indexed);
        return [name, `${sprites.map(({ width, height }) => `${width}x${height}`).join(',')} ${hash.digest('hex')}`];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/bitmaps.tsv'))('bitmaps match the original SCRANTIC.SCR', () => {
  it('hands the bitmap builder the same sizes and pixels as the original loader', () => {
    // SCRANTIC 1030:124a 1040:0000
    const archive = loadArchive();
    const rows = readFixtureRows('loaders/bitmaps.tsv');
    const wrong = rows.flatMap(([name, widths, heights, file]) => {
      const { sprites } = decodeBmp(archive.byName.get(name!)!.payload);
      const ours = concat(...sprites.map(({ indexed }) => packNibbles(indexed)));
      const same =
        sprites.map(({ width }) => width).join(',') === widths &&
        sprites.map(({ height }) => height).join(',') === heights &&
        Buffer.from(ours).equals(Buffer.from(readFixtureBytes('loaders/' + file!)));
      return same ? [] : [`${name}: original ${widths} x ${heights}`];
    });
    expect(rows).toHaveLength(117);
    expect(wrong).toEqual([]);
  });
});
