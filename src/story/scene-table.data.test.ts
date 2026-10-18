import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureBytes } from '../testing/corpus.js';
import { encodeScenes, SCENES } from './scene-table.js';

describe.skipIf(!hasFixture('story/scene-table.bin'))('scene table', () => {
  it('equals the table in SCRANTIC.SCR byte for byte', () => {
    // SCRANTIC 1068:1756
    expect(encodeScenes()).toEqual(readFixtureBytes('story/scene-table.bin'));
  });

  it('numbers the entries by position', () => {
    expect(SCENES.map((entry) => entry.index)).toEqual(SCENES.map((_, index) => index));
  });
});
