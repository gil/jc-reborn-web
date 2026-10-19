export interface Timers {
  now: number;
  walk: number;
  idleWait: number;
  surf: number;
  waves: number;
}

export function makeTimers(): Timers {
  return { now: 0, walk: 0, idleWait: 0, surf: 0, waves: 0 };
}

export function clockTick(timers: Timers): void {
  timers.now = (timers.now + 1) >>> 0;
  if (timers.walk !== 0) timers.walk--;
  if (timers.idleWait !== 0) timers.idleWait--;
  if (timers.surf !== 0) timers.surf--;
  if (timers.waves !== 0) timers.waves--;
}
