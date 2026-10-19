import { chunkBody } from './chunks.js';

const COLORS_READ_IN_16_COLOR_MODE = 16;
const CHANNEL_LEVELS = Array.from({ length: 64 }, (_, level) => (level === 63 ? 0xff : level * 4));

export interface PalResource { colors: Uint8Array; }

export function decodePal(payload: Uint8Array): PalResource {
  const body = chunkBody(payload, 'PAL:VGA:');
  const size = COLORS_READ_IN_16_COLOR_MODE * 3;
  if (!body || body.length < size) throw new Error('PAL:VGA: missing or short');
  const colors = body.slice(0, size).map((level) => {
    const value = CHANNEL_LEVELS[level];
    if (value === undefined) throw new Error(`PAL:VGA: channel level ${level} above 63`);
    return value;
  });
  return { colors };
}
