export const STEP_MS = 50;
export const CLOCK_MS = 16;

export class EngineClock {
  private nextTick: number;
  private nextStep: number;

  constructor(now: number) {
    this.nextTick = now + CLOCK_MS;
    this.nextStep = now + STEP_MS;
  }

  ticksDue(now: number): number {
    let ticks = 0;
    for (; this.nextTick <= now; this.nextTick += CLOCK_MS) ticks++;
    return ticks;
  }

  stepDue(now: number): boolean {
    if (now < this.nextStep) return false;
    while (this.nextStep <= now) this.nextStep += STEP_MS;
    return true;
  }

  resume(now: number): void {
    this.nextTick = now + CLOCK_MS;
    this.nextStep = now + STEP_MS;
  }
}
