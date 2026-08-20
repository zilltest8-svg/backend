/** A single punch pair. `out === null` means the session is still running. */
export interface Session {
  id: string;
  in: number;
  out: number | null;
}

export type BlockKind = "work" | "break";

/** One contiguous stretch of the day — either worked or on break. */
export interface Block {
  kind: BlockKind;
  from: number;
  to: number;
  live: boolean;
  sessionId?: string;
}

export interface Settings {
  /** Minutes of actual work owed (480 = 8h). */
  target: number;
  /** Break minutes that do NOT push the exit time. */
  free: number;
}

/** Which stored day the calculator is looking at. */
export interface Filter {
  /** `"all"`, or a `YYYY-MM` month key. */
  month: string;
  /** `"latest"` (follow the newest stored day), or a `YYYY-MM-DD` day key. */
  day: string;
}

/**
 * Per-day bookkeeping kept alongside the punches, keyed by `YYYY-MM-DD`.
 * `savedAt` is when those punches were last written; `submittedAt` is when the
 * day was signed off in the day sheet, and is dropped again if it changes after.
 */
export type DayMeta = Record<string, { savedAt: number; submittedAt?: number }>;

export interface DayResult {
  sessions: Session[];
  blocks: Block[];
  /** Clock used for the maths — frozen at day-end when the data isn't today's. */
  now: number;
  first: number | null;
  last: number | null;
  worked: number;
  breakMs: number;
  /** Break time that actually pushes the exit (total break minus any free allowance). */
  billableBreak: number;
  /** Worked time as a share of the target, 0..1. */
  efficiency: number;
  /** Time from the first punch-in until you may leave (target + billable break). */
  span: number;
  /** Gross clock-to-clock window: first punch-in until now, breaks included. */
  elapsed: number;
  /** Time actually in the office — `elapsed` with every break minute taken back out. */
  office: number;
  /** What `office` has to reach before you may leave (`span` net of breaks). */
  officeGoal: number;
  /** 0..1 progress around the ring — `office` against `officeGoal`. */
  frac: number;
  leave: number | null;
  remaining: number;
  overtime: number;
  reached: boolean;
  status: "empty" | "working" | "break" | "out";
  liveBreak: number;
  /** True when the loaded data belongs to an earlier day. */
  stale: boolean;
}

/** Shape we accept from the punch API. Everything is optional and defensively parsed. */
export interface PunchPayload {
  status?: string;
  current_session?: RawSession | null;
  sessions_today?: RawSession[];
  sessions?: RawSession[];
  target_minutes?: number;
  break_minutes?: number;
  total_today_minutes?: number;
}

export interface RawSession {
  id?: number | string;
  punch_in?: string | null;
  punch_out?: string | null;
  in?: string | null;
  out?: string | null;
  start?: string | null;
  end?: string | null;
  duration_minutes?: number | null;
}
