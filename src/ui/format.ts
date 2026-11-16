const utcFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** `16 Nov 2026, 06:31:07` */
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

/** An orbital period: `92.9 min` for low orbits, `23.93 h` for high ones. */
export function formatPeriod(minutes: number): string {
  return minutes < 600 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(2)} h`;
}
