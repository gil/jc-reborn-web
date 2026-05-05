const MS_PER_TICK = 20; // 1 tick = 20ms ≈ 50Hz (events.c:108: delay *= 20)

let ticks = 0;
let acc = 0;
let lastMs = performance.now();

export function pumpTicks(): number {
  const now = performance.now();
  acc += now - lastMs;
  lastMs = now;
  let elapsed = 0;
  while (acc >= MS_PER_TICK) { acc -= MS_PER_TICK; ticks++; elapsed++; }
  return elapsed;
}

export function getTicks(): number { return ticks; }
