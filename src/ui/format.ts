const utcFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // Not `hour12: false`, which makes en-US print midnight as 24:00.
  hourCycle: 'h23',
});

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `Nov 16, 2026, 06:31:07` */
export function formatUtc(timeMs: number): string {
  return utcFormat.format(timeMs);
}

const utcBriefFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The same without the year, for where there is one row to fit it in: `Nov 16, 06:31:07` */
export function formatUtcBrief(timeMs: number): string {
  return utcBriefFormat.format(timeMs);
}

/** `19,575` */
export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

/** `51.63° N` */
export function formatLatitude(degrees: number): string {
  return `${Math.abs(degrees).toFixed(2)}° ${degrees >= 0 ? 'N' : 'S'}`;
}

/** `104.70° W` */
export function formatLongitude(degrees: number): string {
  return `${Math.abs(degrees).toFixed(2)}° ${degrees >= 0 ? 'E' : 'W'}`;
}

/** A coarse, human-scale duration: `45 s`, `12 min`, `5.3 h`, `3.2 d`. */
export function formatDuration(ms: number): string {
  const seconds = Math.abs(ms) / 1000;
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/**
 * How long ago something happened, the way a person would say it: `just now`,
 * `12 minutes ago`, `1 hour ago`, `3 days ago`. Rounded to the nearest whole
 * unit, since "68 minutes ago" is precision nobody asked for.
 */
export function formatAgo(ms: number): string {
  const ago = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'} ago`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return ago(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ago(hours, 'hour');
  return ago(Math.round(hours / 24), 'day');
}

/** An orbital period: `92.9 min` for low orbits, `23.93 h` for high ones. */
export function formatPeriod(minutes: number): string {
  return minutes < 600 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(2)} h`;
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The nearest of the eight compass points to an azimuth in degrees: `NE`. */
export function formatCompass(azimuth: number): string {
  const sector = Math.round((((azimuth % 360) + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[sector];
}

// The viewer's own time zone: passes are planned by the clock on the wall.
const localTimeFormat = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const localClockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const timeZoneFormat = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' });

/** A time in the viewer's time zone, with the day of the week: `Tue 9:42 PM`. */
export function formatLocalTime(timeMs: number): string {
  return localTimeFormat.format(timeMs);
}

/** A time of day in the viewer's time zone: `5:58 AM`. */
export function formatLocalClock(timeMs: number): string {
  return localClockFormat.format(timeMs);
}

/** The viewer's time zone as it is written at `timeMs`, for a footnote: `CST`. */
export function localTimeZone(timeMs: number): string {
  return (
    timeZoneFormat.formatToParts(timeMs).find((part) => part.type === 'timeZoneName')?.value ?? ''
  );
}

/** A latitude and longitude together: `41.88° N, 87.63° W`. */
export function formatPlace(latitude: number, longitude: number): string {
  return `${formatLatitude(latitude)}, ${formatLongitude(longitude)}`;
}

const ARCSECONDS_PER_RADIAN = 206_264.806;
const AU_KM = 149_597_870.7;
const LIGHT_KM_PER_SECOND = 299_792.458;

/**
 * How wide something looks in the sky, the way astronomers write it: minutes
 * of arc for the Moon (`31.4′`), seconds for a planet (`44.5″`).
 */
export function formatAngularSize(radians: number): string {
  const arcseconds = radians * ARCSECONDS_PER_RADIAN;
  return arcseconds >= 120 ? `${(arcseconds / 60).toFixed(1)}′` : `${arcseconds.toFixed(1)}″`;
}

/** How much of a disc is lit, as a calendar would say it of the Moon: `full`, `new`, `62% lit`. */
export function litWords(fraction: number): string {
  const percent = Math.round(fraction * 100);
  if (percent >= 99) return 'full';
  if (percent <= 1) return 'new';
  return `${percent}% lit`;
}

/** How far the Moon or a planet is: km for the Moon, astronomical units beyond. */
export function formatBodyDistance(km: number): string {
  return km < 0.01 * AU_KM
    ? `${formatInteger(Math.round(km / 100) * 100)} km`
    : `${(km / AU_KM).toFixed(2)} AU`;
}

/** How long light takes to cover `km`: `1.3 s`, `35 min`, `4.1 h`. */
export function formatLightTime(km: number): string {
  const seconds = km / LIGHT_KM_PER_SECOND;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/** The earliest and latest instants the time can be set to: the space age, and this century. */
export const SETTABLE_RANGE_MS = {
  first: Date.UTC(1957, 0, 1),
  last: Date.UTC(2100, 11, 31, 23, 59, 59),
} as const;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * An instant written out to be read back or typed over, in UTC:
 * `2027-08-02 10:07:00`. Milliseconds are dropped.
 */
export function toUtcField(timeMs: number): string {
  const date = new Date(timeMs);
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

const UTC_FIELD =
  /^(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(?:Z|UTC)?$/i;

/**
 * The instant a typed date and time names, taking it as UTC, or null if it
 * is not one or lies outside `SETTABLE_RANGE_MS`. The date comes first, year
 * to day; the time is optional, and so are its seconds. Between the two goes
 * a space, or the `T` of the form computers write.
 */
export function fromUtcField(text: string): number | null {
  const match = UTC_FIELD.exec(text.trim());
  if (!match) return null;
  // A part left out is a zero: no time is midnight, and no seconds is none.
  const [year, month, day, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const timeMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  // Date.UTC rolls a day that does not exist, like February 30, into the
  // next month rather than refusing it; such a date does not come back the same.
  const date = new Date(timeMs);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timeMs >= SETTABLE_RANGE_MS.first && timeMs <= SETTABLE_RANGE_MS.last ? timeMs : null;
}
