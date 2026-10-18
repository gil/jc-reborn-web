import { describe, expect, it } from 'vitest';
import { hasFixture, loadArchive, readFixtureRows } from '../testing/corpus.js';
import { traceTtm } from '../testing/ttm-recorder.js';

describe.skipIf(!hasFixture('ttm/traces.tsv'))('TTM page runner matches the original SCRANTIC.SCR', () => {
  it('makes the same calls and results on every page of every TTM script, first run and replay', () => {
    // SCRANTIC 1050:074a 1058:040c 1058:0000 1058:0144 1058:1510 1050:0a85 1050:0b31 1050:0b74
    const archive = loadArchive();
    const original = new Map<string, string[]>();
    for (const [ttm, page, pass, event, values] of readFixtureRows('ttm/traces.tsv')) {
      if (!original.has(ttm!)) original.set(ttm!, []);
      original.get(ttm!)!.push([page, pass, event, values ?? ''].join('\t'));
    }
    expect(original.size).toBe(41);
    const wrong: string[] = [];
    for (const [name, rows] of original) {
      const ours = traceTtm(archive, name);
      const at = ours.findIndex((row, i) => row !== rows[i]);
      if (at >= 0) wrong.push(`${name} row ${at}: ours ${ours[at]}; original ${rows[at] ?? '(end)'}`);
      else if (ours.length !== rows.length) wrong.push(`${name}: ours ${ours.length} rows, original ${rows.length}`);
    }
    expect(wrong).toEqual([]);
  });
});
