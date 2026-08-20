import type { Block, DayResult, PunchPayload, Session, Settings } from "./types";
import { MIN, dayKey, parseISO, startOfDay } from "./time";

/**
 * The rule this app implements:
 *
 *   exit = first punch-in + work target + every break minute
 *
 * Lunch is just break time — take it whenever you like, it pushes your exit
 * back by exactly as long as you were away. `settings.free` optionally gifts
 * the first N break minutes.
 */
export function computeDay(sessions: Session[], settings: Settings, clock: number): DayResult {
  const sorted = [...sessions].sort((a, b) => a.in - b.in);
  const target = settings.target * MIN;

  const empty: DayResult = {
    sessions: sorted,
    blocks: [],
    now: clock,
    first: null,
    last: null,
    worked: 0,
    breakMs: 0,
    billableBreak: 0,
    efficiency: 0,
    span: target,
    elapsed: 0,
    office: 0,
    officeGoal: target,
    frac: 0,
    leave: null,
    remaining: target,
    overtime: 0,
    reached: false,
    status: "empty",
    liveBreak: 0,
    stale: false,
  };
  const first = sorted[0];
  if (!first) return empty;

  // Data from an earlier day must not keep counting, or an open session would
  // claim you had been at work for days. A day that was punched out of stops at
  // that last punch — anything later is time at home, and counting it would have
  // every stored day reporting fourteen hours in the office. Only a day left open
  // falls back to freezing at the day's end.
  const stale = dayKey(first.in) !== dayKey(clock);
  const closed = sorted.every((s) => s.out != null);
  const frozen = closed
    ? Math.max(...sorted.map((s) => s.out as number))
    : startOfDay(first.in) + 24 * 60 * MIN - MIN;
  const now = stale ? Math.min(clock, frozen) : clock;

  const blocks: Block[] = [];
  let worked = 0;
  let breakMs = 0;
  let open = false;
  let prevOut: number | null = null;

  for (const s of sorted) {
    const running = s.out == null;
    const rawEnd = running ? Math.max(now, s.in) : (s.out as number);

    // Clip against the previous session so an overlap (two punches covering the
    // same minutes) is never counted twice and never swallows a break.
    const start = prevOut == null ? s.in : Math.max(s.in, prevOut);
    const end = Math.max(start, rawEnd);

    if (prevOut != null && s.in > prevOut) {
      breakMs += s.in - prevOut;
      blocks.push({ kind: "break", from: prevOut, to: s.in, live: false });
    }
    if (end > start || running) {
      if (running) open = true;
      worked += end - start;
      blocks.push({ kind: "work", from: start, to: end, live: running, sessionId: s.id });
    }
    prevOut = prevOut == null ? end : Math.max(prevOut, end);
  }

  const last = prevOut as number;

  // Punched out with nothing after it, on the same day => you are on a break right
  // now. A day that is already over has no such break: nobody is coming back to
  // punch in, so counting the evening as break time would inflate every stored day.
  let liveBreak = 0;
  let onBreak = false;
  if (!open && !stale && now > last && dayKey(last) === dayKey(now)) {
    onBreak = true;
    liveBreak = now - last;
    breakMs += liveBreak;
    blocks.push({ kind: "break", from: last, to: now, live: true });
  }

  const billable = Math.max(0, breakMs - settings.free * MIN);
  const leave = first.in + target + billable;
  const span = Math.max(MIN, leave - first.in);
  const elapsed = Math.max(0, now - first.in);

  // "Time in office" is the clock-to-clock window minus every minute you were
  // away, so the headline counter stalls during a break instead of running on.
  // The goal loses the same break minutes, which keeps `reached` unchanged:
  // office >= officeGoal is exactly elapsed >= span.
  const office = Math.max(0, elapsed - breakMs);
  const officeGoal = Math.max(MIN, span - breakMs);

  return {
    sessions: sorted,
    blocks,
    now,
    first: first.in,
    last,
    worked,
    breakMs,
    billableBreak: billable,
    efficiency: target > 0 ? Math.min(1, worked / target) : 0,
    span,
    elapsed,
    office,
    officeGoal,
    frac: Math.min(1, office / officeGoal),
    leave,
    remaining: target - worked,
    overtime: Math.max(0, worked - target),
    reached: elapsed >= span,
    status: open ? "working" : onBreak ? "break" : "out",
    liveBreak,
    stale,
  };
}

