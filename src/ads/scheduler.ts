import { ADS, ADS_ARG_COUNTS } from './opcodes.js';
import { makeThread, type TtmThread, type TtmSlot } from '../ttm/thread.js';
import { ttmPlay, type TtmContext } from '../ttm/interpreter.js';
import { OP } from '../ttm/opcodes.js';
import type { AdsResource } from '../decode/ads-loader.js';
import type { ParsedArchive } from '../resource/types.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import { makeLayer } from '../gfx/layer.js';

const MAX_THREADS = 10;
const OP_ADD_SCENE = 0, OP_STOP_SCENE = 1, OP_NOP = 2;

interface AdsChunk { slot: number; tag: number; offset: number; }
interface RandOp { type: number; slot: number; tag: number; numPlays: number; weight: number; }

export interface AdsState {
  bc: Uint8Array;
  ttmSlots: TtmSlot[];             // indexed by sub-resource slot id
  threads: TtmThread[];            // MAX_THREADS fixed slots
  chunks: AdsChunk[];              // IF_LASTPLAYED bookmarks (global)
  chunksLocal: AdsChunk[];         // IF_LASTPLAYED_LOCAL bookmarks (ACTIVITY.ADS)
  randOps: RandOp[];
  adsTags: Array<{ id: number; offset: number }>;
  stopRequested: boolean;
}

// ------- byte-reader helpers -------

function readU16(bc: Uint8Array, p: number): number {
  return bc[p]! | (bc[p + 1]! << 8);
}

function skipArgs(_bc: Uint8Array, p: number, n: number): number {
  return p + n * 2;
}

// ------- scan phase (adsLoad equivalent) -------

function scanBytecode(bc: Uint8Array, startTag: number): {
  tagOffset: number;
  chunks: AdsChunk[];
  adsTags: Array<{ id: number; offset: number }>;
} {
  const chunks: AdsChunk[] = [];
  const adsTags: Array<{ id: number; offset: number }> = [];
  let p = 0;
  let tagOffset = 0;
  let bookmarkingChunks = false;
  let bookmarkingIfNotRunnings = false;

  while (p < bc.length) {
    const op = readU16(bc, p); p += 2;

    if (op === ADS.IF_LASTPLAYED) {
      const slot = readU16(bc, p); const tag = readU16(bc, p + 2); p += 4;
      if (bookmarkingChunks) {
        bookmarkingIfNotRunnings = false;
        chunks.push({ slot, tag, offset: p });
      }
    } else if (op === ADS.IF_NOT_RUNNING) {
      const slot = readU16(bc, p); const tag = readU16(bc, p + 2); p += 4;
      if (bookmarkingChunks && bookmarkingIfNotRunnings) {
        chunks.push({ slot, tag, offset: p });
      }
    } else if (op === ADS.IF_IS_RUNNING) {
      bookmarkingIfNotRunnings = false;
      p += 4; // 2 args
    } else {
      const argCount = ADS_ARG_COUNTS[op];
      if (argCount !== undefined) {
        p = skipArgs(bc, p, argCount);
      } else {
        // It's a tag opcode (id = opcode value)
        adsTags.push({ id: op, offset: p });
        if (op === startTag) {
          tagOffset = p;
          bookmarkingChunks = true;
          bookmarkingIfNotRunnings = true;
        } else {
          bookmarkingChunks = false;
          bookmarkingIfNotRunnings = false;
        }
      }
    }
  }

  return { tagOffset, chunks, adsTags };
}

// ------- state factory -------

export function makeAdsState(ads: AdsResource, archive: ParsedArchive, startTag: number): AdsState {
  // Build TTM slot array (index = slot id from sub-resource list)
  const maxSlot = Math.max(0, ...ads.subResources.map(s => s.slot));
  const ttmSlots: TtmSlot[] = Array.from({ length: maxSlot + 1 }, () =>
    ({ ttm: null, sprites: Array.from({ length: 6 }, () => []) }),
  );
  for (const sub of ads.subResources) {
    const raw = archive.byName.get(sub.name);
    if (!raw) { console.warn(`ADS sub-resource not found: ${sub.name}`); continue; }
    ttmSlots[sub.slot] = { ttm: decodeTtm(raw.payload), sprites: Array.from({ length: 6 }, () => []) };
  }

  const bc = ads.bytecode;
  const { tagOffset, chunks, adsTags } = scanBytecode(bc, startTag);

  const state: AdsState = {
    bc,
    ttmSlots,
    threads: Array.from({ length: MAX_THREADS }, makeThread),
    chunks,
    chunksLocal: [],
    randOps: [],
    adsTags,
    stopRequested: false,
  };

  // Play the first chunk of the sequence (kicks off initial scenes)
  adsPlayChunk(state, tagOffset);

  return state;
}

// ------- scene management -------

function findAdsTag(state: AdsState, id: number): number {
  return state.adsTags.find(t => t.id === id)?.offset ?? 0;
}

function isSceneRunning(state: AdsState, slot: number, tag: number): boolean {
  return state.threads.some(t => t.isRunning === 1 && t.sceneSlot === slot && t.sceneTag === tag);
}

