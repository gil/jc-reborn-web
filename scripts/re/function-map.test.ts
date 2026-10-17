import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INDEX_PATH,
  MAP_PATH,
  NAMES_PATH,
  readTotalFunctions,
  renderFunctionMap,
  validateNames,
} from './function-map.mjs';

const entry = (overrides: Record<string, unknown> = {}) => ({
  name: 'rtl_lxmul',
  subsystem: 'rtl',
  status: 'named',
  note: 'multiply',
  signature: null,
  callingConvention: null,
  ...overrides,
});

const realNames = () => JSON.parse(readFileSync(NAMES_PATH, 'utf8'));

describe('validateNames', () => {
  it('accepts the committed names.json', () => {
    expect(validateNames(realNames())).toEqual([]);
  });

  it.each([
    ['address format', { '1000:302': entry() }, 'address'],
    ['name format', { '1000:0302': entry({ name: 'LXMUL' }) }, 'name must match'],
    ['name prefix', { '1000:0302': entry({ name: 'gfx_lxmul' }) }, 'prefix'],
    ['subsystem', { '1000:0302': entry({ subsystem: 'math', name: 'math_lxmul' }) }, 'unknown subsystem'],
    ['status', { '1000:0302': entry({ status: 'unknown' }) }, 'status'],
    ['note', { '1000:0302': entry({ note: ' ' }) }, 'note'],
    ['calling convention', { '1000:0302': entry({ callingConvention: '__pascal' }) }, 'calling convention'],
    ['signature type', { '1000:0302': entry({ signature: 42 }) }, 'signature'],
  ])('rejects a bad %s', (_label, functions, message) => {
    expect(validateNames({ functions }).join('\n')).toContain(message);
  });

  it('rejects duplicate names', () => {
    const functions = { '1000:0302': entry(), '1000:0488': entry() };
    expect(validateNames({ functions }).join('\n')).toContain('already used');
  });

  it('rejects entries out of address order', () => {
    const functions = { '1008:0000': entry({ name: 'rtl_b' }), '1000:0302': entry({ name: 'rtl_a' }) };
    expect(validateNames({ functions }).join('\n')).toContain('sorted');
  });
});

describe('renderFunctionMap', () => {
  const names = {
    functions: {
      '1000:0302': entry(),
      '1008:143c': entry({ name: 'decoders_loadPalette', subsystem: 'decoders', status: 'verified', note: 'a | b' }),
    },
  };

  it('groups entries by subsystem in pipeline order', () => {
    const map = renderFunctionMap(names, 590);
    expect(map.indexOf('## rtl')).toBeLessThan(map.indexOf('## decoders'));
    expect(map).not.toContain('## gfx');
  });

  it('reports verified, named, and unknown counts', () => {
    expect(renderFunctionMap(names, 590)).toContain('Functions found by Ghidra: 590. Verified: 1. Named: 1. Unknown: 588.');
  });

  it('works without a Ghidra export', () => {
    expect(renderFunctionMap(names, null)).toContain('Verified: 1. Named: 1.');
  });

  it('escapes pipes in notes', () => {
    expect(renderFunctionMap(names, null)).toContain('a \\| b');
  });

  it('matches the committed docs/re/function-map.md', () => {
    const expected = renderFunctionMap(realNames(), readTotalFunctions(INDEX_PATH));
    expect(readFileSync(MAP_PATH, 'utf8')).toBe(expected);
  });
});