export interface ParseResult {
  sessions: Session[];
  target?: number;
  added: number;
  skipped: number;
  /**
   * True when the response carried a whole-day list (`sessions_today`), which
   * makes it the authority for that day — re-pasting it replaces the day rather
   * than merging, so removed or corrected punches disappear instead of lingering.
   */
  full: boolean;
}

/** Read the punch API response into sessions. Throws with a readable message. */
export function parsePayload(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }

  const payload = data as PunchPayload;
  const whole =
    payload?.sessions_today ??
    payload?.sessions ??
    (Array.isArray(data) ? (data as PunchPayload["sessions_today"]) : undefined);
  const list = whole ?? (payload?.current_session ? [payload.current_session] : undefined);

  if (!Array.isArray(list)) throw new Error('No "sessions_today" array found in that response.');

  // Keyed by punch-in: the same punch listed twice in one response (say, once in
  // `sessions_today` and again as `current_session`) must collapse to one row.
  const byStart = new Map<number, Session>();
  let skipped = 0;

  for (const raw of list) {
    const punchIn = parseISO(raw?.punch_in ?? raw?.in ?? raw?.start);
    if (punchIn == null) {
      skipped += 1;
      continue;
    }
    const punchOut = parseISO(raw?.punch_out ?? raw?.out ?? raw?.end);
    const prev = byStart.get(punchIn);
    byStart.set(punchIn, {
      id: raw?.id != null ? String(raw.id) : (prev?.id ?? `t${punchIn}`),
      in: punchIn,
      // a closed copy always beats an open one — it carries more information
      out: punchOut ?? prev?.out ?? null,
    });
  }

  const sessions = [...byStart.values()].sort((a, b) => a.in - b.in);
  const result: ParseResult = { sessions, added: sessions.length, skipped, full: Array.isArray(whole) };
  if (typeof payload?.target_minutes === "number" && payload.target_minutes > 0) {
    result.target = payload.target_minutes;
  }
  return result;
}

/**
 * Merge incoming sessions over the existing ones. A punch is identified by the
 * minute it started, not just by id — otherwise the same punch arriving with a
 * different id (or added by hand first, then loaded from the API) would show up
 * twice and corrupt the break calculation.
 */
export function mergeSessions(existing: Session[], incoming: Session[]): Session[] {
  const byStart = new Map<number, Session>();
  const idToStart = new Map<string, number>();

  const put = (s: Session) => {
    // an id we've already seen wins over the start time, so a corrected punch-in
    // moves the existing row instead of adding a second one
    const known = idToStart.get(s.id);
    if (known != null && known !== s.in) byStart.delete(known);
    byStart.set(s.in, s);
    idToStart.set(s.id, s.in);
  };

  for (const s of existing) put(s);
  for (const s of incoming) put(s);

  return [...byStart.values()].sort((a, b) => a.in - b.in);
}

/**
 * Replace every session belonging to the incoming day. Used when the response
 * carried a full `sessions_today` list, so a second paste reflects that response
 * exactly — punches that vanished upstream vanish here too.
 */
export function replaceDay(existing: Session[], incoming: Session[]): Session[] {
  const first = incoming[0];
  if (!first) return existing;
  const key = dayKey(first.in);
  return [...existing.filter((s) => dayKey(s.in) !== key), ...incoming].sort((a, b) => a.in - b.in);
}

/** Move every punch forward by whole days so stale data becomes today's. */
export function shiftToToday(sessions: Session[], today: number): Session[] {
  const first = sessions[0];
  if (!first) return sessions;
  const delta = today - startOfDay(first.in);
  if (!delta) return sessions;
  return sessions.map((s) => ({ ...s, in: s.in + delta, out: s.out == null ? null : s.out + delta }));
}
