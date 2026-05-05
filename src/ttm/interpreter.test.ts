import { describe, it, expect } from 'vitest';
import { OP } from './opcodes.js';
import { ttmPlay, ttmStartScene, type TtmContext } from './interpreter.js';
import { makeThread } from './thread.js';

function makeBytecode(): Uint8Array {
  const buf = new ArrayBuffer(64);
  const dv = new DataView(buf);
  let p = 0;
  const w = (n: number) => { dv.setUint16(p, n, true); p += 2; };
  w(OP.TAG); w(1);
  w(OP.SET_DELAY); w(8);
  w(OP.SET_COLORS); w(3); w(4);
  w(OP.UPDATE);
  return new Uint8Array(buf, 0, p);
}

const fakeCtx: TtmContext = {
  archive: { byName: new Map(), list: [] },
  palette: new Uint8Array(64),
  setBackground: () => {},
  playSample: () => {},
};

describe('ttmPlay', () => {
  it('honors SET_DELAY and SET_COLORS, yields on UPDATE', () => {
    const t = makeThread();
    t.slot.ttm = { version: 'x', numPages: 1, bytecode: makeBytecode(), tags: [{ id: 1, description: '', offset: 0 }] };
    ttmStartScene(t, 1);
    ttmPlay(t, fakeCtx);
    expect(t.delay).toBe(8);
    expect(t.fgColor).toBe(3);
    expect(t.bgColor).toBe(4);
    expect(t.isRunning).toBe(1); // UPDATE yields, doesn't terminate
  });

  it('PURGE sets isRunning=2', () => {
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    let p = 0;
    const w = (n: number) => { dv.setUint16(p, n, true); p += 2; };
    w(OP.TAG); w(1);
    w(OP.PURGE);
    const bc = new Uint8Array(buf, 0, p);
    const t = makeThread();
    t.slot.ttm = { version: 'x', numPages: 1, bytecode: bc, tags: [] };
    ttmStartScene(t, 1);
    ttmPlay(t, fakeCtx);
    expect(t.isRunning).toBe(2);
  });
});
