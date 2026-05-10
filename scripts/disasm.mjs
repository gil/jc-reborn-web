#!/usr/bin/env node
// Disassemble TTM/ADS files from the game archive
import { readFileSync } from 'fs';

const MAP_PATH = 'public/data/RESOURCE.MAP';
const ARC_PATH = 'public/data/RESOURCE.001';

// --- resource parsing ---
function parseMap(buf) {
  let pos = 6; // skip 6 unknown header bytes
  const resFileName = String.fromCharCode(...buf.subarray(pos, pos + 13)).replace(/\0.*/, '');
  pos += 13;
  const numEntries = buf[pos] | (buf[pos+1] << 8); pos += 2;
  const entries = [];
  for (let i = 0; i < numEntries; i++) {
    const length = buf[pos] | (buf[pos+1]<<8) | (buf[pos+2]<<16) | (buf[pos+3]<<24); pos += 4;
    const offset = buf[pos] | (buf[pos+1]<<8) | (buf[pos+2]<<16) | (buf[pos+3]<<24); pos += 4;
    entries.push({ length, offset });
  }
  return entries;
}

function indexArchive(arc, entries) {
  const byName = new Map();
  for (const e of entries) {
    let p = e.offset;
    const name = String.fromCharCode(...arc.subarray(p, p+13)).replace(/\0.*/, ''); p += 13;
    const size = arc[p] | (arc[p+1]<<8) | (arc[p+2]<<16) | (arc[p+3]<<24); p += 4;
    const payload = arc.subarray(p, p + size);
    byName.set(name, payload);
  }
  return byName;
}

// --- uncompress (matches uncompress.ts) ---
function uncompressRle(input, outSize) {
  const out = new Uint8Array(outSize);
  let r = 0, w = 0;
  while (w < outSize) {
    const ctrl = input[r++];
    if (ctrl & 0x80) {
      const len = ctrl & 0x7f;
      const b = input[r++];
      for (let i = 0; i < len; i++) out[w++] = b;
    } else {
      for (let i = 0; i < ctrl; i++) out[w++] = input[r++];
    }
  }
  return out;
}

function uncompressLzw(input, outSize) {
  const out = new Uint8Array(outSize);
  const prefix = new Uint16Array(4096);
  const append = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let inOff = 0;
  let curByte = inOff < input.length ? input[inOff++] : 0;
  let nextBit = 0, nBits = 9, bitpos = 0, freeEntry = 257, outOff = 0;
  const getBits = (n) => {
    let x = 0;
    for (let i = 0; i < n; i++) {
      if (curByte & (1 << nextBit)) x |= 1 << i;
      nextBit++;
      if (nextBit > 7) { curByte = inOff < input.length ? input[inOff++] : 0; nextBit = 0; }
    }
    return x;
  };
  let oldcode = getBits(nBits), lastbyte = oldcode;
  out[outOff++] = oldcode & 0xff;
  while (inOff <= input.length) {
    const newcode = getBits(nBits); bitpos += nBits;
    if (newcode === 256) {
      const nbits3 = nBits << 3;
      getBits((nbits3 - ((bitpos - 1) % nbits3)) - 1);
      nBits = 9; freeEntry = 256; bitpos = 0; continue;
    }
    let code = newcode, stackPtr = 0;
    if (code >= freeEntry) { stack[stackPtr++] = lastbyte & 0xff; code = oldcode; }
    while (code > 255) { if (code > 4095) break; stack[stackPtr++] = append[code]; code = prefix[code]; }
    stack[stackPtr++] = code & 0xff; lastbyte = code;
    while (stackPtr > 0) { stackPtr--; if (outOff >= outSize) return out; out[outOff++] = stack[stackPtr]; }
    if (freeEntry < 4096) {
      prefix[freeEntry] = oldcode; append[freeEntry] = lastbyte & 0xff; freeEntry++;
      if (freeEntry >= (1 << nBits) && nBits < 12) { nBits++; bitpos = 0; }
    }
    oldcode = newcode;
  }
  return out;
}

function uncompress(method, input, outSize) {
  if (method === 1) return uncompressRle(input, outSize);
  if (method === 2) return uncompressLzw(input, outSize);
  throw new Error(`unknown compression method ${method}`);
}

