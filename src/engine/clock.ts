const MS_PER_TICK = 20; // 1 tick = 20ms ≈ 50Hz (events.c:108: delay *= 20)

let totalMs = 0;
let lastMs = performance.now();

export function pumpMs(): void {
  const now = performance.now();
  totalMs += now - lastMs;
  lastMs = now;
}

export function hasEnoughMs(ms: number): boolean {
  return totalMs >= ms;
}

export function consumeMs(ms: number): void {
  totalMs -= ms;
}

export function msPerTick(): number { return MS_PER_TICK; }

export function resetClock(): void { lastMs = performance.now(); }
