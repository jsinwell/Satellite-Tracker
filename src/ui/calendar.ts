import { SETTABLE_RANGE_MS } from './format';

/**
 * The calendar behind the date picker. Everything is in UTC, as the time bar
 * is: a day here is a UTC day, whatever the viewer's own time zone.
 */

const DAY_MS = 86_400_000;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Sunday first, as American calendars have it. */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** A month of a year; `month` counts from 0, as `Date` does. */
export interface Month {
  year: number;
  month: number;
}

export interface CalendarDay {
  /** Midnight UTC at the start of the day. */
  startMs: number;
  /** The day of the month, from 1. */
  day: number;
  /** False for the days of the months before and after that fill out the weeks. */
  inMonth: boolean;
  /** Whether any of the day is within `SETTABLE_RANGE_MS`. */
  settable: boolean;
}

/** The month an instant falls in. */
export function monthOf(timeMs: number): Month {
  const date = new Date(timeMs);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

/** The month `by` months after `from`, or before it if negative. */
export function shiftMonth(from: Month, by: number): Month {
  const count = from.year * 12 + from.month + by;
  return { year: Math.floor(count / 12), month: ((count % 12) + 12) % 12 };
}

/** Whether any instant of a month can be gone to. */
export function monthSettable({ year, month }: Month): boolean {
  return (
    Date.UTC(year, month + 1, 1) > SETTABLE_RANGE_MS.first &&
    Date.UTC(year, month, 1) <= SETTABLE_RANGE_MS.last
  );
}

/**
 * A month laid out as a calendar page: six weeks of seven days, the first
 * and last of them filled out with the neighboring months' days. Always six,
 * so the page is the same height for every month.
 */
export function monthWeeks({ year, month }: Month): CalendarDay[][] {
  const first = Date.UTC(year, month, 1);
  const start = first - new Date(first).getUTCDay() * DAY_MS;
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week++) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const startMs = start + (week * 7 + weekday) * DAY_MS;
      const date = new Date(startMs);
      days.push({
        startMs,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month && date.getUTCFullYear() === year,
        settable: startMs + DAY_MS > SETTABLE_RANGE_MS.first && startMs <= SETTABLE_RANGE_MS.last,
      });
    }
    weeks.push(days);
  }
  return weeks;
}

/** Midnight UTC at the start of the day an instant falls in. */
export function startOfDay(timeMs: number): number {
  return Math.floor(timeMs / DAY_MS) * DAY_MS;
}

/** The nearest instant that can be gone to. */
export function clampSettable(timeMs: number): number {
  return Math.min(SETTABLE_RANGE_MS.last, Math.max(SETTABLE_RANGE_MS.first, timeMs));
}

/** The same time of day as `timeMs`, on the day that starts at `dayStartMs`. */
export function onDay(timeMs: number, dayStartMs: number): number {
  return clampSettable(dayStartMs + (timeMs - startOfDay(timeMs)));
}

/** `timeMs` moved by whole days, keeping the time of day. */
export function shiftDays(timeMs: number, days: number): number {
  return clampSettable(timeMs + days * DAY_MS);
}

/**
 * `timeMs` moved by whole months, keeping the day of the month and the time
 * of day. A day the new month does not have becomes its last: a month on
 * from January 31 is the end of February.
 */
export function shiftMonths(timeMs: number, months: number): number {
  const date = new Date(timeMs);
  const to = shiftMonth({ year: date.getUTCFullYear(), month: date.getUTCMonth() }, months);
  const lastDay = new Date(Date.UTC(to.year, to.month + 1, 0)).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDay);
  return clampSettable(Date.UTC(to.year, to.month, day) + (timeMs - startOfDay(timeMs)));
}

/**
 * Where a key takes the day a calendar's keyboard is on, keeping the time of
 * day, or null if the key is not one a calendar answers to. The arrows go to
 * the day before or after and a week either way, Page Up and Page Down a
 * month (a year with Shift), and Home and End to the ends of the week, as
 * calendars on the web are expected to.
 */
export function moveByKey(timeMs: number, key: string, shift: boolean): number | null {
  const weekday = new Date(timeMs).getUTCDay();
  switch (key) {
    case 'ArrowLeft':
      return shiftDays(timeMs, -1);
    case 'ArrowRight':
      return shiftDays(timeMs, 1);
    case 'ArrowUp':
      return shiftDays(timeMs, -7);
    case 'ArrowDown':
      return shiftDays(timeMs, 7);
    case 'Home':
      return shiftDays(timeMs, -weekday);
    case 'End':
      return shiftDays(timeMs, 6 - weekday);
    case 'PageUp':
      return shiftMonths(timeMs, shift ? -12 : -1);
    case 'PageDown':
      return shiftMonths(timeMs, shift ? 12 : 1);
    default:
      return null;
  }
}

export type TimePart = 'hours' | 'minutes' | 'seconds';

const PART_MS: Record<TimePart, number> = { hours: 3_600_000, minutes: 60_000, seconds: 1000 };
/** How many values each part of a time of day can take. */
export const PART_COUNT: Record<TimePart, number> = { hours: 24, minutes: 60, seconds: 60 };

/** One part of an instant's time of day: its hours, minutes or whole seconds. */
export function timePart(timeMs: number, part: TimePart): number {
  return Math.floor((timeMs - startOfDay(timeMs)) / PART_MS[part]) % PART_COUNT[part];
}

/** `timeMs` with one part of its time of day replaced, and the rest as it was. */
export function withTimePart(timeMs: number, part: TimePart, value: number): number {
  return clampSettable(timeMs + (value - timePart(timeMs, part)) * PART_MS[part]);
}
