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