function adsAddScene(state: AdsState, slotNo: number, tag: number, arg3: number): void {
  // Don't add a duplicate running scene
  if (isSceneRunning(state, slotNo, tag)) return;

  const thread = state.threads.find(t => !t.isRunning);
  if (!thread) { console.warn('no free TTM thread'); return; }

  const slot = state.ttmSlots[slotNo];
  if (!slot) { console.warn(`no TTM slot ${slotNo}`); return; }

  thread.slot = slot;
  thread.isRunning = 1;
  thread.sceneSlot = slotNo;
  thread.sceneTag = tag;
  thread.sceneTimer = 0;
  thread.sceneIterations = 0;
  thread.delay = 4;
  thread.timer = 0;
  thread.nextGotoOffset = 0;
  thread.selectedBmpSlot = 0;
  thread.fgColor = 0x0f;
  thread.bgColor = 0x0f;
  thread.layer = makeLayer();

  // Slot 0: start from beginning; otherwise find tag in TTM bytecode
  if (slotNo === 0) {
    thread.ip = 0;
  } else {
    thread.ip = findTtmTag(slot, tag);
  }

  const arg3s = arg3 as number;
  if ((arg3s << 16 >> 16) < 0) {        // signed negative → time limit
    thread.sceneTimer = -(arg3s << 16 >> 16);
  } else if (arg3s > 0) {               // positive → repeat count
    thread.sceneIterations = arg3s - 1;
  }
}

function findTtmTag(slot: TtmSlot, tag: number): number {
  if (!slot.ttm) return 0;
  const bc = slot.ttm.bytecode;
  const dv = new DataView(bc.buffer, bc.byteOffset);
  let p = 0;
  while (p < bc.length) {
    const op = dv.getUint16(p, true); p += 2;
    const argCount = op & 0x000f;
    if (argCount === 0x0f) {
      while (p < bc.length && dv.getUint8(p++) !== 0) {}
      if (p & 1) p++;
    } else {
      if (op === OP.TAG && p < bc.length) {
        const id = dv.getUint16(p, true);
        if (id === tag) return p + 2; // offset after the TAG + arg
      }
      p += argCount * 2;
    }
  }
  return 0;
}

function adsStopScene(state: AdsState, idx: number): void {
  state.threads[idx]!.isRunning = 0;
}

function adsStopSceneByTag(state: AdsState, slotNo: number, tag: number): void {
  state.threads.forEach((t, i) => {
    if (t.isRunning && t.sceneSlot === slotNo && t.sceneTag === tag) adsStopScene(state, i);
  });
}

// ------- random block -------

export interface RandOpPublic { slot: number; tag: number; weight: number; }

export function adsRandomPickOp(ops: RandOpPublic[]): RandOpPublic {
  const total = ops.reduce((s, o) => s + o.weight, 0);
  const r = Math.floor(Math.random() * total);
  let cum = 0;
  for (const op of ops) {
    cum += op.weight;
    if (r < cum) return op;
  }
  return ops[ops.length - 1]!;
}

function adsRandomEnd(state: AdsState): void {
  if (!state.randOps.length) return;
  const op = adsRandomPickOp(state.randOps) as RandOp;
  if (op.type === OP_ADD_SCENE) adsAddScene(state, op.slot, op.tag, op.numPlays);
  else if (op.type === OP_STOP_SCENE) adsStopSceneByTag(state, op.slot, op.tag);
  state.randOps = [];
}

// ------- chunk player (adsPlayChunk) -------

