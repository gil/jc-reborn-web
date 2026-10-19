import { describe, expect, it } from 'vitest';
import { ascii, chunk, concat, storedBody, words } from '../testing/build-chunks.js';
import { decodeAds } from './ads-loader.js';

const BYTECODE = words(1, 0x1510, 0xffff);

function adsPayload(): Uint8Array {
  const res = concat(words(2, 1), ascii('A.TTM\0'), words(3), ascii('BB.TTM\0'));
  const tag = concat(words(1, 1), ascii('first\0'));
  const ads = concat(chunk('RES:', res), chunk('SCR:', storedBody(BYTECODE)), chunk('TAG:', tag));
  return concat(chunk('VER:', ascii('4.09\0')), chunk('ADS:', ads, true));
}

describe('decodeAds', () => {
  // SCRANTIC 1048:0079
  it('reads the id and name of every resource in ADS:RES:', () => {
    expect(decodeAds(adsPayload()).subResources).toEqual([
      { slot: 1, name: 'A.TTM' },
      { slot: 3, name: 'BB.TTM' },
    ]);
  });

  // SCRANTIC 1048:0079 1048:04fc
  it('unpacks ADS:SCR: and indexes its sections', () => {
    const ads = decodeAds(adsPayload());
    expect(ads.bytecode).toEqual(BYTECODE);
    expect(ads.sections).toEqual([{ tag: 1, offset: 2 }]);
  });

  it('keeps ADS:TAG: names for the debug page', () => {
    expect(decodeAds(adsPayload()).tags).toEqual([{ id: 1, description: 'first' }]);
  });

  it('refuses an ADS without ADS:RES: or ADS:SCR:', () => {
    expect(() => decodeAds(chunk('ADS:', chunk('RES:', words(0)), true))).toThrow(/missing/);
  });
});
