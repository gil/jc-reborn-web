export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface DayCounters {
  numDays: number;
  introduction: number;
  year: number;
  month: number;
  day: number;
}

export const HOLIDAY_NONE = 0;
export const HOLIDAY_HALLOWEEN = 1;
export const HOLIDAY_CHRISTMAS = 2;
export const HOLIDAY_NEW_YEAR = 3;
export const HOLIDAY_ST_PATRICK = 4;

const SLOTS = 16;

export function halfHourSlot(hhmm: number): number {
  return (Math.trunc(hhmm / 50) + Math.trunc((hhmm % 100) / 30) + 14) % SLOTS;
}

export function timeSlot(clock: WallClock, startTime: number): number {
  const now = clock.hour * 100 + (clock.minute >= 30 ? 30 : 0);
  return (halfHourSlot(now) - halfHourSlot(startTime) + SLOTS) % SLOTS;
}

export function holidayOf({ month, day }: WallClock): number {
  if (month === 10 && day > 28) return HOLIDAY_HALLOWEEN;
  if (month === 12 && day > 22 && day < 26) return HOLIDAY_CHRISTMAS;
  if (month === 12 && day > 28) return HOLIDAY_NEW_YEAR;
  if (month === 1 && day === 1) return HOLIDAY_NEW_YEAR;
  if (month === 3 && day > 14 && day < 18) return HOLIDAY_ST_PATRICK;
  return HOLIDAY_NONE;
}

export function wallClockOf(date: Date): WallClock {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
}
