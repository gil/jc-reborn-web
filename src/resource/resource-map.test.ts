import { describe, expect, it } from 'vitest';
import { parseMap, resourceNameHash } from './resource-map.js';

const POSITIONS = [0, 1, 5, 7];
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

function mapBytes(archiveCount = 1): ArrayBuffer {
  const bytes = new Uint8Array(21 + 2 * 8);
  const view = new DataView(bytes.buffer);
  bytes.set(POSITIONS, 0);
  view.setUint16(4, archiveCount, true);
  bytes.set(ascii('RESOURCE.001'), 6);
  view.setUint16(19, 2, true);
  view.setUint32(21, 0x4a4f93ac, true);
  view.setUint32(25, 0, true);
  view.setUint32(29, 0x4a4ece7d, true);
  view.setUint32(33, 350, true);
  return bytes.buffer;
}

describe('parseMap', () => {
  // SCRANTIC 1018:1771
  it('reads hash positions, the archive name, and (name hash, offset) entries', () => {
    expect(parseMap(mapBytes())).toEqual({
      hashPositions: POSITIONS,
      resFileName: 'RESOURCE.001',
      entries: [
        { nameHash: 0x4a4f93ac, offset: 0 },
        { nameHash: 0x4a4ece7d, offset: 350 },
      ],
    });
  });

  it('refuses a map that lists more than one archive', () => {
    expect(() => parseMap(mapBytes(2))).toThrow(/2 archives/);
  });
});

describe('resourceNameHash', () => {
  // SCRANTIC 1018:195a
  it('matches the hashes stored in RESOURCE.MAP', () => {
    expect(resourceNameHash('JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
    expect(resourceNameHash('JOHNCAST.PAL', POSITIONS)).toBe(0x4a4ece7d);
    expect(resourceNameHash('ACTIVITY.ADS', POSITIONS)).toBe(0x4142dce8);
    expect(resourceNameHash('OCEAN00.SCR', POSITIONS)).toBe(0x4f43a846);
  });

  it('uppercases a to z first', () => {
    expect(resourceNameHash('johnwalk.bmp', POSITIONS)).toBe(0x4a4f93ac);
  });

  it('ignores everything up to the last backslash or colon', () => {
    expect(resourceNameHash('C:\\JC\\JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
    expect(resourceNameHash('A:JOHNWALK.BMP', POSITIONS)).toBe(0x4a4f93ac);
  });

  it('reads zero for positions past the end of a short name', () => {
    expect(resourceNameHash('A.B', POSITIONS)).toBe(0x412e1f1d);
  });
});
