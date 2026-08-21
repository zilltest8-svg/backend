import type { DayResult } from "./types";
import { MIN, clockShort, clockTime, dateDMY, hm } from "./time";

/**
 * One row per work session and per break, in the order they happened. The
 * day totals repeat on every row so the sheet can be filtered or pivoted
 * without needing a separate summary block.
 */
export const SHEET_HEADERS = [
  "Date",
  "Day",
  "Type",
  "No.",
  "Punch In",
  "Punch Out",
  "Duration",
  "Minutes",
  "Total Work",
  "Total Break",
  "Time In Office",
  "Can Leave At",
] as const;

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function shortDay(t: number): string {
  // dateDMY already renders in IST; derive the weekday from the same shift
  const d = new Date(t + 330 * MIN);
  return DAY_SHORT[d.getUTCDay()] ?? "";
}

/** The day as rows of plain strings, ready for a spreadsheet. */
export function toRows(day: DayResult): string[][] {
  if (day.first == null) return [];

  const date = dateDMY(day.first);
  const dayName = shortDay(day.first);
  const totalWork = hm(day.worked);
  const totalBreak = hm(day.breakMs);
  const inOffice = hm(day.office);
  const leave = day.leave == null ? "" : clockShort(day.leave);

  let work = 0;
  let brk = 0;

  return day.blocks.map((b) => {
    const isWork = b.kind === "work";
    const n = isWork ? (work += 1) : (brk += 1);
    const length = b.to - b.from;
    return [
      date,
      dayName,
      isWork ? "Work" : "Break",
      String(n),
      clockTime(b.from),
      b.live ? "Running" : clockTime(b.to),
      hm(length),
      String(Math.round(length / MIN)),
      totalWork,
      totalBreak,
      inOffice,
      leave,
    ];
  });
}

const escapeCsv = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Tab-separated — pastes straight into a spreadsheet cell range. */
export function toTSV(day: DayResult, withHeaders = true): string {
  const rows = toRows(day);
  const body = rows.map((r) => r.join("\t"));
  return (withHeaders ? [SHEET_HEADERS.join("\t"), ...body] : body).join("\n");
}

export function toCSV(day: DayResult, withHeaders = true): string {
  const rows = toRows(day).map((r) => r.map(escapeCsv).join(","));
  return (withHeaders ? [SHEET_HEADERS.join(","), ...rows] : rows).join("\n");
}

/** Payload for the Apps Script endpoint. */
export function toPayload(day: DayResult): { headers: string[]; rows: string[][] } {
  return { headers: [...SHEET_HEADERS], rows: toRows(day) };
}

/** Hand a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

export function csvFilename(day: DayResult): string {
  const stamp = day.first == null ? "day" : dateDMY(day.first).replace(/\//g, "-");
  return `office-time-${stamp}.csv`;
}
