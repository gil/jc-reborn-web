import { describe, expect, it } from 'vitest';
import {
  halfHourSlot, holidayOf, timeSlot,
  HOLIDAY_CHRISTMAS, HOLIDAY_HALLOWEEN, HOLIDAY_NEW_YEAR, HOLIDAY_NONE, HOLIDAY_ST_PATRICK,
  type WallClock,
} from './calendar.js';

const at = (month: number, day: number, hour = 12, minute = 0): WallClock => ({ year: 1992, month, day, hour, minute });

describe('time slots', () => {
  it('maps HHMM to half-hour slots of an 8-hour cycle', () => {
    // SCRANTIC 1018:0c21
    expect(halfHourSlot(900)).toBe(0);
    expect(halfHourSlot(930)).toBe(1);
    expect(halfHourSlot(1500)).toBe(12);
    expect(halfHourSlot(1700)).toBe(0);
    expect(halfHourSlot(0)).toBe(14);
  });

  it('counts slots from the start time and drops minutes inside a half hour', () => {
    // SCRANTIC 1018:0540
    expect(timeSlot(at(6, 1, 9, 0), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 9, 29), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 9, 30), 900)).toBe(1);
    expect(timeSlot(at(6, 1, 15, 0), 900)).toBe(12);
    expect(timeSlot(at(6, 1, 16, 59), 900)).toBe(15);
    expect(timeSlot(at(6, 1, 17, 0), 900)).toBe(0);
    expect(timeSlot(at(6, 1, 8, 0), 900)).toBe(14);
  });
});

describe('holidays', () => {
  it('knows the four holiday date ranges', () => {
    // SCRANTIC 1018:0540
    expect(holidayOf(at(10, 28))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(10, 29))).toBe(HOLIDAY_HALLOWEEN);
    expect(holidayOf(at(10, 31))).toBe(HOLIDAY_HALLOWEEN);
    expect(holidayOf(at(12, 22))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(12, 23))).toBe(HOLIDAY_CHRISTMAS);
    expect(holidayOf(at(12, 25))).toBe(HOLIDAY_CHRISTMAS);
    expect(holidayOf(at(12, 26))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(12, 29))).toBe(HOLIDAY_NEW_YEAR);
    expect(holidayOf(at(1, 1))).toBe(HOLIDAY_NEW_YEAR);
    expect(holidayOf(at(1, 2))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(3, 14))).toBe(HOLIDAY_NONE);
    expect(holidayOf(at(3, 15))).toBe(HOLIDAY_ST_PATRICK);
    expect(holidayOf(at(3, 17))).toBe(HOLIDAY_ST_PATRICK);
    expect(holidayOf(at(3, 18))).toBe(HOLIDAY_NONE);
  });
});
