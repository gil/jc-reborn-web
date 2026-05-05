import { describe, it, expect, vi } from 'vitest';
import { calcPath } from './calcpath.js';
import { UNDEF_NODE, NUM_OF_NODES, walkMatrix } from './calcpath-data.js';

function isValidPath(path: number[]): boolean {
  if (!path.length) return false;
  // Must end with UNDEF_NODE
  if (path[path.length - 1] !== UNDEF_NODE) return false;
  // Each consecutive pair of nodes must be connected in walkMatrix
  // First step uses prev=UNDEF_NODE, subsequent steps use prior node
  for (let i = 0; i < path.length - 1; i++) {
    const cur = path[i]!;
    if (cur === UNDEF_NODE) return false;
    const next = path[i + 1]!;
    if (next === UNDEF_NODE) break; // terminator reached
    const prev = i === 0 ? UNDEF_NODE : path[i - 1]!;
    if (!walkMatrix[prev]![cur]![next]) return false;
  }
  return true;
}

describe('calcPath', () => {
  it('A→E: produces a valid path that starts at A and ends at E', () => {
    for (let trial = 0; trial < 5; trial++) {
      const path = calcPath(0, 4);
      expect(path[0]).toBe(0);
      expect(path[path.length - 2]).toBe(4);
      expect(isValidPath(path)).toBe(true);
    }
  });

  it('A→A: same-spot path', () => {
    const path = calcPath(0, 0);
    expect(path).toEqual([0, UNDEF_NODE]);
  });

  it('B→D: multi-hop path is valid and starts/ends correctly', () => {
    // Multiple possible paths; verify any chosen path is valid
    for (let trial = 0; trial < 5; trial++) {
      const path = calcPath(1, 3);
      expect(path[0]).toBe(1);                            // starts at B
      expect(path[path.length - 1]).toBe(UNDEF_NODE);     // ends with sentinel
      expect(path[path.length - 2]).toBe(3);              // reaches D
      expect(isValidPath(path)).toBe(true);
    }
  });

  it('D→B: multi-hop path is valid', () => {
    for (let trial = 0; trial < 5; trial++) {
      const path = calcPath(3, 1);
      expect(path[0]).toBe(3);
      expect(path[path.length - 2]).toBe(1);
      expect(isValidPath(path)).toBe(true);
    }
  });

  it('every spot pair with a direct connection returns the direct path when rand=0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // A→F is a direct connection (walkMatrix[UNDEF][0][5] = 1)
    const path = calcPath(0, 5);
    expect(path[0]).toBe(0);
    expect(path[path.length - 2]).toBe(5);
    expect(isValidPath(path)).toBe(true);
    vi.restoreAllMocks();
  });

  it('path length never exceeds NUM_OF_NODES + 1 (no cycles)', () => {
    for (let from = 0; from < NUM_OF_NODES; from++) {
      for (let to = 0; to < NUM_OF_NODES; to++) {
        const path = calcPath(from, to);
        expect(path.length).toBeLessThanOrEqual(NUM_OF_NODES + 1);
        expect(isValidPath(path)).toBe(true);
      }
    }
  });
});
