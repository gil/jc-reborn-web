import { describe, expect, it } from 'vitest';
import { hasFixture, readFixtureRows } from '../../testing/corpus.js';
import { DirtyLists, type ReplayEvent } from './dirty.js';

type Op = [string, ...unknown[]];

function eventRow(event: ReplayEvent): unknown[] {
  return event.kind === 'copy'
    ? ['copy', event.source, event.target, event.x, event.y, event.w, event.h]
    : ['bits', event.target, event.saved, event.x, event.y, event.w, event.h];
}

describe.skipIf(!hasFixture('graphics/dirty.tsv'))('dirty-rect lists match the original SCRANTIC.SCR', () => {
  it('ends every random operation with the same result and the same lists', () => {
    // SCRANTIC 1060:007e 1060:03d3 1060:046e 1060:04b2 1060:05a7 1060:05f9 1060:06ac
    const pairs = new Map<number, Array<[number, number]>>();
    for (const [which, source, target] of readFixtureRows('graphics/restore-table.tsv')) {
      pairs.set(Number(which), [...(pairs.get(Number(which)) ?? []), [Number(source), Number(target)]]);
    }
    let lists = new DirtyLists(640, 480);
    let sequence = '';
    const wrong: string[] = [];
    for (const [sequenceId, step, opText, resultText, listsText] of readFixtureRows('graphics/dirty.tsv')) {
      if (sequenceId !== sequence) {
        sequence = sequenceId!;
        lists = new DirtyLists(640, 480);
      }
      const [name, ...args] = JSON.parse(opText!) as Op;
      const n = args as number[];
      let result: unknown = null;
      if (name === 'add') {
        const clip = args[8] as number[] | null;
        lists.add(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!, n[6]!, n[7]!, clip && { x1: clip[0]!, y1: clip[1]!, x2: clip[2]!, y2: clip[3]! }, n[9]!);
      } else if (name === 'overlaps') {
        result = lists.overlaps(n[0]!, n[1]!, n[2]!, n[3]!, n[4]!, n[5]!);
      } else if (name === 'drop') {
        lists.drop(n[0]!, n[1]!, n[2]!);
      } else if (name === 'clear') {
        lists.clear();
      } else if (name === 'replay') {
        result = lists.replay(n[0]!, n[1]!, n[2]!).map(eventRow);
      } else if (name === 'restore') {
        result = lists.restorePass(pairs.get(n[0]!)!, n[0] === 0).map(eventRow);
      }
      const snapshot = lists.snapshot().map(([slot, rects]) => [slot, rects.map((r) => [r.x, r.y, r.w, r.h, r.source, r.target, r.kind, r.age, r.area, r.saved])]);
      if (JSON.stringify(result) !== resultText || JSON.stringify(snapshot) !== listsText) wrong.push(`${sequenceId}/${step} ${opText}`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });
});
