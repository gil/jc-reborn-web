import { activatePendingPalette, runTtmPage, type TtmEnv } from '../ttm/page-runner.js';
import { loadThreadDrawState, resetDrawClip } from '../ttm/state.js';
import type { Palette } from '../types.js';
import { runBlock, sectionResumePoint } from './script.js';
import {
  MODE_DONE, MODE_HOLD, MODE_IDLE, MODE_ONCE, MODE_REPEAT, MODE_TIMED, NO_PAGE, NO_SECTION, resetNode,
  SECTION_FREEZE, SECTION_FRESH, SECTION_HIDE, SECTION_RESTART, SECTION_RUN, SECTION_START, sectionIndex,
  type AdsNode, type AdsSection, type AdsState,
} from './state.js';

const PLAYING_MODES: ReadonlySet<number> = new Set([MODE_ONCE, MODE_REPEAT, MODE_TIMED, MODE_HOLD]);

export function adsStartSection(state: AdsState, tag: number): void {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return;
  const section = state.sections[index]!;
  section.resume = null;
  section.state = (section.state & SECTION_FRESH) | SECTION_RESTART;
}

export function adsSectionBusy(state: AdsState, tag: number): boolean {
  const index = sectionIndex(state, tag);
  if (index === NO_SECTION) return false;
  const section = state.sections[index]!;
  const running = section.state & ~SECTION_FRESH;
  if (running === SECTION_RUN || running === SECTION_START) return true;
  return section.scenes.some((node) => node.mode !== MODE_IDLE && node.mode !== MODE_DONE && !node.selfGoto);
}

export function adsActiveNodeCount(state: AdsState): number {
  return state.nodes.filter((node) => PLAYING_MODES.has(node.mode)).length;
}

export function advancePage(node: AdsNode, now: number): boolean {
  if (node.delay !== 0) {
    if (now < node.dueTime) return false;
    node.dueTime = (now + node.delay) >>> 0;
  }
  node.replay = false;
  if (node.nextPage === NO_PAGE) {
    node.page++;
  } else {
    node.page = node.nextPage;
    node.nextPage = NO_PAGE;
  }
  return true;
}

export function adsTick(state: AdsState, env: TtmEnv, palette: Palette, now: number): boolean {
  state.now = now;
  for (const section of state.sections) {
    const running = section.state & ~SECTION_FRESH;
    for (const node of section.scenes) {
      if (running === SECTION_RESTART) resetNode(node);
      else node.sectionState = running;
    }
  }
  state.sections.forEach((section, index) => runSection(state, section, index));
  let ran = false;
  for (const node of state.nodes) {
    if (playNode(env, node, now)) ran = true;
  }
  activatePendingPalette(env, palette);
  resetDrawClip(env.draw);
  return ran;
}

function runSection(state: AdsState, section: AdsSection, index: number): void {
  let start: number;
  if (section.state & SECTION_FRESH) {
    section.state &= ~SECTION_FRESH;
    start = section.start;
  } else {
    start = sectionResumePoint(state, section.start);
  }
  const from = section.resume ?? start;
  if (section.state === SECTION_RESTART || section.state === SECTION_START) section.state = SECTION_RUN;
  state.current = index;
  if (section.state === SECTION_RUN) runBlock(state, from);
}

function playNode(env: TtmEnv, node: AdsNode, now: number): boolean {
  node.lastRunPage = NO_PAGE;
  const section = node.sectionState;
  const mode = node.mode;
  let ran = false;
  if (section !== SECTION_HIDE && PLAYING_MODES.has(mode)) {
    loadThreadDrawState(node, env.draw);
    const result = runTtmPage(env, node, node.page);
    if (!result.ran || section === SECTION_FREEZE) {
      if (section !== SECTION_FREEZE) {
        node.nextPage = node.tagPage;
        node.mode = MODE_DONE;
      }
    } else {
      ran = true;
      node.replay = true;
      node.lastRunPage = node.page;
      if (result.delay !== null && result.delay !== node.delay) {
        node.dueTime = (now + result.delay) >>> 0;
        node.delay = result.delay;
      }
      if (!result.purge) {
        if (result.gotoPage !== null) {
          node.nextPage = result.gotoPage;
          if (node.page === result.gotoPage) node.selfGoto = true;
        }
        if (node.mode !== MODE_HOLD) advancePage(node, now);
      } else {
        node.nextPage = node.tagPage;
        if (node.mode === MODE_REPEAT && node.playsLeft !== 0) {
          if (advancePage(node, now)) node.playsLeft--;
        } else if (node.mode === MODE_TIMED && node.endTime !== 0) {
          advancePage(node, now);
        } else if (advancePage(node, now)) {
          node.mode = MODE_DONE;
          node.delay = 0;
        }
      }
    }
  } else if (section !== SECTION_HIDE && section !== SECTION_FREEZE && mode === MODE_DONE) {
    node.mode = MODE_IDLE;
  }
  if (mode === MODE_TIMED && node.endTime <= now) node.mode = MODE_DONE;
  return ran;
}
