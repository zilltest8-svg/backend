/**
 * Client for the attendance proxy in `server/index.mjs`.
 *
 * Nothing here talks to `api.hr.zilmoney.com` directly — it cannot, the HR API
 * only sends `Access-Control-Allow-Origin` for `https://hr.zilmoney.com`. Every
 * call goes to our own origin under `/api/punch/*`, and the session cookie the HR
 * API issues stays on the proxy. The only credential this file ever handles is
 * the password the user just typed, which goes out once and is never stored.
 *
 * Three upstream routes, doing three different jobs:
 *   my-today        the punches. Comes back in the same shape the Telemetry box
 *                   accepts, so `parsePayload` reads it with no new parser.
 *   my-sync         pulls records off the punch devices into HR, and reports
 *                   what it added. Returns no attendance data.
 *   my-sync-status  where the last pull got to.
 */
import { parsePayload } from "../compute";
import { parseISO } from "../time";
import type { Session } from "../types";

const BASE = "/api/punch";

export interface HrUser {
  name: string | null;
  email: string | null;
  employeeId: string | number | null;
}

/** Thrown with `unauthenticated` set when the proxy says the session is gone. */
export class AttendanceError extends Error {
  unauthenticated: boolean;
  constructor(message: string, unauthenticated = false) {
    super(message);
    this.name = "AttendanceError";
    this.unauthenticated = unauthenticated;
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      // Same-origin in dev (Vite proxies /api/punch) and in production (the proxy
      // serves dist), so the session cookie rides along without CORS at all.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...init,
    });
  } catch {
    throw new AttendanceError(
      "Could not reach the attendance proxy. Start it with `npm run server`.",
    );
  }

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    throw new AttendanceError(body?.error ?? `Request failed (HTTP ${res.status}).`, res.status === 401);
  }
  return body as T;
}

/* ------------------------------------------------------------------- session */

export const checkSession = (): Promise<{ authenticated: boolean; user: HrUser | null }> =>
  call("/session", { method: "GET" });

export const login = (email: string, password: string): Promise<{ user: HrUser | null }> =>
  call("/login", { method: "POST", body: JSON.stringify({ email, password }) });

export const logout = (): Promise<void> => call("/logout", { method: "POST" });

/* --------------------------------------------------------------------- today */

export interface TodayReport {
  sessions: Session[];
  /** `target_minutes` from the API, falling back to a standard 8h day. */
  targetMinutes: number;
  /** `break_minutes` — the allowance that does not push the exit time. */
  breakMinutes: number;
  /** `working` / `break` / `out`, as the HR API sees it. */
  status: string | null;
  /** The API's own worked total, for the line under the table. */
  totalMinutes: number | null;
  raw: unknown;
}

/** GET, not POST — my-today answers 405 to anything else. */
export async function fetchToday(): Promise<TodayReport> {
  const body = await call<{ data: unknown }>("/today", { method: "GET" });
  const bag = isBag(body.data) ? body.data : {};

  // The response is a PunchPayload, which the app already knows how to read —
  // dedup by punch-in, `current_session` folded into `sessions_today`, and a
  // closed copy of a punch beating an open one.
  const parsed = parsePayload(JSON.stringify(body.data));

  return {
    sessions: parsed.sessions,
    targetMinutes: parsed.target ?? numberOr(bag.target_minutes, 480),
    breakMinutes: numberOr(bag.break_minutes, 0),
    status: typeof bag.status === "string" ? bag.status : null,
    totalMinutes: typeof bag.total_today_minutes === "number" ? bag.total_today_minutes : null,
    raw: body.data,
  };
}

/* ---------------------------------------------------------------------- sync */

export interface SyncDevice {
  name: string;
  success: boolean;
  totalRecords: number;
  newRecords: number;
}

export interface SyncResult {
  /** `completed`, `failed`, whatever the API reports. */
  status: string;
  message: string;
  newRecords: number;
  devices: SyncDevice[];
  at: number;
  raw: unknown;
}

/** Triggers the device pull. POST with the range, and it returns a report. */
export async function runSync(startDate: string, endDate: string): Promise<SyncResult> {
  const body = await call<{ data: unknown }>("/sync", {
    method: "POST",
    body: JSON.stringify({ start_date: startDate, end_date: endDate }),
  });
  const bag = isBag(body.data) ? body.data : {};
  const devices = Array.isArray(bag.devices) ? bag.devices.filter(isBag) : [];

  return {
    status: typeof bag.status === "string" ? bag.status : "unknown",
    message: typeof bag.message === "string" ? bag.message : "Sync finished.",
    newRecords: numberOr(bag.total_new_records, 0),
    devices: devices.map((d) => ({
      name: typeof d.device_name === "string" ? d.device_name : "Device",
      success: d.success !== false,
      totalRecords: numberOr(d.total_records, 0),
      newRecords: numberOr(d.new_records_added, 0),
    })),
    at: Date.now(),
    raw: body.data,
  };
}

export interface SyncStatus {
  state: string;
  /** When HR last pulled from the punch devices, if it says. */
  lastSyncAt: number | null;
  note: string | null;
  raw: unknown;
}

/** GET, not POST — my-sync-status answers 405 to anything else. */
export async function fetchSyncStatus(): Promise<SyncStatus> {
  const body = await call<{ data: unknown }>("/sync-status", { method: "GET" });
  const outer = isBag(body.data) ? body.data : {};
  const bag = isBag(outer.data) ? outer.data : outer;

  const stamp = pickString(bag, ["last_sync_at", "last_synced_at", "synced_at", "last_sync", "updated_at"]);
  const pending = bag.pending ?? bag.pending_count ?? bag.records_pending;

  return {
    state: pickString(bag, ["status", "sync_status", "state"]) ?? "Unknown",
    lastSyncAt: parseISO(stamp),
    note:
      pickString(bag, ["message", "note", "detail"]) ??
      (pending != null ? `${pending} pending` : null),
    raw: body.data,
  };
}

/* ------------------------------------------------------------------- helpers */

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => typeof v === "object" && v !== null && !Array.isArray(v);

const numberOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function pickString(bag: Bag, keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}