function adsPlayChunk(state: AdsState, offset: number): void {
  const bc = state.bc;
  let p = offset;
  let inRandBlock = false;
  let inOrBlock = false;
  let inSkipBlock = false;
  let inIfLastplayedLocal = false;
  let continueLoop = true;

  while (continueLoop && p < bc.length) {
    const op = readU16(bc, p); p += 2;

    switch (op) {
      case ADS.IF_LASTPLAYED_LOCAL: {
        const slot = readU16(bc, p); const tag = readU16(bc, p + 2); p += 4;
        inIfLastplayedLocal = true;
        state.chunksLocal.push({ slot, tag, offset: p });
        break;
      }
      case ADS.IF_UNKNOWN_1:
        p += 4; // 2 args, treat as no-op (similar to IF_NOT_RUNNING semantics)
        break;
      case ADS.IF_LASTPLAYED:
        p += 4; // 2 args
        if (!inOrBlock) continueLoop = false;
        inOrBlock = false;
        break;
      case ADS.IF_NOT_RUNNING: {
        const slot = readU16(bc, p); const tag = readU16(bc, p + 2); p += 4;
        if (isSceneRunning(state, slot, tag)) inSkipBlock = true;
        break;
      }
      case ADS.IF_IS_RUNNING: {
        const slot = readU16(bc, p); const tag = readU16(bc, p + 2); p += 4;
        inSkipBlock = !isSceneRunning(state, slot, tag);
        break;
      }
      case ADS.AND:
        break;
      case ADS.OR:
        inOrBlock = true;
        break;
      case ADS.PLAY_SCENE:
        if (inSkipBlock) inSkipBlock = false;
        else continueLoop = false;
        break;
      case ADS.ADD_SCENE_LOCAL: {
        const args = [readU16(bc, p), readU16(bc, p + 2), readU16(bc, p + 4), readU16(bc, p + 6), readU16(bc, p + 8)];
        p += 10;
        if (inIfLastplayedLocal) {
          inIfLastplayedLocal = false; // queued; second pass handled by trigger
        } else {
          adsAddScene(state, args[1]!, args[2]!, args[3]!);
        }
        break;
      }
      case ADS.ADD_SCENE: {
        const s = readU16(bc, p), t = readU16(bc, p + 2), n = readU16(bc, p + 4), w = readU16(bc, p + 6); p += 8;
        if (!inSkipBlock) {
          if (inRandBlock) state.randOps.push({ type: OP_ADD_SCENE, slot: s, tag: t, numPlays: n, weight: w });
          else adsAddScene(state, s, t, n);
        }
        break;
      }
      case ADS.STOP_SCENE: {
        const s = readU16(bc, p), t = readU16(bc, p + 2), w = readU16(bc, p + 4); p += 6;
        if (!inSkipBlock) {
          if (inRandBlock) state.randOps.push({ type: OP_STOP_SCENE, slot: s, tag: t, numPlays: 0, weight: w });
          else adsStopSceneByTag(state, s, t);
        }
        break;
      }
      case ADS.RANDOM_START:
        state.randOps = [];
        inRandBlock = true;
        break;
      case ADS.NOP: {
        const weight = readU16(bc, p); p += 2;
        if (inRandBlock) state.randOps.push({ type: OP_NOP, slot: 0, tag: 0, numPlays: 0, weight });
        break;
      }
      case ADS.RANDOM_END:
        adsRandomEnd(state);
        inRandBlock = false;
        break;
      case ADS.UNKNOWN_6:
        p += 6; // 3 args
        break;
      case ADS.FADE_OUT:
        break;
      case ADS.GOSUB_TAG: {
        const tagId = readU16(bc, p); p += 2;
        adsPlayChunk(state, findAdsTag(state, tagId));
        break;
      }
      case ADS.END:
        if (inSkipBlock) inSkipBlock = false;
        else state.stopRequested = true;
        break;
      case ADS.END_IF:
        break;
      default:
        // Tag opcode — not expected here, skip
        break;
    }
  }
}

function adsPlayTriggeredChunks(state: AdsState, slotNo: number, tag: number): void {
  // Local triggers first (ACTIVITY.ADS tag 7)
  if (state.chunksLocal.length) {
    for (let i = state.chunksLocal.length - 1; i >= 0; i--) {
      const c = state.chunksLocal[i]!;
      if (c.slot === slotNo && c.tag === tag) {
        state.chunksLocal.splice(i, 1);
        adsPlayChunk(state, c.offset);
      }
    }
    return;
  }
  // Global IF_LASTPLAYED chunks
  for (const c of state.chunks) {
    if (c.slot === slotNo && c.tag === tag) {
      adsPlayChunk(state, c.offset);
    }
  }
}

// ------- per-frame tick (browser rAF adaptation of adsPlay loop) -------

export function adsTick(state: AdsState, elapsedTicks: number, ttmCtx: TtmContext): void {
  // Decrement all active timers
  for (const t of state.threads) {
    if (t.isRunning) t.timer -= elapsedTicks;
  }

  for (let i = 0; i < state.threads.length; i++) {
    const t = state.threads[i]!;
    if (!t.isRunning) continue;

    if (t.timer > 0) continue;

    // Resolve pending goto set during previous ttmPlay
    if (t.nextGotoOffset) {
      t.ip = t.nextGotoOffset;
      t.nextGotoOffset = 0;
    }

    // sceneTimer: time-limited scene (ADD_SCENE with negative arg3)
    if (t.sceneTimer > 0) {
      t.sceneTimer -= t.delay;
      if (t.sceneTimer <= 0) t.isRunning = 2;
    }

    if (t.isRunning === 1) {
      t.timer = t.delay;
      ttmPlay(t, ttmCtx);
    }

    // Handle thread expiry (isRunning==2 set by PURGE or sceneTimer above)
    if (t.isRunning === 2) {
      if (t.sceneIterations > 0) {
        t.sceneIterations--;
        t.isRunning = 1;
        t.timer = 0;
        t.ip = findTtmTag(t.slot, t.sceneTag);
      } else {
        const slot = t.sceneSlot, tag = t.sceneTag;
        adsStopScene(state, i);
        if (!state.stopRequested) adsPlayTriggeredChunks(state, slot, tag);
      }
    }
  }
}

export function adsActiveThreadCount(state: AdsState): number {
  return state.threads.filter(t => t.isRunning).length;
}

export function adsThreadLayers(state: AdsState) {
  return state.threads.map(t => t.isRunning ? t.layer : null);
}
