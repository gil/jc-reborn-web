import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const OUT = fileURLToPath(new URL('../../re/out/', import.meta.url));
const NAMES = fileURLToPath(new URL('./names.json', import.meta.url));

type Row = Record<string, string>;

function readTsv(file: string): Row[] {
  const [header = '', ...rows] = readFileSync(OUT + file, 'utf8').trimEnd().split('\n');
  const keys = header.split('\t');
  return rows.map((row) => Object.fromEntries(row.split('\t').map((value, i) => [keys[i], value])));
}

interface NameEntry {
  name: string;
  signature: string | null;
  callingConvention: string | null;
}

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

describe.skipIf(!existsSync(OUT))('Ghidra export of SCRANTIC.SCR', () => {
  it('lists every function the analysis found', () => {
    expect(readTsv('index.tsv').length).toBeGreaterThanOrEqual(500);
  });

  it('applies every names.json entry', () => {
    const names: Record<string, NameEntry> = JSON.parse(readFileSync(NAMES, 'utf8')).functions;
    const byAddress = new Map(readTsv('index.tsv').map((row) => [row.address, row]));
    for (const [address, entry] of Object.entries(names)) {
      const row = byAddress.get(address);
      expect(row?.name, address).toBe(entry.name);
      if (entry.callingConvention) expect(row?.callingConvention, address).toBe(entry.callingConvention);
      if (entry.signature) expect(normalize(row?.signature ?? ''), address).toBe(normalize(entry.signature));
    }
  });

  it('writes pseudo-C and assembly for every function', () => {
    const files = new Set(readdirSync(OUT + 'functions'));
    for (const row of readTsv('index.tsv')) {
      const base = `${row.address!.replace(':', '_')}_${row.name!.replace(/[^A-Za-z0-9_]/g, '_')}`;
      expect(files.has(`${base}.c`), base).toBe(true);
      expect(files.has(`${base}.asm`), base).toBe(true);
    }
  });

  it('decompiles at least 95% of functions', () => {
    const cFiles = readdirSync(OUT + 'functions').filter((f) => f.endsWith('.c'));
    const failed = cFiles.filter((f) => readFileSync(OUT + 'functions/' + f, 'utf8').startsWith('/* DECOMPILE_FAILED'));
    expect(failed.length / cFiles.length).toBeLessThan(0.05);
  });

  it('links strings to the code that loads their offset', () => {
    const strings = readTsv('strings.tsv');
    const hitsFor = (text: string) => (strings.find((row) => row.text === text)?.scalarHits ?? '').split(',');
    expect(hitsFor('RESOURCE.MAP').some((hit) => hit.endsWith('@1018:1771'))).toBe(true);
    expect(hitsFor('JOHNCAST.PAL').some((hit) => hit.endsWith('@1008:143c'))).toBe(true);
    expect(strings.some((row) => row.text?.includes('ADS:RES:'))).toBe(true);
  });

  it('lists callers of imported Windows functions', () => {
    const row = readTsv('imports.tsv').find((r) => r.import?.endsWith('GETPRIVATEPROFILEINT'));
    expect(row?.callers).toMatch(/^[0-9a-f]{4}:[0-9a-f]{4}/);
  });

  it('exports one relocation per NE relocation record', () => {
    expect(readTsv('relocations.tsv')).toHaveLength(1346);
  });
});
