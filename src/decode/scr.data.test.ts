import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { unpackChunk } from '../resource/uncompress.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureBytes, readFixtureRows } from '../testing/corpus.js';
import { packNibbles } from '../testing/nibbles.js';
import { chunkBody } from './chunks.js';
import { decodeScr } from './scr.js';

const screens = () => loadArchive().list.filter((resource) => resource.type === '.SCR');

describe.skipIf(!hasCorpus)('every SCR resource', () => {
  it('decodes to width x height pixels and uses every byte of SCR:BIN:', () => {
    // SCRANTIC 1030:16d8
    const wrong = screens().flatMap(({ name, payload }) => {
      const { width, height } = decodeScr(payload);
      const packedSize = unpackChunk(chunkBody(payload, 'SCR:BIN:')!).length;
      return packedSize === (width * height) / 2 ? [] : [`${name}: ${width}x${height}, ${packedSize} packed bytes`];
    });
    expect(screens()).toHaveLength(10);
    expect(wrong).toEqual([]);
  });

  it('keeps its decoded pixels', () => {
    const hashes = Object.fromEntries(
      screens().map(({ name, payload }) => {
        const { width, height, indexed } = decodeScr(payload);
        return [name, `${width}x${height} ${createHash('sha256').update(indexed).digest('hex')}`];
      }),
    );
    expect(hashes).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/screens.tsv'))('screens match the original SCRANTIC.SCR', () => {
  it('hands the screen blitter the same rows as the original loader', () => {
    // SCRANTIC 1030:16d8 1040:0286
    const archive = loadArchive();
    const wrong = readFixtureRows('loaders/screens.tsv').flatMap(([name, status, width, rows, file]) => {
      const scr = decodeScr(archive.byName.get(name!)!.payload);
      const original = readFixtureBytes('loaders/' + file!);
      const same =
        status === '1' &&
        Number(width) === scr.width &&
        Number(rows) === scr.height &&
        Buffer.from(packNibbles(scr.indexed)).equals(Buffer.from(original));
      return same ? [] : [`${name}: original status ${status}, width ${width}, ${rows} rows, ${original.length} bytes`];
    });
    expect(wrong).toEqual([]);
  });
});
