import { makeAdsState, type AdsNode } from '../ads/state.js';
import { adsSectionBusy, adsStartSection, adsTick } from '../ads/tick.js';
import { decodeAds } from '../decode/ads-loader.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { makePalette } from '../gfx/palette.js';
import type { ParsedArchive } from '../resource/types.js';
import { makeTtmEnv } from '../ttm/page-runner.js';
import { RecordingDevice, TRACE_ISLAND_X, TRACE_ISLAND_Y } from './ttm-recorder.js';

export const ADS_TRACE_TICK_LIMIT = 2000;
const CLOCK_START = 1;

export function traceAdsSection(archive: ParsedArchive, name: string, tag: number): string[] {
  const draw = makeDrawState();
  const device = new RecordingDevice(draw, archive);
  const env = makeTtmEnv(device, draw);
  env.islandX = TRACE_ISLAND_X;
  env.islandY = TRACE_ISLAND_Y;
  const state = makeAdsState(decodeAds(archive.byName.get(name)!.payload), archive, () => device.random());
  const palette = makePalette();
  adsStartSection(state, tag);
  const rows: string[] = [];
  let seenOrder: string | null = null;
  const seenSections = new Map<number, string>();
  const seenNodes = new Map<AdsNode, string>();
  let now = CLOCK_START;
  for (let tick = 0; tick < ADS_TRACE_TICK_LIMIT; tick++) {
    device.events = [];
    const ran = adsTick(state, env, palette, now);
    const busy = adsSectionBusy(state, tag);
    const randoms = device.events.filter(([event]) => event === 'random').length;
    const out: (string | number)[][] = [['tick', ran ? 1 : 0, busy ? 1 : 0, randoms]];
    const order = state.nodes.map((node) => `${node.ttmId}:${node.tag}`).join(' ');
    if (order !== seenOrder) {
      out.push(['order', order]);
      seenOrder = order;
    }
    state.sections.forEach((section, index) => {
      const values = [section.state, section.counter, section.resume ?? -1].join(' ');
      if (seenSections.get(index) === values) return;
      out.push(['section', index, values]);
      seenSections.set(index, values);
    });
    for (const node of state.nodes) {
      const values = nodeValues(node).join(' ');
      if (seenNodes.get(node) === values) continue;
      out.push(['node', values]);
      seenNodes.set(node, values);
    }
    for (const [event, ...values] of out) rows.push([name, tag, tick, event, values.join(' ')].join('\t'));
    if (!busy) break;
    now += 1 + (tick % 3);
  }
  return rows;
}

function nodeValues(node: AdsNode): number[] {
  return [
    node.ttmId, node.tag, node.mode, node.page, node.nextPage, node.lastRunPage, node.selfGoto ? 1 : 0,
    node.replay ? 1 : 0, node.playCount, node.playsLeft, node.sectionState, node.delay, node.dueTime, node.endTime,
  ];
}
