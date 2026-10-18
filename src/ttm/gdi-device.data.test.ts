import { describe, expect, it } from 'vitest';
import { decodeAds } from '../decode/ads-loader.js';
import { readTtmInstruction } from '../decode/ttm-bytecode.js';
import { decodeTtm } from '../decode/ttm-loader.js';
import { Display, SURFACE_B, SURFACE_C } from '../gfx/gdi/display.js';
import { makeDrawState } from '../gfx/gdi/surface.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { GdiDevice } from './gdi-device.js';
import { OP } from './opcodes.js';
import { makeTtmEnv, runTtmPage } from './page-runner.js';
import { loadThreadDrawState, makeThread, makeTtmSlot } from './state.js';

const LOADS = new Set<number>([OP.LOAD_SCREEN, OP.LOAD_IMAGE, OP.LOAD_PALETTE]);

describe.skipIf(!hasCorpus)('GdiDevice on the real data', () => {
  const archive = loadArchive();
  const scripts = archive.list.filter((resource) => resource.type === '.TTM');

  it('finds every resource a TTM script loads, ignoring case, except two bitmaps of the unused FIRE.TTM', () => {
    // SCRANTIC 1018:1019 1018:195a 1058:06c5 1058:0769 1058:07c5 1058:0995
    const ttmsUsedByAds = archive.list
      .filter((resource) => resource.type === '.ADS')
      .flatMap((resource) => decodeAds(resource.payload).subResources.map((sub) => sub.name.toUpperCase()));
    expect(ttmsUsedByAds).not.toContain('FIRE.TTM');
    const missing: string[] = [];
    for (const script of scripts) {
      const { bytecode } = decodeTtm(script.payload);
      for (let offset = 0; offset < bytecode.length; ) {
        const instruction = readTtmInstruction(bytecode, offset);
        offset = instruction.next;
        const name = instruction.text ?? '';
        if (LOADS.has(instruction.opcode) && !archive.byName.has(name.toUpperCase())) missing.push(`${script.name}: ${name}`);
      }
    }
    expect(missing).toEqual(['FIRE.TTM: FLAME.BMP', 'FIRE.TTM: FLURRY.BMP']);
  });

  it('loads a screen onto the target surface', () => {
    // SCRANTIC 1028:1813 1040:0286
    const display = new Display();
    const device = new GdiDevice(display, makeDrawState(), archive, { playSound: () => {}, random: () => 0 });
    device.setSurfaces(SURFACE_B, SURFACE_B);
    device.loadScreen('ocean00.scr');
    expect(display.surfaces[SURFACE_B]!.pixels.some((index) => index !== 0)).toBe(true);
    expect(display.surfaces[SURFACE_C]!.pixels.every((index) => index === 0)).toBe(true);
  });

  it('runs every page of every TTM script on the display, first run and replay', () => {
    // SCRANTIC 1050:074a 1058:040c
    for (const script of scripts) {
      const display = new Display();
      display.screenIsB = true;
      const draw = makeDrawState();
      const device = new GdiDevice(display, draw, archive, { playSound: () => {}, random: () => 0x1234 });
      const env = makeTtmEnv(device, draw);
      const ttm = decodeTtm(script.payload);
      const thread = makeThread(makeTtmSlot(1, ttm));
      for (let page = 0; page < ttm.pageOffsets.length; page++) {
        for (const replay of [false, true]) {
          thread.replay = replay;
          loadThreadDrawState(thread, draw);
          expect(runTtmPage(env, thread, page).ran, `${script.name} page ${page}`).toBe(true);
        }
        display.restorePass(0);
      }
    }
  });
});
