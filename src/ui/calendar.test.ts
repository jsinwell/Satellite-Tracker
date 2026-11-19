import { describe, expect, it } from 'vitest';
import {
  clampSettable,
  monthOf,
  monthSettable,
  monthWeeks,
  moveByKey,
  onDay,
  shiftDays,
  shiftMonth,
  shiftMonths,
  startOfDay,
  timePart,
  withTimePart,
} from './calendar';
import { SETTABLE_RANGE_MS } from './format';

const eclipse = Date.UTC(2027, 7, 2, 10, 7, 30);

describe('monthWeeks', () => {
  it('lays a month out in six weeks from Sunday', () => {
    const weeks = monthWeeks({ year: 2027, month: 7 });
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    // August 2027 starts on a Sunday.
    expect(weeks[0][0]).toMatchObject({ day: 1, inMonth: true, startMs: Date.UTC(2027, 7, 1) });
    expect(weeks[0][1].startMs).toBe(Date.UTC(2027, 7, 2));
    expect(weeks[4][2]).toMatchObject({ day: 31, inMonth: true });
    expect(weeks[4][3]).toMatchObject({ day: 1, inMonth: false });
  });

  it('fills out the first week with the end of the month before', () => {
    // November 2026 starts on a Sunday too; December on a Tuesday.
    const weeks = monthWeeks({ year: 2026, month: 11 });
    expect(weeks[0].map((day) => day.day)).toEqual([29, 30, 1, 2, 3, 4, 5]);
    expect(weeks[0].map((day) => day.inMonth)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('holds every day of the month once, in order', () => {
    for (const month of [
      { year: 2024, month: 1 },
      { year: 2027, month: 1 },
      { year: 1957, month: 9 },
      { year: 2100, month: 11 },
    ]) {
      const days = monthWeeks(month)
        .flat()
        .filter((day) => day.inMonth)
        .map((day) => day.day);
      const length = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
      expect(days).toEqual(Array.from({ length }, (_, index) => index + 1));
    }
  });

  it('marks the days outside the settable range', () => {
    const first = monthWeeks({ year: 1957, month: 0 }).flat();
    expect(first.filter((day) => !day.settable).every((day) => !day.inMonth)).toBe(true);
    expect(first.find((day) => day.inMonth)?.settable).toBe(true);
    expect(first[0].settable).toBe(false);

    const last = monthWeeks({ year: 2100, month: 11 }).flat();
    expect(last.filter((day) => day.inMonth).every((day) => day.settable)).toBe(true);
    expect(last[last.length - 1].settable).toBe(false);
  });
});

describe('months', () => {
  it('are found for an instant, in UTC', () => {
    expect(monthOf(eclipse)).toEqual({ year: 2027, month: 7 });
    expect(monthOf(Date.UTC(2027, 7, 1) - 1)).toEqual({ year: 2027, month: 6 });
  });

  it('step across the ends of years', () => {
    expect(shiftMonth({ year: 2027, month: 11 }, 1)).toEqual({ year: 2028, month: 0 });
    expect(shiftMonth({ year: 2027, month: 0 }, -1)).toEqual({ year: 2026, month: 11 });
    expect(shiftMonth({ year: 2027, month: 7 }, -20)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2027, month: 7 }, 12)).toEqual({ year: 2028, month: 7 });
  });

  it('can be gone to from 1957 through 2100', () => {
    expect(monthSettable({ year: 1957, month: 0 })).toBe(true);
    expect(monthSettable({ year: 1956, month: 11 })).toBe(false);
    expect(monthSettable({ year: 2100, month: 11 })).toBe(true);
    expect(monthSettable({ year: 2101, month: 0 })).toBe(false);
  });
});

describe('moving an instant', () => {
  it('to another day keeps the time of day', () => {
    expect(onDay(eclipse, Date.UTC(2030, 0, 15))).toBe(Date.UTC(2030, 0, 15, 10, 7, 30));
    expect(startOfDay(eclipse)).toBe(Date.UTC(2027, 7, 2));
    // Before 1970, too.
    expect(startOfDay(Date.UTC(1957, 9, 4, 19, 28))).toBe(Date.UTC(1957, 9, 4));
  });

  it('by days and by months', () => {
    expect(shiftDays(eclipse, 7)).toBe(Date.UTC(2027, 7, 9, 10, 7, 30));
    expect(shiftDays(eclipse, -2)).toBe(Date.UTC(2027, 6, 31, 10, 7, 30));
    expect(shiftMonths(eclipse, 1)).toBe(Date.UTC(2027, 8, 2, 10, 7, 30));
    expect(shiftMonths(eclipse, -12)).toBe(Date.UTC(2026, 7, 2, 10, 7, 30));
  });

  it('by a month from a day the next does not have lands on its last', () => {
    expect(shiftMonths(Date.UTC(2027, 0, 31, 6), 1)).toBe(Date.UTC(2027, 1, 28, 6));
    expect(shiftMonths(Date.UTC(2028, 0, 31, 6), 1)).toBe(Date.UTC(2028, 1, 29, 6));
  });

  it('stops at the ends of the settable range', () => {
    expect(shiftDays(SETTABLE_RANGE_MS.first, -1)).toBe(SETTABLE_RANGE_MS.first);
    expect(shiftMonths(SETTABLE_RANGE_MS.last, 1)).toBe(SETTABLE_RANGE_MS.last);
    expect(clampSettable(0)).toBe(0);
    expect(clampSettable(Date.UTC(1900, 0, 1))).toBe(SETTABLE_RANGE_MS.first);
  });
});

describe('moveByKey', () => {
  // A Monday.
  const at = (day: number, month = 7, year = 2027) => Date.UTC(year, month, day, 10, 7, 30);

  it('goes a day or a week with the arrows', () => {
    expect(moveByKey(eclipse, 'ArrowLeft', false)).toBe(at(1));
    expect(moveByKey(eclipse, 'ArrowRight', false)).toBe(at(3));
    expect(moveByKey(eclipse, 'ArrowDown', false)).toBe(at(9));
    expect(moveByKey(eclipse, 'ArrowUp', false)).toBe(at(26, 6));
  });

  it('goes to the ends of the week with Home and End', () => {
    expect(moveByKey(eclipse, 'Home', false)).toBe(at(1));
    expect(moveByKey(eclipse, 'End', false)).toBe(at(7));
    expect(moveByKey(at(1), 'Home', false)).toBe(at(1));
  });

  it('goes a month with Page Up and Page Down, and a year with Shift', () => {
    expect(moveByKey(eclipse, 'PageDown', false)).toBe(at(2, 8));
    expect(moveByKey(eclipse, 'PageUp', false)).toBe(at(2, 6));
    expect(moveByKey(eclipse, 'PageDown', true)).toBe(at(2, 7, 2028));
    expect(moveByKey(eclipse, 'PageUp', true)).toBe(at(2, 7, 2026));
  });

  it('leaves other keys alone', () => {
    expect(moveByKey(eclipse, 'Enter', false)).toBeNull();
    expect(moveByKey(eclipse, 'a', false)).toBeNull();
    expect(moveByKey(eclipse, 'Tab', true)).toBeNull();
  });
});

describe('the time of day', () => {
  it('comes apart into hours, minutes and seconds', () => {
    expect(timePart(eclipse, 'hours')).toBe(10);
    expect(timePart(eclipse, 'minutes')).toBe(7);
    expect(timePart(eclipse, 'seconds')).toBe(30);
    expect(timePart(Date.UTC(1957, 9, 4, 19, 28, 34), 'hours')).toBe(19);
  });

  it('has one part replaced without the others changing', () => {
    expect(withTimePart(eclipse, 'hours', 23)).toBe(Date.UTC(2027, 7, 2, 23, 7, 30));
    expect(withTimePart(eclipse, 'minutes', 0)).toBe(Date.UTC(2027, 7, 2, 10, 0, 30));
    expect(withTimePart(eclipse, 'seconds', 59)).toBe(Date.UTC(2027, 7, 2, 10, 7, 59));
  });
});
