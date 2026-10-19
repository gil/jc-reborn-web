import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { Display } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import { ADS_FILES, SCENES } from '../story/scene-table.js';
import { traceAdsSection } from '../testing/ads-trace.js';
import { hasCorpus, hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { GdiDevice } from '../ttm/gdi-device.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { makeAdsState } from './state.js';
import { adsStartSection, adsTick } from './tick.js';

describe.skipIf(!hasFixture('ads/traces.tsv'))('ADS tick matches the original SCRANTIC.SCR', () => {
  it('makes the same scene, section, and page decisions on every section of every ADS script', { timeout: 600_000 }, () => {
    // SCRANTIC 1048:0079 1048:0874 1048:1acb 1048:1925 1048:1519 1048:1223 1048:0cda 1048:196e 1048:0766
    const archive = loadArchive();
    const original = new Map<string, string[]>();
    for (const [ads, tag, tick, event, values] of readFixtureRows('ads/traces.tsv')) {
      const key = `${ads} ${tag}`;
      if (!original.has(key)) original.set(key, []);
      original.get(key)!.push([ads, tag, tick, event, values ?? ''].join('\t'));
    }
    const sections = archive.list
      .filter((resource) => resource.type === '.ADS')
      .flatMap((resource) => decodeAds(resource.payload).sections.map((section) => `${resource.name} ${section.tag}`));
    expect([...original.keys()].sort()).toEqual([...new Set(sections)].sort());
    const wrong: string[] = [];
    for (const [key, rows] of original) {
      const [ads, tag] = key.split(' ');
      const ours = traceAdsSection(archive, ads!, Number(tag));
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`${key} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`${key}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe.skipIf(!hasCorpus)('ADS tick on the display', () => {
  it('plays some page in the first 100 ticks of every scene table entry', { timeout: 120_000 }, () => {
    // SCRANTIC 1048:0874 1048:1acb 1060:03d3
    const archive = loadArchive();
    const scenes = new Set(SCENES.filter((entry) => ADS_FILES.has(entry.ads)).map((entry) => `${ADS_FILES.get(entry.ads)} ${entry.tag}`));
    for (const key of scenes) {
      const [adsName, tag] = key.split(' ') as [string, string];
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const random = () => 0x1234;
      const env = makeTtmEnv(new GdiDevice(display, draw, archive, { playSound: () => {}, random }), draw);
      const state = makeAdsState(decodeAds(archive.byName.get(adsName)!.payload), archive, random);
      adsStartSection(state, Number(tag));
      let ran = false;
      for (let now = 1; now <= 100; now++) {
        if (adsTick(state, env, makePalette(), now)) ran = true;
        display.restorePass(0);
      }
      expect(ran, key).toBe(true);
    }
  });
});
