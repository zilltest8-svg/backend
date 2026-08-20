/**
 * Every time and date in this app is shown in India Standard Time (UTC+05:30),
 * on a 12-hour clock, regardless of what offset the API sends or what time zone
 * the machine is set to. Internally everything is absolute UTC milliseconds.
 */

export const MIN = 60_000;
export const IST_OFFSET = 330; // minutes east of UTC

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Parse an ISO timestamp to UTC ms. A missing offset is read as IST. */
export function parseISO(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = ISO.exec(String(value).trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const [, y, mo, d, h, mi, s, zone] = m;

  let offset = IST_OFFSET;
  if (zone) {
    if (zone === "Z") offset = 0;
    else {
      const z = /([+-])(\d{2}):?(\d{2})/.exec(zone);
      if (z) offset = (z[1] === "-" ? -1 : 1) * (Number(z[2]) * 60 + Number(z[3]));
    }
  }
  return (
    Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0)) -
    offset * MIN
  );
}

/** Shift into IST so the getUTC* accessors read as Indian wall-clock time. */
const ist = (t: number): Date => new Date(t + IST_OFFSET * MIN);
const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));
const h12 = (d: Date): number => d.getUTCHours() % 12 || 12;
const mer = (d: Date): string => (d.getUTCHours() >= 12 ? "PM" : "AM");

/** `09:47 AM` */
export function clockTime(t: number | null): string {
  if (t == null) return "--:--";
  const d = ist(t);
  return `${p2(h12(d))}:${p2(d.getUTCMinutes())} ${mer(d)}`;
}

/** `9:47 AM` — no leading zero, for headline use. */
export function clockShort(t: number | null): string {
  if (t == null) return "--:--";
  const d = ist(t);
  return `${h12(d)}:${p2(d.getUTCMinutes())} ${mer(d)}`;
}

/** `03:00:07 PM` */
export function clockWithSeconds(t: number): string {
  const d = ist(t);
  return `${p2(h12(d))}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${mer(d)}`;
}

/** `07/08/2026` — Indian day-first date format. */
export function dateDMY(t: number): string {
  const d = ist(t);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** `Fri, 07 Aug 2026` */
export function dateFull(t: number): string {
  const d = ist(t);
  return `${DAYS[d.getUTCDay()]}, ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `FRIDAY` */
export function weekday(t: number): string {
  const full = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
  return full[ist(t).getUTCDay()] ?? "";
}

/** `06 Aug 2026` */
export function dateLabel(t: number): string {
  const d = ist(t);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function dayKey(t: number): string {
  const d = ist(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** `2026-08` — the key a stored day is filed and filtered under. */
export function monthKey(t: number): string {
  const d = ist(t);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
}

/** `Aug 2026` */
export function monthLabel(t: number): string {
  const d = ist(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `Aug 2026` from a stored `2026-08` key, for a month with no days left in it. */
export function monthLabelFromKey(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  const name = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : key;
}

/** `07 Aug` — day and month only, for dense history rows. */
export function dayMonth(t: number): string {
  const d = ist(t);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}`;
}

/** Midnight IST of the day containing `t`, as UTC ms. */
export function startOfDay(t: number): number {
  const d = ist(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - IST_OFFSET * MIN;
}

export const startOfToday = (): number => startOfDay(Date.now());

/** Midnight IST of a `YYYY-MM-DD` key — what an `<input type="date">` hands back. */
export function startOfDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d)) - IST_OFFSET * MIN;
  return Number.isNaN(t) ? null : t;
}

/** `7:32` */
export function hm(ms: number): string {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / MIN);
  return `${neg ? "-" : ""}${Math.floor(total / 60)}:${p2(total % 60)}`;
}

/** `7:32:09` */
export function hms(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}

/** Split for per-digit animation: `["7", "32", "09"]` */
export function hmsParts(ms: number): [string, string, string] {
  const s = Math.floor(Math.abs(ms) / 1000);
  return [String(Math.floor(s / 3600)), p2(Math.floor(s / 60) % 60), p2(s % 60)];
}

/** `8h 00m` — padded, for the goal headline. */
export function hoursMinutes(ms: number): string {
  const total = Math.round(Math.abs(ms) / MIN);
  return `${Math.floor(total / 60)}h ${p2(total % 60)}m`;
}

/** `1h 26m` */
export function human(ms: number): string {
  const total = Math.round(Math.abs(ms) / MIN);
  const h = Math.floor(total / 60);
  return `${h ? `${h}h ` : ""}${total % 60}m`;
}

/** Current IST wall-clock as `"14:05"`, ready for an `<input type="time">`. */
export function inputTimeNow(): string {
  const d = ist(Date.now());
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** "09:30" from a `<input type="time">` to minutes past midnight. */
export function minutesFromInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
