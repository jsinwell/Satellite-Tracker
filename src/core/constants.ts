/** WGS-84 equatorial radius. */
export const EARTH_RADIUS_KM = 6378.137;

/** Earth's standard gravitational parameter, km³/s². */
export const EARTH_MU = 398600.4418;

export const MS_PER_DAY = 86_400_000;
export const MINUTES_PER_DAY = 1440;

/** Julian date of the Unix epoch (1970-01-01T00:00:00Z). */
export const UNIX_EPOCH_JD = 2440587.5;

export function julianDate(timeMs: number): number {
  return timeMs / MS_PER_DAY + UNIX_EPOCH_JD;
}
