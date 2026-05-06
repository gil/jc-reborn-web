let ctx: AudioContext | null = null;
let muted = false;
const rawBuffers = new Map<number, ArrayBuffer>();
const decoded = new Map<number, AudioBuffer>();
const SOUND_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

export async function initSound(): Promise<void> {
  await Promise.all(SOUND_IDS.map(async (n) => {
    try {
      const r = await fetch(`/data/sound${n}.wav`);
      if (!r.ok) return;
      rawBuffers.set(n, await r.arrayBuffer());
    } catch { /* missing sound ok */ }
  }));
}

export async function resumeAudioCtx(): Promise<void> {
  if (ctx) { await ctx.resume(); return; }
  ctx = new AudioContext();
  await Promise.all([...rawBuffers.entries()].map(async ([n, buf]) => {
    try {
      decoded.set(n, await ctx!.decodeAudioData(buf.slice(0)));
    } catch { /* bad file ok */ }
  }));
}

export function toggleMute(): boolean {
  muted = !muted;
  return muted;
}

export function playSample(n: number): void {
  if (!ctx || muted) return;
  const buf = decoded.get(n);
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}
