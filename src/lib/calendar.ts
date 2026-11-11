/** Week-based calendar helpers. Weeks start on Monday and are identified by that date (UTC). */

const DAY_MS = 86_400_000;

export function parseDate(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addWeeks(iso: string, n: number): string {
  return formatDate(parseDate(iso) + n * 7 * DAY_MS);
}

/** Monday of the week that contains the given date. */
export function mondayOf(iso: string): string {
  const t = parseDate(iso);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday
  return formatDate(t - dow * DAY_MS);
}

export function isMonday(iso: string): boolean {
  return (new Date(parseDate(iso)).getUTCDay() + 6) % 7 === 0;
}

/** ISO-8601 week number (1-53). */
export function isoWeek(iso: string): number {
  const d = new Date(parseDate(iso));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fdow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fdow + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

/** Fraction of the year (0-1) for seasonal Fourier terms, based on day of year. */
export function yearPhase(iso: string): number {
  const t = parseDate(iso);
  const y = new Date(t).getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const len = Date.UTC(y + 1, 0, 1) - start;
  return (t - start) / len;
}

export function weeksBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / (7 * DAY_MS));
}
