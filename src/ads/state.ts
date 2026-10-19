import { adsArgCount } from '../decode/ads-bytecode.js';
import type { AdsResource } from '../decode/ads-loader.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import type { ParsedArchive } from '../resource/types.js';
import { makeThread, makeTtmSlot, type TtmSlot, type TtmThread } from '../ttm/state.js';
import { SCREEN_H, SCREEN_W } from '../types.js';

export const NO_PAGE = -1;
export const NO_SECTION = -1;

export const MODE_IDLE = 0;
export const MODE_ONCE = 1;
export const MODE_REPEAT = 2;
export const MODE_TIMED = 3;
export const MODE_DONE = 4;
export const MODE_HOLD = 5;

export const SECTION_IDLE = 0;
export const SECTION_RUN = 1;
export const SECTION_STOP = 2;
export const SECTION_RESTART = 3;
export const SECTION_START = 4;
export const SECTION_FREEZE = 5;
export const SECTION_HIDE = 6;
export const SECTION_FRESH = 8;

const SECTION_END = 0xffff;
const SCENE_OPCODES: readonly number[] = [0x2000, 0x2005];

export interface AdsNode extends TtmThread {
  ttmId: number;
  tag: number;
  tagPage: number;
  page: number;
  nextPage: number;
  lastRunPage: number;
  selfGoto: boolean;
  delay: number;
  dueTime: number;
  sectionState: number;
  playCount: number;
  mode: number;
  playsLeft: number;
  endTime: number;
}

export interface AdsSection {
  tag: number;
  start: number;
  state: number;
  counter: number;
  resume: number | null;
  scenes: AdsNode[];
}

export interface AdsState {
  bytecode: Uint8Array;
  nodes: AdsNode[];
  sections: AdsSection[];
  current: number;
  endBlock: number;
  conditionTrue: boolean;
  now: number;
  random: () => number;
}

export function makeAdsState(ads: AdsResource, archive: ParsedArchive, random: () => number): AdsState {
  const nodes: AdsNode[] = [];
  for (const { slot: ttmId, name } of ads.subResources) {
    const resource = archive.byName.get(name.toUpperCase());
    if (!resource) throw new Error(`${name} is missing, so the ADS does not load`);
    const ttm = decodeTtm(resource.payload);
    const slot = makeTtmSlot(ttmId, ttm);
    for (const { id, page } of ttm.tags) nodes.push(makeNode(slot, ttmId, id, page));
  }
  nodes.forEach(resetNode);
  const state: AdsState = {
    bytecode: ads.bytecode,
    nodes,
    sections: [],
    current: NO_SECTION,
    endBlock: 0,
    conditionTrue: false,
    now: 0,
    random,
  };
  state.sections = ads.sections.map(({ tag, offset }) => ({
    tag,
    start: offset,
    state: SECTION_FRESH,
    counter: 0,
    resume: null,
    scenes: sectionScenes(state, offset),
  }));
  return state;
}

function makeNode(slot: TtmSlot, ttmId: number, tag: number, tagPage: number): AdsNode {
  return {
    ...makeThread(slot),
    ttmId,
    tag,
    tagPage,
    page: tagPage,
    nextPage: NO_PAGE,
    lastRunPage: NO_PAGE,
    selfGoto: false,
    delay: 0,
    dueTime: 0,
    sectionState: SECTION_IDLE,
    playCount: 0,
    mode: MODE_IDLE,
    playsLeft: 0,
    endTime: 0,
  };
}

export function resetNode(node: AdsNode): void {
  node.paletteSlot = 0;
  node.bmpSlot = 0;
  node.zoneSlot = 0;
  node.page = node.tagPage;
  node.nextPage = NO_PAGE;
  node.foreground = 0x0f;
  node.background = 0x0f;
  node.delay = 0;
  node.dueTime = 0;
  node.playsLeft = 0;
  node.playCount = 0;
  node.replay = false;
  node.mode = MODE_IDLE;
  node.sectionState = SECTION_IDLE;
  node.selfGoto = false;
  node.clipOn = true;
  node.clip = { x1: 0, y1: 0, x2: SCREEN_W - 1, y2: SCREEN_H - 1 };
}

export function findNode(state: AdsState, ttmId: number, tag: number): AdsNode | null {
  return state.nodes.find((node) => node.ttmId === ttmId && node.tag === tag) ?? null;
}

export function sectionIndex(state: AdsState, tag: number): number {
  return state.sections.findIndex((section) => section.tag === tag);
}

export function word(state: AdsState, at: number): number {
  return (state.bytecode[at] ?? 0) | ((state.bytecode[at + 1] ?? 0) << 8);
}

export function nextInstruction(state: AdsState, at: number | null): number | null {
  if (at === null || at > state.bytecode.length - 1) return null;
  return at + 2 + 2 * adsArgCount(word(state, at));
}

function sectionScenes(state: AdsState, start: number): AdsNode[] {
  const scenes: AdsNode[] = [];
  for (let at: number | null = start; at !== null && word(state, at) !== SECTION_END; at = nextInstruction(state, at)) {
    if (!SCENE_OPCODES.includes(word(state, at))) continue;
    const node = findNode(state, word(state, at + 2), word(state, at + 4));
    if (node && !scenes.includes(node)) scenes.push(node);
  }
  return scenes;
}
