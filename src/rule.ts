// The "regular who is slipping" rule. Pure functions over ISO dates (YYYY-MM-DD), no time zones.

export interface Thresholds {
  /** A regular attended in at least this many of the 8 usual weeks. Default 6. */
  minWeeksAttended: number;
  /** A regular averaged at least this many days a week over the 8 usual weeks. Default 2. */
  minUsualPerWeek: number;
  /** Slipping when the last 3 weeks, and the latest of them, are at most this share of usual. Default 0.6. */
  dropRatio: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { minWeeksAttended: 6, minUsualPerWeek: 2, dropRatio: 0.6 };

const DAY = 86_400_000;

export function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The Monday of the week containing `day`. */
export function monday(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d.getTime());
}

/** The 12 Mondays, oldest first, ending with the week of the data date. */
export function twelveMondays(dataDate: string): string[] {
  const last = at(monday(dataDate));
  return Array.from({ length: 12 }, (_, i) => iso(last - (11 - i) * 7 * DAY));
}

/** True when the data date's own week counts (the data date is a Saturday or Sunday). */
export function dataWeekCounts(dataDate: string): boolean {
  return new Date(`${dataDate}T00:00:00Z`).getUTCDay() % 6 === 0;
}

/**
 * Twelve Monday-to-Sunday weeks of days attended, oldest first; the last is the week of the data date.
 * `attendedDays` are distinct dates the member signed in. Visits after the data date are ignored.
 * A week that starts before `coverageStart` (the first date the exports cover) is null: the files cannot
 * vouch for it, so it is unknown rather than zero.
 */
export function weeklyVisits12w(attendedDays: Iterable<string>, dataDate: string, coverageStart?: string): (number | null)[] | null {
  if (!validDay(dataDate)) return null;
  const mondays = twelveMondays(dataDate);
  const oldest = at(mondays[0]!);
  const weeks: (number | null)[] = Array<number>(12).fill(0);
  const seen = new Set<string>();
  for (const day of attendedDays) {
    if (!validDay(day) || day > dataDate || seen.has(day)) continue;
    seen.add(day);
    const index = Math.floor((at(monday(day)) - oldest) / (7 * DAY));
    if (index >= 0 && index < 12) (weeks[index] as number)++;
  }
  if (coverageStart !== undefined && validDay(coverageStart)) {
    const known = at(coverageStart);
    mondays.forEach((start, index) => { if (at(start) < known) weeks[index] = null; });
  }
  return weeks;
}

export interface SlipWindow {
  /** Index (0-11) of the latest of the 3 recent weeks. */
  end: number;
  recent: (number | null)[];
  usual: (number | null)[];
}

export function slipWindow(weeks: (number | null)[], dataDate: string): SlipWindow {
  const end = dataWeekCounts(dataDate) ? 11 : 10;
  return { end, recent: weeks.slice(end - 2, end + 1), usual: weeks.slice(end - 10, end - 2) };
}

/**
 * A regular who is slipping: attended in at least 6 of the 8 weeks before the last 3, averaging 2 or more days
 * a week, and the last 3 weeks (and the latest of them) are at most 60% of that usual rate. The data date's week
 * counts only once it reaches Saturday; before that the 3 weeks end the week before. Unknown (null) weeks rule the
 * member out rather than read as a drop.
 */
export function slippingRegular(weeks: (number | null)[] | null, dataDate: string, t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  if (!weeks || weeks.length !== 12 || !validDay(dataDate)) return false;
  const { recent, usual } = slipWindow(weeks, dataDate);
  if (usual.length !== 8 || [...recent, ...usual].some((week) => week === null)) return false;
  const usualRate = (usual as number[]).reduce((sum, week) => sum + week, 0) / 8;
  const recentRate = (recent as number[]).reduce((sum, week) => sum + week, 0) / 3;
  return regular(usual as number[], t) &&
    recentRate <= usualRate * t.dropRatio && (recent[2] as number) <= usualRate * t.dropRatio;
}

/** The "regular" half of the rule, over the 8 usual weeks. */
export function regular(usual: number[], t: Thresholds = DEFAULT_THRESHOLDS): boolean {
  const usualRate = usual.reduce((sum, week) => sum + week, 0) / 8;
  return usual.length === 8 && usual.filter((week) => week > 0).length >= t.minWeeksAttended && usualRate >= t.minUsualPerWeek;
}
