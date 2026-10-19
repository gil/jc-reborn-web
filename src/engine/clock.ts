export const STEP_MS = 50;
export const CLOCK_MS = 16;
/** Windows 3.x GetCurrentTime moves in jumps of one 55 ms timer interrupt (OQ-36). */
export const TIME_STEP_MS = 55;

export class EngineClock {
  private start: number;
  private nextTick: number;
  private lastStep: number;

  constructor(now: number) {
    this.start = now;
    this.nextTick = now + CLOCK_MS;
    this.lastStep = now;
  }

  ticksDue(now: number): number {
    const time = this.windowsTime(now);
    let ticks = 0;
    for (; this.nextTick <= time; this.nextTick += CLOCK_MS) ticks++;
    return ticks;
  }

  stepDue(now: number): boolean {
    const time = this.windowsTime(now);
    if (time < this.lastStep + STEP_MS) return false;
    this.lastStep = time;
    return true;
  }

  resume(now: number): void {
    this.start = now;
    this.nextTick = now + CLOCK_MS;
    this.lastStep = now;
  }

  private windowsTime(now: number): number {
    return this.start + Math.floor((now - this.start) / TIME_STEP_MS) * TIME_STEP_MS;
  }
}
