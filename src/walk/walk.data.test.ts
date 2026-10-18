import { describe, expect, it } from 'vitest';
import { Display, SURFACE_C } from '../gfx/gdi/display.js';
import { hasCorpus, loadArchive } from '../testing/corpus.js';
import { startWalk, walkTick } from './walk.js';

describe.skipIf(!hasCorpus)('walk on the real data', () => {
  it('keeps Johnny on screen on every tick, through the rest that ends a walk', () => {
    const archive = loadArchive();
    const display = new Display();
    display.screenIsB = true;
    const walk = startWalk(archive, [], 0, 0, 0, 0, 0, 0)!;
    const shown = () => display.window.pixels.some((index, p) => index !== display.surfaces[SURFACE_C]!.pixels[p]);
    let ticks = 0;
    while (!walk.done) {
      walkTick(walk, display);
      display.restorePass(0);
      expect(shown(), `tick ${ticks}`).toBe(true);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(1);
  });
});
