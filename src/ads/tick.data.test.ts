import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { traceAdsSection } from '../testing/ads-trace.js';
import { hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';

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
