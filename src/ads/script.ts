import {
  findNode, MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED, nextInstruction, NO_SECTION,
  resetNode, SECTION_FRESH, SECTION_RESTART, SECTION_START, SECTION_STOP, sectionIndex, word, type AdsState,
} from './state.js';

export const ADS_OP = {
  MARKER_1: 0x0001,
  MARKER_5: 0x0005,
  WHILE_COUNT: 0x1080,
  AND: 0x1420,
  OR: 0x1430,
  ELSE: 0x1500,
  END_IF: 0x1510,
  END_WHILE: 0x1520,
  RESTART_SCENE: 0x2000,
  ADD_SCENE: 0x2005,
  STOP_SCENE: 0x2010,
  HOLD_SCENE: 0x2015,
  RESET_SCENE: 0x2020,
  RANDOM: 0x3010,
  RANDOM_NOTHING: 0x3020,
  RANDOM_END: 0x30ff,
  DRAW_LAST: 0x4000,
  DRAW_FIRST: 0x4010,
  STOP_THIS_SECTION: 0xf000,
  STOP_SECTION: 0xf010,
  START_SECTION: 0xf200,
  RESTART_SECTION: 0xf210,
  END: 0xffff,
} as const;

const IF_OPCODES: ReadonlySet<number> = new Set([
  0x1310, 0x1320, 0x1330, 0x1340, 0x1350, 0x1360, 0x1370, 0x1380, 0x1390, 0x13a0, 0x13a1, 0x13b0, 0x13b1, 0x13c0, 0x13c1,
]);
const WHILE_OPCODES: ReadonlySet<number> = new Set([0x1010, 0x1020, 0x1030, 0x1040, 0x1050, 0x1060, 0x1070, 0x1080]);
const STORY_VALUE_OPCODES_FROM = 0x1380;
const THIS_SECTION = 0xffff;

const int16 = (value: number) => (value << 16) >> 16;

export function runBlock(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null) {
    if (word(state, at) === ADS_OP.END) return null;
    at = runInstruction(state, at);
    if (state.endBlock !== 0) {
      state.endBlock = 0;
      return at;
    }
  }
  return null;
}

export function runInstruction(state: AdsState, at: number): number | null {
  const op = word(state, at);
  const arg = (index: number) => word(state, at + 2 + 2 * index);
  if (IF_OPCODES.has(op)) return ifBlock(state, at);
  if (WHILE_OPCODES.has(op)) return whileBlock(state, at);
  switch (op) {
    case ADS_OP.MARKER_1:
    case ADS_OP.MARKER_5:
      return at + 2;
    case ADS_OP.ELSE: {
      const end = skipBlock(state, at + 2);
      state.endBlock++;
      return end;
    }
    case ADS_OP.END_IF:
      state.endBlock++;
      return at;
    case ADS_OP.END_WHILE:
      state.endBlock++;
      return null;
    case ADS_OP.RESTART_SCENE:
      restartScene(state, arg(0), arg(1), arg(2));
      return at + 10;
    case ADS_OP.ADD_SCENE:
      addScene(state, arg(0), arg(1), arg(2));
      return at + 10;
    case ADS_OP.STOP_SCENE:
      setMode(state, arg(0), arg(1), MODE_IDLE);
      return at + 8;
    case ADS_OP.HOLD_SCENE:
      setMode(state, arg(0), arg(1), MODE_HOLD);
      return at + 8;
    case ADS_OP.RESET_SCENE: {
      const node = findNode(state, arg(0), arg(1));
      if (node) resetNode(node);
      return at + 8;
    }
    case ADS_OP.DRAW_LAST:
      moveNode(state, arg(0), arg(1), 'last');
      return at + 8;
    case ADS_OP.DRAW_FIRST:
      moveNode(state, arg(0), arg(1), 'first');
      return at + 8;
    case ADS_OP.RANDOM:
      return randomBlock(state, at + 2);
    case ADS_OP.STOP_THIS_SECTION:
      if (state.current !== NO_SECTION) state.sections[state.current]!.state = SECTION_STOP;
      return null;
    case ADS_OP.STOP_SECTION: {
      const index = arg(0) === THIS_SECTION ? state.current : sectionIndex(state, arg(0));
      if (index !== NO_SECTION) state.sections[index]!.state = SECTION_STOP;
      return index === state.current ? null : at + 4;
    }
    case ADS_OP.START_SECTION:
      startSection(state, arg(0), SECTION_START);
      return at + 4;
    case ADS_OP.RESTART_SECTION:
      startSection(state, arg(0), SECTION_RESTART);
      return at + 4;
    default:
      return null;
  }
}

export function sectionResumePoint(state: AdsState, start: number): number {
  for (let at: number | null = start; at !== null && word(state, at) !== ADS_OP.END; at = nextInstruction(state, at)) {
    if (word(state, at) === ADS_OP.MARKER_5) return at + 2;
  }
  return start;
}

function ifBlock(state: AdsState, at: number): number | null {
  const body = evalConditions(state, at);
  if (body === null) return null;
  const end = state.conditionTrue ? runBlock(state, body) : skipFalseBlock(state, body);
  return end === null ? null : end + 2;
}

function whileBlock(state: AdsState, at: number): number | null {
  const body = evalConditions(state, at);
  const section = state.sections[state.current]!;
  if (state.conditionTrue) {
    section.counter++;
    section.resume = at;
    runBlock(state, body);
    return null;
  }
  section.counter = 0;
  section.resume = null;
  const end = whileEnd(state, body);
  return end === null ? null : end + 2;
}

function whileEnd(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null && word(state, at) !== 0) {
    const op = word(state, at);
    if (op === ADS_OP.END) return null;
    if (op === ADS_OP.END_WHILE) return at;
    at = nextInstruction(state, at);
  }
  return null;
}

