import { OP } from './opcodes.js';
import type { TtmThread } from './thread.js';
import type { ParsedArchive } from '../resource/types.js';
import type { Palette } from '../types.js';
import { setPaletteFromVga } from '../gfx/palette.js';
import { decodePal } from '../decode/pal.js';
import { decodeScr } from '../decode/scr.js';
import { drawLine, drawRect, drawCircle, putPixel } from '../gfx/primitives.js';
import { drawSprite, drawSpriteFlip } from '../gfx/sprite.js';
import { setClip } from '../gfx/clip.js';
import { copyZoneToBg, saveZone, restoreZone, saveImage1 } from '../gfx/zone.js';
import { clearLayer } from '../gfx/layer.js';
import { loadBmpIntoSlot } from './bmp-slots.js';

export interface TtmContext {
  archive: ParsedArchive;
  palette: Palette;
  setBackground: (indexed: Uint8Array | null) => void;
  playSample: (n: number) => void;
  dx: number;  // island x offset applied to all TTM draw coordinates
  dy: number;  // island y offset applied to all TTM draw coordinates
}

// When argCount nibble == 0x0f, the opcode takes a null-terminated string, not 15 uint16s.
// C: if (numArgs == 0x0f) { read string } else { read numArgs uint16s }
function step(bc: Uint8Array, pos: number): { op: number; args: number[]; str?: string; pos: number } {
  let p = pos;
  const dv = new DataView(bc.buffer, bc.byteOffset);
  const op = dv.getUint16(p, true); p += 2;
  const argCount = op & 0x000f;
  const args: number[] = [];
  let str: string | undefined;
  if (argCount === 0x0f) {
    const sb: number[] = [];
    while (p < bc.length) {
      const b = dv.getUint8(p++); if (b === 0) break; sb.push(b);
    }
    if (p & 1) p++; // align to even byte boundary
    str = new TextDecoder('latin1').decode(new Uint8Array(sb));
  } else {
    for (let i = 0; i < argCount; i++) { args.push(dv.getUint16(p, true)); p += 2; }
  }
  return { op, args, str, pos: p };
}

function findTagOffset(bc: Uint8Array, tagOp: number, tagId: number): number {
  let p = 0;
  while (p < bc.length) {
    const ins = step(bc, p);
    if (ins.op === tagOp && ins.args[0] === tagId) return ins.pos;
    p = ins.pos;
  }
  return -1;
}

export function ttmStartScene(t: TtmThread, tagId: number): void {
  const off = findTagOffset(t.slot.ttm!.bytecode, OP.TAG, tagId);
  if (off < 0) throw new Error(`tag ${tagId} not found`);
  t.ip = off;
  t.isRunning = 1;
  t.timer = 0;
  t.delay = 4;
}