// --- ADS decoder ---
function decodeAds(payload) {
  let p = 0;
  const expect = (tag) => {
    const s = String.fromCharCode(...payload.subarray(p, p+4)); p += 4;
    if (s !== tag) throw new Error(`expected ${tag}, got ${s} at ${p-4}`);
  };
  expect('VER:'); p += 4; // version u32
  const version = String.fromCharCode(...payload.subarray(p, p+5)); p += 5;
  expect('ADS:'); p += 4; // 4 unknown
  expect('RES:');
  const resSize = payload[p]|(payload[p+1]<<8)|(payload[p+2]<<16)|(payload[p+3]<<24); p += 4;
  const numRes = payload[p]|(payload[p+1]<<8); p += 2;
  const subResources = [];
  for (let i = 0; i < numRes; i++) {
    const slot = payload[p]|(payload[p+1]<<8); p += 2;
    let name = '';
    while (payload[p] !== 0) name += String.fromCharCode(payload[p++]);
    p++; // null
    subResources.push({ slot, name });
  }
  expect('SCR:');
  const compSize = (payload[p]|(payload[p+1]<<8)|(payload[p+2]<<16)|(payload[p+3]<<24)) - 5; p += 4;
  const method = payload[p++];
  const uncompSize = payload[p]|(payload[p+1]<<8)|(payload[p+2]<<16)|(payload[p+3]<<24); p += 4;
  const bytecode = uncompress(method, payload.subarray(p, p+compSize), uncompSize); p += compSize;
  expect('TAG:');
  p += 4; // tag section size
  const numTags = payload[p]|(payload[p+1]<<8); p += 2;
  const tags = [];
  for (let i = 0; i < numTags; i++) {
    const id = payload[p]|(payload[p+1]<<8); p += 2;
    let desc = '';
    while (payload[p] !== 0) desc += String.fromCharCode(payload[p++]);
    p++;
    tags.push({ id, desc });
  }
  return { subResources, bytecode, tags };
}

// --- TTM decoder ---
function decodeTtm(payload) {
  let p = 0;
  const expect = (tag) => {
    const s = String.fromCharCode(...payload.subarray(p, p+4)); p += 4;
    if (s !== tag) throw new Error(`expected ${tag} at ${p-4}`);
  };
  expect('VER:'); p += 4; // versionSize u32
  p += 5; // version string
  expect('PAG:');
  p += 4; // numPages u32
  p += 2; // 2 unknown bytes
  expect('TT3:');
  const compSize = (payload[p]|(payload[p+1]<<8)|(payload[p+2]<<16)|(payload[p+3]<<24)) - 5; p += 4;
  const method = payload[p++];
  const uncompSize = payload[p]|(payload[p+1]<<8)|(payload[p+2]<<16)|(payload[p+3]<<24); p += 4;
  const bytecode = uncompress(method, payload.subarray(p, p+compSize), uncompSize); p += compSize;
  expect('TTI:'); p += 4; // 4 unknown bytes
  expect('TAG:');
  p += 4; // tagSize u32
  const numTags = payload[p]|(payload[p+1]<<8); p += 2;
  const tags = [];
  for (let i = 0; i < numTags; i++) {
    const id = payload[p]|(payload[p+1]<<8); p += 2;
    let desc = '';
    while (payload[p] !== 0) desc += String.fromCharCode(payload[p++]);
    p++;
    tags.push({ id, desc });
  }
  return { bytecode, tags };
}

// --- ADS disassembler ---
const ADS_NAMES = {
  0x1070:'IF_LASTPLAYED_LOCAL', 0x1330:'IF_UNKNOWN_1', 0x1350:'IF_LASTPLAYED',
  0x1360:'IF_NOT_RUNNING', 0x1370:'IF_IS_RUNNING', 0x1420:'AND', 0x1430:'OR',
  0x1510:'PLAY_SCENE', 0x1520:'ADD_SCENE_LOCAL', 0x2005:'ADD_SCENE', 0x2010:'STOP_SCENE',
  0x2014:'STOP_SCENE_?', 0x3010:'RANDOM_START', 0x3020:'NOP', 0x30ff:'RANDOM_END',
  0x4000:'UNKNOWN_6', 0xf010:'FADE_OUT', 0xf200:'GOSUB_TAG', 0xffff:'END', 0xfff0:'END_IF',
};
const ADS_ARGS = {
  0x1070:2, 0x1330:2, 0x1350:2, 0x1360:2, 0x1370:2,
  0x1420:0, 0x1430:0, 0x1510:0, 0x1520:5,
  0x2005:4, 0x2010:3, 0x2014:0,
  0x3010:0, 0x3020:1, 0x30ff:0,
  0x4000:3, 0xf010:0, 0xf200:1,
  0xffff:0, 0xfff0:0,
};

