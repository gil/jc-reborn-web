import { describe, expect, it } from 'vitest';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { chunkBody } from './chunks.js';
import { decodePal } from './pal.js';

const johncast = () => loadArchive().byName.get('JOHNCAST.PAL')!.payload;

describe.skipIf(!hasCorpus)('the real JOHNCAST.PAL', () => {
  it('stores 256 colors with channel levels 0 to 63', () => {
    // SCRANTIC 1068:25b0
    const body = chunkBody(johncast(), 'PAL:VGA:')!;
    expect(body).toHaveLength(768);
    expect(Math.max(...body)).toBeLessThanOrEqual(63);
  });

  it('keeps its decoded colors', () => {
    expect(Array.from(decodePal(johncast()).colors)).toMatchSnapshot();
  });
});

describe.skipIf(!hasFixture('loaders/palette.tsv'))('palette matches the original SCRANTIC.SCR', () => {
  it('gives the same 16 colors as the original loader in 16-color mode', () => {
    // SCRANTIC 1040:09eb
    const original = readFixtureRows('loaders/palette.tsv').flatMap(([, red, green, blue]) => [Number(red), Number(green), Number(blue)]);
    expect(Array.from(decodePal(johncast()).colors)).toEqual(original);
  });
});
