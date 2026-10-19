import type { ClipRect } from './surface.js';

export const COPY_RECT = 1;
export const SAVED_BITS = 4;
export const NO_SOURCE = -1;
export const LIST_SLOTS = 20;
const MERGE_SLACK = 20;

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
  source: number;
  target: number;
  kind: number;
  age: number;
  area: number;
  saved: number;
}

export type ReplayEvent =
  | { kind: 'copy'; source: number; target: number; x: number; y: number; w: number; h: number }
  | { kind: 'bits'; target: number; saved: number; x: number; y: number; w: number; h: number };

interface Node extends DirtyRect {
  next: Node | null;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const int16 = (value: number) => (value << 16) >> 16;

export class DirtyLists {
  private readonly heads: (Node | null)[] = new Array<Node | null>(LIST_SLOTS).fill(null);

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  add(x: number, y: number, w: number, h: number, kind: number, source: number, target: number, age: number, clip: ClipRect | null, saved = 0): void {
    if (kind === SAVED_BITS) source = NO_SOURCE;
    const slot = this.find(source, target, age);
    if (slot < 0) return;
    let box: Box | null = { x, y, w, h };
    if (kind === COPY_RECT) {
      box = clip ? cutToClip(box, clip) : cutToScreen(box, this.width, this.height);
      if (!box) return;
      box = { x: Math.trunc(box.x / 8), y: box.y, w: Math.trunc((box.w + (box.x % 8) + 7) / 8), h: box.h };
    }
    if (box.w === 0 || box.h === 0) return;
    const node: Node = { ...box, source, target, kind, age, area: int16(box.w * box.h), saved, next: null };
    if (kind === COPY_RECT) this.mergeInto(slot, node);
    node.next = this.heads[slot] ?? null;
    this.heads[slot] = node;
  }

  overlaps(x: number, y: number, w: number, h: number, target: number, age: number): number {
    const left = Math.trunc(x / 8);
    const columns = Math.trunc((w + (x % 8) + 7) / 8);
    for (const head of this.heads) {
      if (!head || head.target !== target || head.age !== age) continue;
      for (let node: Node | null = head; node; node = node.next) {
        if (node.kind === COPY_RECT && node.x < left + columns && left < node.x + node.w && node.y < y + h && y < node.y + node.h) return node.kind;
      }
    }
    return 0;
  }

  drop(source: number, target: number, age: number): void {
    const slot = this.find(source, target, age);
    if (slot >= 0) this.heads[slot] = null;
  }

  clear(): void {
    this.heads.fill(null);
  }

  replay(source: number, target: number, age: number): ReplayEvent[] {
    const slot = this.find(source, target, age);
    const head = slot >= 0 ? this.heads[slot] : null;
    if (!head) return [];
    const events: ReplayEvent[] = [];
    for (let node: Node | null = head; node; node = node.next) {
      if (node.kind === COPY_RECT) {
        events.push({ kind: 'copy', source: head.source, target: head.target, x: node.x * 8, y: node.y, w: node.w * 8, h: node.h });
      } else if (node.kind === SAVED_BITS) {
        events.push({ kind: 'bits', target: head.target, saved: node.saved, x: node.x, y: node.y, w: node.w, h: node.h });
      }
    }
    this.heads[slot] = null;
    return events;
  }

  restorePass(pairs: ReadonlyArray<readonly [number, number]>, ageAfter: boolean): ReplayEvent[] {
    const events = pairs.flatMap(([source, target]) => this.replay(source, target, 0));
    if (ageAfter) {
      for (const head of this.heads) {
        for (let node: Node | null = head; node; node = node.next) node.age -= 1;
      }
    }
    return events;
  }

  snapshot(): Array<[number, DirtyRect[]]> {
    return this.heads.flatMap((head, slot): Array<[number, DirtyRect[]]> => {
      const rects: DirtyRect[] = [];
      for (let node: Node | null = head; node; node = node.next) {
        const { x, y, w, h, source, target, kind, age, area, saved } = node;
        rects.push({ x, y, w, h, source, target, kind, age, area, saved });
      }
      return rects.length ? [[slot, rects]] : [];
    });
  }

  private find(source: number, target: number, age: number): number {
    let empty = -1;
    for (let slot = 0; slot < LIST_SLOTS; slot++) {
      const head = this.heads[slot];
      if (!head) {
        if (empty < 0) empty = slot;
      } else if (head.age === age && head.source === source && head.target === target) {
        return slot;
      }
    }
    return empty;
  }

  private mergeInto(slot: number, added: Node): void {
    let current = this.heads[slot]!;
    let stopAt: Node | null = null;
    let resumeAt: Node | null = null;
    for (;;) {
      let previous: Node | null = null;
      let next: Node | null;
      do {
        if (current === stopAt) return;
        stopAt = resumeAt;
        next = current!.next;
        const left = Math.min(current!.x, added.x);
        const right = Math.max(current!.x + current!.w, added.x + added.w);
        const top = Math.min(current!.y, added.y);
        const bottom = Math.max(current!.y + current!.h, added.y + added.h);
        const area = int16((right - left) * (bottom - top));
        let newPrevious: Node | null = current;
        if (area <= int16(current!.area + added.area + MERGE_SLACK)) {
          Object.assign(added, { x: left, y: top, w: right - left, h: bottom - top, area });
          if (previous) previous.next = next;
          else this.heads[slot] = next;
          stopAt = previous;
          newPrevious = previous;
          resumeAt = next;
        }
        current = next!;
        previous = newPrevious;
      } while (next !== null || stopAt === null);
      current = this.heads[slot]!;
    }
  }
}

function cutToScreen({ x, y, w, h }: Box, width: number, height: number): Box | null {
  if (x > width - 1 || x + w < 0 || y > height - 1 || y + h < 0) return null;
  if (x < 0) {
    w += x;
    x = 0;
  }
  if (y < 0) {
    h += y;
    y = 0;
  }
  if (x + w - 1 > width - 1) w = width - x;
  if (y + h - 1 > height - 1) h = height - y;
  return { x, y, w, h };
}

function cutToClip({ x, y, w, h }: Box, clip: ClipRect): Box | null {
  if (clip.x2 < x || x + w < clip.x1 || clip.y2 < y || y + h < clip.y1) return null;
  if (x < clip.x1) {
    w -= clip.x1 - x;
    x = clip.x1;
  }
  if (y < clip.y1) {
    h -= clip.y1 - y;
    y = clip.y1;
  }
  if (x + w - 1 > clip.x2) w = clip.x2 - x + 1;
  if (y + h - 1 > clip.y2) h = clip.y2 - y + 1;
  return { x, y, w, h };
}
