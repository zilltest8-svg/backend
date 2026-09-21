/**
 * State for the live attendance panel: who is signed in, today's punches, and
 * the device sync, which runs by itself every minute while signed in. Deliberately separate from `useStore` — this data is fetched
 * live from the HR API and is never written to localStorage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AttendanceError,
  checkSession,
  fetchToday,
  login as apiLogin,
  logout as apiLogout,
  runSync as apiRunSync,
  type HrUser,
  type SyncResult,
  type TodayReport,
} from "./api/attendance";
import { dayKey } from "./time";

export type AuthState = "checking" | "signed-out" | "signing-in" | "signed-in";

export interface AttendanceState {
  auth: AuthState;
  user: HrUser | null;
  /** Sign-in failure, shown on the login modal. */
  authError: string | null;
  /** The range Sync pulls from the punch devices — not what today shows. */
  startDate: string;
  endDate: string;
  today: TodayReport | null;
  loading: boolean;
  /** Fetch failure, shown on the data screen. */
  error: string | null;
  /** When the punches on screen came back. */
  fetchedAt: number | null;
  /** Last device pull, or null until Sync is pressed. */
  sync: SyncResult | null;
  syncing: boolean;
  syncError: string | null;
  /** When the next automatic sync is due, for the countdown bar. */
  nextSyncAt: number | null;
  /**
   * The sign-in dialog puts itself up once when the app finds itself signed
   * out. Kept here rather than on the panel, which is remounted on every visit
   * to the dashboard and would otherwise ask again each time.
   */
  askedLogin: boolean;
}

/**
 * How often the HR API is called while signed in. A device pull is real work on
 * the HR side, so this is a minute rather than the 250ms the clock ticks at —
 * the punch data it would find does not change faster than that anyway.
 */
export const AUTO_SYNC_MS = 60_000;

export interface AttendanceApi extends AttendanceState {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setRange: (start: string, end: string) => void;
  refresh: () => void;
  /** Sync now, out of turn. Says what happened, unlike the automatic ones. */
  startSync: () => void;
  markAskedLogin: () => void;
}