// Runs until UPDATE (yield) or PURGE (done). Call once per tick when timer expires.
export function ttmPlay(t: TtmThread, ctx: TtmContext): void {
  const bc = t.slot.ttm!.bytecode;
  while (t.ip < bc.length) {
    const ins = step(bc, t.ip);
    t.ip = ins.pos;
    const a = ins.args;
    switch (ins.op) {
      case OP.DRAW_BACKGROUND:
        clearLayer(t.layer);
        break;
      case OP.PURGE:
        if (t.nextGotoOffset) { t.ip = t.nextGotoOffset; t.nextGotoOffset = 0; }
        else t.isRunning = 2;
        return;
      case OP.UPDATE:
        return;
      case OP.SET_DELAY:
        t.delay = Math.max(4, a[0]!);
        break;
      case OP.SET_BMP_SLOT:
        t.selectedBmpSlot = a[0]!;
        break;
      case OP.SET_PALETTE_SLOT:
        // unimplemented in jc_reborn — no-op
        break;
      case OP.LOCAL_TAG: case OP.TAG:
        break;
      case OP.TTM_UNKNOWN_1:
        break;
      case OP.GOTO_TAG: {
        const tgt = findTagOffset(bc, OP.LOCAL_TAG, a[0]!);
        if (tgt >= 0) t.ip = tgt;
        break;
      }
      case OP.SET_COLORS:
        t.fgColor = a[0]! & 0x0f;
        t.bgColor = a[1]! & 0x0f;
        break;
      case OP.SET_FRAME1:
        break;
      case OP.TIMER:
        t.delay = ((a[0]! + a[1]!) / 2) | 0;
        t.timerYield = true;
        return;
      case OP.SET_CLIP_ZONE:
        setClip(t.layer, { x: a[0]!, y: a[1]!, w: a[2]! - a[0]!, h: a[3]! - a[1]! });
        break;
      case OP.COPY_ZONE_TO_BG:
        copyZoneToBg(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.SAVE_IMAGE1:
        saveImage1(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.SAVE_ZONE:
        saveZone(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.RESTORE_ZONE:
        restoreZone(t.layer, a[0]!, a[1]!, a[2]!, a[3]!);
        break;
      case OP.DRAW_PIXEL:
        putPixel(t.layer, a[0]! + ctx.dx, a[1]! + ctx.dy, t.fgColor);
        break;
      case OP.DRAW_LINE:
        drawLine(t.layer, a[0]! + ctx.dx, a[1]! + ctx.dy, a[2]! + ctx.dx, a[3]! + ctx.dy, t.fgColor);
        break;
      case OP.DRAW_RECT:
        drawRect(t.layer, a[0]! + ctx.dx, a[1]! + ctx.dy, a[2]! + ctx.dx, a[3]! + ctx.dy, t.fgColor);
        break;
      case OP.DRAW_CIRCLE:
        drawCircle(t.layer, a[0]! + ctx.dx, a[1]! + ctx.dy, a[2]! + ctx.dx, a[3]! + ctx.dy, t.fgColor, t.bgColor);
        break;
      case OP.DRAW_SPRITE: {
        // grDrawSprite(layer, slot, x, y, spriteNo, imageNo) — args[0..3] = x,y,sprNo,imgNo
        const x = a[0]! + ctx.dx, y = a[1]! + ctx.dy, sprIdx = a[2]!, imgIdx = a[3]!;
        const s = t.slot.sprites[imgIdx]?.[sprIdx];
        if (s) drawSprite(t.layer, s, x, y);
        break;
      }
      case OP.DRAW_SPRITE_FLIP: {
        const x = a[0]! + ctx.dx, y = a[1]! + ctx.dy, sprIdx = a[2]!, imgIdx = a[3]!;
        const s = t.slot.sprites[imgIdx]?.[sprIdx];
        if (s) drawSpriteFlip(t.layer, s, x, y);
        break;
      }
      case OP.CLEAR_SCREEN:
        clearLayer(t.layer);
        break;
      case OP.DRAW_SCREEN:
        break;
      case OP.PLAY_SAMPLE:
        ctx.playSample(a[0]!);
        break;
      case OP.LOAD_SCREEN: {
        const name = ins.str!.endsWith('.SCR') ? ins.str! : ins.str! + '.SCR';
        const res = ctx.archive.byName.get(name);
        if (res) ctx.setBackground(decodeScr(res.payload).indexed);
        break;
      }
      case OP.LOAD_IMAGE: {
        const name = ins.str!.endsWith('.BMP') ? ins.str! : ins.str! + '.BMP';
        loadBmpIntoSlot(ctx.archive, t.slot, t.selectedBmpSlot, name);
        break;
      }
      case OP.LOAD_PALETTE: {
        const name = ins.str!.endsWith('.PAL') ? ins.str! : ins.str! + '.PAL';
        const res = ctx.archive.byName.get(name);
        if (res) setPaletteFromVga(ctx.palette, decodePal(res.payload).vga);
        break;
      }
      default:
        console.warn(`unknown TTM opcode 0x${ins.op.toString(16)}`);
        break;
    }
  }
  t.isRunning = 2;
}
