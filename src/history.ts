/**
 * Stored punches are one flat list spanning every day that was ever loaded.
 * This module is what turns that list into days and months: the calculator only
 * ever looks at one day at a time, so a day has to be picked out before
 * `computeDay` sees it — otherwise the gap between Monday evening and Tuesday
 * morning would be counted as a break.
 */
import { computeDay } from "./compute";
import { dayKey, monthKey, startOfDay } from "./time";
import type { DayMeta, DayResult, Filter, Session, Settings } from "./types";

export interface DayEntry {
  /** `2026-08-07` */
  key: string;
  /** `2026-08` */
  month: string;
  /** Midnight IST of the day, as UTC ms — sorts the entry and labels it. */
  at: number;
  sessions: Session[];
  result: DayResult;
  /** When these punches were last written to storage; null for pre-history data. */
  savedAt: number | null;
  /** When the day was signed off in the day sheet; null while it is still in progress. */
  submittedAt: number | null;
}

export interface MonthEntry {
  key: string;
  at: number;
  days: number;
}

/** Split the flat list into days, each already sorted by punch-in. */
export function groupByDay(sessions: Session[]): Map<string, Session[]> {
  const byDay = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => a.in - b.in)) {
    const key = dayKey(s.in);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  return byDay;
}

/** Every stored day, newest first, each with its own totals. */
export function buildHistory(
  sessions: Session[],
  settings: Settings,
  meta: DayMeta,
  clock: number,
): DayEntry[] {
  const days: DayEntry[] = [];
  for (const [key, list] of groupByDay(sessions)) {
    const first = list[0];
    if (!first) continue;
    days.push({
      key,
      month: monthKey(first.in),
      at: startOfDay(first.in),
      sessions: list,
      result: computeDay(list, settings, clock),
      savedAt: meta[key]?.savedAt ?? null,
      submittedAt: meta[key]?.submittedAt ?? null,
    });
  }
  return days.sort((a, b) => b.at - a.at);
}

/** The months those days fall in, newest first. */
export function monthsOf(days: DayEntry[]): MonthEntry[] {
  const months = new Map<string, MonthEntry>();
  for (const d of days) {
    const seen = months.get(d.month);
    if (seen) seen.days += 1;
    else months.set(d.month, { key: d.month, at: d.at, days: 1 });
  }
  return [...months.values()].sort((a, b) => b.at - a.at);
}

export const daysInMonth = (days: DayEntry[], month: string): DayEntry[] =>
  month === "all" ? days : days.filter((d) => d.month === month);

/**
 * Which day the calculator should show. An explicitly picked day always wins,
 * even if the month filter has since moved off it; otherwise it follows the
 * newest day in the filtered range, so today's punches stay live by default.
 */
export function resolveDay(days: DayEntry[], filter: Filter): DayEntry | null {
  if (filter.day !== "latest") {
    const picked = days.find((d) => d.key === filter.day);
    if (picked) return picked;
  }
  return daysInMonth(days, filter.month)[0] ?? days[0] ?? null;
}

export interface Totals {
  days: number;
  worked: number;
  breakMs: number;
  office: number;
}

/** Roll a set of days up into one line of numbers. */
export function totalsOf(days: DayEntry[]): Totals {
  return days.reduce<Totals>(
    (acc, d) => ({
      days: acc.days + 1,
      worked: acc.worked + d.result.worked,
      breakMs: acc.breakMs + d.result.breakMs,
      office: acc.office + d.result.office,
    }),
    { days: 0, worked: 0, breakMs: 0, office: 0 },
  );
}