/** `say` surfaces the sync result as a toast, so the outcome is never silent. */
export function useAttendance(say?: (text: string, ok: boolean) => void): AttendanceApi {
  const today = dayKey(Date.now());
  const [state, setState] = useState<AttendanceState>({
    auth: "checking",
    user: null,
    authError: null,
    startDate: today,
    endDate: today,
    today: null,
    loading: false,
    error: null,
    fetchedAt: null,
    sync: null,
    syncing: false,
    syncError: null,
    nextSyncAt: null,
    askedLogin: false,
  });

  /**
   * Until a range is picked by hand it means "today", and has to keep meaning
   * that when the app is left open past midnight.
   */
  const rangePicked = useRef(false);

  const patch = useCallback((next: Partial<AttendanceState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  /**
   * Guards against a slow response overwriting a newer one. There is
   * deliberately no `mounted` ref alongside it: React 18 makes a state update
   * after unmount a harmless no-op, while a ref cleared on cleanup stays cleared
   * through StrictMode's mount/unmount/mount and silently kills every update
   * that follows.
   */
  const requestId = useRef(0);

  // The proxy holds the session in an httpOnly cookie, so a reload has to ask
  // whether it is still valid rather than reading it.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    checkSession()
      .then((s) => patch({ auth: s.authenticated ? "signed-in" : "signed-out", user: s.user }))
      // A proxy that is down is indistinguishable from being signed out, and
      // showing the login form is the useful answer either way.
      .catch(() => patch({ auth: "signed-out" }));
  }, [patch]);

  /** True when the failure means the session is gone, so the caller can stop. */
  const handleFailure = useCallback(
    (err: unknown): boolean => {
      const failure = err as AttendanceError;
      if (failure?.unauthenticated) {
        patch({
          auth: "signed-out",
          user: null,
          today: null,
          sync: null,
          loading: false,
          syncing: false,
          error: null,
          syncError: null,
        });
        return true;
      }
      return false;
    },
    [patch],
  );

  const load = useCallback(async () => {
    const id = ++requestId.current;
    patch({ loading: true, error: null });
    try {
      const report = await fetchToday();
      if (id !== requestId.current) return;
      patch({ today: report, loading: false, error: null, fetchedAt: Date.now() });
    } catch (err) {
      if (id !== requestId.current) return;
      if (handleFailure(err)) return;
      patch({ loading: false, error: (err as Error).message ?? "Could not load today's punches." });
    }
  }, [handleFailure, patch]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      patch({ auth: "signing-in", authError: null });
      try {
        const { user } = await apiLogin(email, password);
        // askedLogin is cleared so an expired session, hours on, does prompt.
        patch({ auth: "signed-in", user, authError: null, askedLogin: false });
      } catch (err) {
        patch({ auth: "signed-out", authError: (err as Error).message ?? "Sign-in failed." });
      }
    },
    [patch],
  );

  const signOut = useCallback(async () => {
    await apiLogout().catch(() => {});
    requestId.current++; // abandon anything in flight
    patch({
      auth: "signed-out",
      user: null,
      today: null,
      sync: null,
      error: null,
      authError: null,
      syncError: null,
      fetchedAt: null,
      // Signing out on purpose is not a reason to be asked to sign straight back in.
      askedLogin: true,
    });
  }, [patch]);

  const setRange = useCallback(
    (start: string, end: string) => {
      rangePicked.current = true;
      patch({ startDate: start, endDate: end });
    },
    [patch],
  );

  const refresh = useCallback(() => {
    if (state.auth === "signed-in") void load();
  }, [load, state.auth]);

  /** `quiet` skips the toast — an automatic sync every minute should not shout. */
  const sync = useCallback(
    async (quiet: boolean) => {
      if (state.auth !== "signed-in" || state.syncing) return;
      const today = dayKey(Date.now());
      const start = rangePicked.current ? state.startDate : today;
      const end = rangePicked.current ? state.endDate : today;
      patch({ syncing: true, syncError: null, startDate: start, endDate: end });
      try {
        const result = await apiRunSync(start, end);
        patch({ sync: result });
        if (!quiet) say?.(result.message, true);
        // A pull that added rows changes what my-today would answer, so read it
        // again rather than leaving the tiles on pre-sync numbers.
        await load();
      } catch (err) {
        const message = (err as Error).message ?? "Sync failed.";
        const signedOut = handleFailure(err);
        if (!signedOut) patch({ syncError: message });
        // With a sync every minute, a toast per failure would never stop; the
        // strip on the panel carries it, and only a pressed button speaks up.
        if (!quiet || signedOut) say?.(message, false);
        // The device pull failing is no reason to show stale punches as well.
        if (!signedOut) await load();
      } finally {
        // Always clears, whatever happened above. Leaving it true would disable
        // the button for good, and a disabled button looks exactly like a click
        // that did nothing.
        patch({ syncing: false });
      }
    },
    [handleFailure, load, patch, say, state.auth, state.startDate, state.endDate, state.syncing],
  );

  const startSync = useCallback(() => void sync(false), [sync]);
  const markAskedLogin = useCallback(() => patch({ askedLogin: true }), [patch]);

  // `sync` gets a new identity on nearly every render, so the polling effect
  // reads it through a ref. Depending on it directly would tear down and
  // restart the interval constantly, and it would never reach a full minute.
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  });

  // Signed in means polling: a sync straight away, then one every minute for
  // as long as the app is open, whichever screen is showing.
  useEffect(() => {
    if (state.auth !== "signed-in") {
      patch({ nextSyncAt: null });
      return;
    }
    const run = () => {
      patch({ nextSyncAt: Date.now() + AUTO_SYNC_MS });
      void syncRef.current(true);
    };
    run();
    const id = window.setInterval(run, AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [state.auth, patch]);

  return { ...state, signIn, signOut, setRange, refresh, startSync, markAskedLogin };
}