function disasmAds(bc, tags) {
  const tagById = new Map(tags.map(t => [t.id, t.desc]));
  const lines = [];
  let p = 0;
  while (p < bc.length) {
    const offset = p;
    const op = bc[p] | (bc[p+1]<<8); p += 2;
    const name = ADS_NAMES[op];
    if (name) {
      const argc = ADS_ARGS[op];
      const args = [];
      for (let i = 0; i < argc; i++) { args.push(bc[p]|(bc[p+1]<<8)); p += 2; }
      lines.push(`${hex(offset,4)}  ${hex(op,4)} ${name} ${args.join(' ')}`);
    } else {
      // tag label opcode
      const desc = tagById.get(op) ?? '';
      lines.push(`${hex(offset,4)}  ${hex(op,4)} [TAG ${op}${desc ? ': '+desc : ''}]`);
    }
  }
  return lines.join('\n');
}

// --- TTM disassembler ---
const TTM_NAMES = {
  0x0080:'DRAW_BACKGROUND', 0x0110:'PURGE', 0x0ff0:'UPDATE',
  0x1021:'SET_DELAY', 0x1051:'SET_BMP_SLOT', 0x1061:'SET_PALETTE_SLOT',
  0x1101:'LOCAL_TAG', 0x1111:'TAG', 0x1121:'TTM_UNKNOWN_1', 0x1201:'GOTO_TAG',
  0x2002:'SET_COLORS', 0x2012:'SET_FRAME1', 0x2022:'TIMER',
  0x4004:'SET_CLIP_ZONE', 0x4204:'COPY_ZONE_TO_BG', 0x4214:'SAVE_IMAGE1',
  0xa002:'DRAW_PIXEL', 0xa054:'SAVE_ZONE', 0xa064:'RESTORE_ZONE',
  0xa0a4:'DRAW_LINE', 0xa104:'DRAW_RECT', 0xa404:'DRAW_CIRCLE',
  0xa504:'DRAW_SPRITE', 0xa524:'DRAW_SPRITE_FLIP',
  0xa601:'CLEAR_SCREEN', 0xb606:'DRAW_SCREEN', 0xc051:'PLAY_SAMPLE',
  0xf01f:'LOAD_SCREEN', 0xf02f:'LOAD_IMAGE', 0xf05f:'LOAD_PALETTE',
};

function disasmTtm(bc) {
  const dv = new DataView(bc.buffer, bc.byteOffset);
  const lines = [];
  let p = 0;
  while (p < bc.length) {
    const offset = p;
    const op = dv.getUint16(p, true); p += 2;
    const argc = op & 0x000f;
    const args = [];
    let str;
    if (argc === 0x0f) {
      const sb = [];
      while (p < bc.length) { const b = bc[p++]; if (b === 0) break; sb.push(b); }
      if (p & 1) p++;
      str = String.fromCharCode(...sb);
    } else {
      for (let i = 0; i < argc; i++) { args.push(dv.getUint16(p, true)); p += 2; }
    }
    const name = TTM_NAMES[op] ?? `???_${hex(op,4)}`;
    let line = `${hex(offset,4)}  ${hex(op,4)} ${name}`;
    if (args.length) line += ' ' + args.join(' ');
    if (str !== undefined) line += ` "${str}"`;
    lines.push(line);
  }
  return lines.join('\n');
}

function hex(n, w) { return n.toString(16).padStart(w, '0'); }

// --- main ---
const mapBuf = new Uint8Array(readFileSync(MAP_PATH).buffer);
const arcBuf = new Uint8Array(readFileSync(ARC_PATH).buffer);
const entries = parseMap(mapBuf);
const archive = indexArchive(arcBuf, entries);

const targets = process.argv.slice(2);
if (!targets.length) {
  // Default: show relevant files
  console.log('Available resources:', [...archive.keys()].join(', '));
  process.exit(0);
}

for (const name of targets) {
  const payload = archive.get(name);
  if (!payload) { console.error(`NOT FOUND: ${name}`); continue; }
  console.log(`\n===== ${name} =====`);
  if (name.endsWith('.TTM')) {
    try {
      const ttm = decodeTtm(payload);
      console.log('tags:', ttm.tags.map(t=>`${t.id}:${t.desc}`).join(', '));
      console.log(disasmTtm(ttm.bytecode));
    }
    catch(e) { console.error('TTM decode error:', e.message); }
  } else if (name.endsWith('.ADS')) {
    try {
      const ads = decodeAds(payload);
      console.log('subs:', ads.subResources.map(s=>`${s.slot}:${s.name}`).join(', '));
      console.log('tags:', ads.tags.map(t=>`${t.id}:${t.desc}`).join(', '));
      console.log('--- bytecode ---');
      console.log(disasmAds(ads.bytecode, ads.tags));
    } catch(e) { console.error('ADS decode error:', e.message); }
  }
}