function skipBlock(state: AdsState, from: number | null): number | null {
  let at = from;
  while (at !== null && word(state, at) !== 0) {
    const op = word(state, at);
    if (op === ADS_OP.ELSE || op === ADS_OP.END_IF) return at;
    if (op === ADS_OP.END) return null;
    if (IF_OPCODES.has(op)) {
      at = skipBlock(state, evalConditions(state, at));
      if (at !== null && word(state, at) === ADS_OP.ELSE) at = skipBlock(state, at + 2);
    }
    at = nextInstruction(state, at);
  }
  return null;
}

function skipFalseBlock(state: AdsState, from: number): number | null {
  const end = skipBlock(state, from);
  if (end !== null && word(state, end) === ADS_OP.ELSE) return runBlock(state, end + 2);
  return end;
}

function evalConditions(state: AdsState, from: number): number | null {
  let at = from;
  let holds = false;
  let someOrHeld = false;
  let evaluate = true;
  for (;;) {
    if (evaluate && conditionHolds(state, at)) holds = true;
    const joinerAt = nextInstruction(state, at);
    if (joinerAt === null) return null;
    const joiner = word(state, joinerAt);
    if (joiner !== ADS_OP.AND && joiner !== ADS_OP.OR) {
      state.conditionTrue = holds || someOrHeld;
      return joinerAt;
    }
    const nextAt = nextInstruction(state, joinerAt);
    if (nextAt === null) return null;
    at = nextAt;
    if (!holds) {
      evaluate = joiner === ADS_OP.OR;
    } else if (joiner === ADS_OP.OR) {
      someOrHeld = true;
      evaluate = false;
    } else {
      holds = false;
      evaluate = true;
    }
  }
}

function conditionHolds(state: AdsState, at: number): boolean {
  const op = word(state, at);
  const arg0 = word(state, at + 2);
  if (!IF_OPCODES.has(op) && !WHILE_OPCODES.has(op)) return false;
  if (op === ADS_OP.WHILE_COUNT) return int16(arg0) >= state.sections[state.current]!.counter;
  if (op >= STORY_VALUE_OPCODES_FROM) return storyValueHolds(op, arg0);
  const node = findNode(state, arg0, word(state, at + 4));
  const mode = node?.mode;
  switch (op & 0xff) {
    case 0x10: return mode === MODE_HOLD;
    case 0x20: return mode !== MODE_HOLD;
    case 0x30: return node === null || node.playCount === 0;
    case 0x40: return node !== null && node.playCount !== 0;
    case 0x50: return mode === MODE_DONE;
    case 0x60: return node === null || mode === MODE_IDLE || mode === MODE_DONE;
    default: return mode === MODE_ONCE || mode === MODE_REPEAT || mode === MODE_TIMED;
  }
}

// 1068:463a, 4636 and 4638 are never written, so these compare against 0.
function storyValueHolds(op: number, value: number): boolean {
  switch (op) {
    case 0x1380: return int16(value) >= 0;
    case 0x1390: return int16(value) <= 0;
    case 0x13a0:
    case 0x13a1: return true;
    default: return value === 0;
  }
}

function addScene(state: AdsState, ttmId: number, tag: number, count: number): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  const plays = int16(count);
  if (plays === 0) {
    node.mode = MODE_ONCE;
  } else if (plays < 0) {
    node.mode = MODE_TIMED;
    node.endTime = (state.now - plays) >>> 0;
  } else {
    node.mode = MODE_REPEAT;
    node.playsLeft = plays - 1;
  }
  node.playCount++;
}

function restartScene(state: AdsState, ttmId: number, tag: number, count: number): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  node.page = node.tagPage;
  addScene(state, ttmId, tag, count);
}

function setMode(state: AdsState, ttmId: number, tag: number, mode: number): void {
  const node = findNode(state, ttmId, tag);
  if (node) node.mode = mode;
}

function moveNode(state: AdsState, ttmId: number, tag: number, to: 'first' | 'last'): void {
  const node = findNode(state, ttmId, tag);
  if (!node) return;
  const index = state.nodes.indexOf(node);
  if (index === (to === 'first' ? 0 : state.nodes.length - 1)) return;
  state.nodes.splice(index, 1);
  if (to === 'first') state.nodes.unshift(node);
  else state.nodes.push(node);
}

function randomBlock(state: AdsState, first: number): number | null {
  let total = 0;
  let at: number | null = first;
  while (at !== null && word(state, at) !== ADS_OP.RANDOM_END) {
    total = (total + randomWeight(state, at)) & 0xffff;
    at = nextInstruction(state, at);
  }
  if (at === null) return null;
  const after = at + 2;
  if (total === 0) return after;
  let left = Math.abs(int16((state.random() & 0xffff) % total)) + 1;
  let pick: number | null = first;
  while (pick !== null) {
    left -= randomWeight(state, pick);
    if (left < 1) break;
    pick = nextInstruction(state, pick);
  }
  if (pick !== null && word(state, pick) !== ADS_OP.RANDOM_NOTHING) runInstruction(state, pick);
  return after;
}

function randomWeight(state: AdsState, at: number): number {
  const op = word(state, at);
  if (op === ADS_OP.RESTART_SCENE || op === ADS_OP.ADD_SCENE) return word(state, at + 8);
  if (op === ADS_OP.RANDOM_NOTHING) return word(state, at + 2);
  return word(state, at + 6);
}

function startSection(state: AdsState, tag: number, how: number): void {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return;
  const section = state.sections[index]!;
  section.state = (section.state & SECTION_FRESH) | how;
}
