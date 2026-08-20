import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttendancePanel } from "./components/AttendancePanel";
import { Backdrop3D } from "./components/Backdrop3D";
import { ConsentBanner } from "./components/ConsentBanner";
import { DaySheetModal } from "./components/DaySheetModal";
import { Efficiency } from "./components/Efficiency";
import { Hero } from "./components/Hero";
import { HistoryPanel } from "./components/HistoryPanel";
import { Insights } from "./components/Insights";
import { SessionModal } from "./components/SessionModal";
import { SessionTable } from "./components/SessionTable";
import { Settings } from "./components/Settings";
import { SheetPanel } from "./components/SheetPanel";
import { SheetSetup } from "./components/SheetSetup";
import { Sidebar, type View } from "./components/Sidebar";
import { StatsStrip } from "./components/StatsStrip";
import { StatusBar } from "./components/StatusBar";
import { Telemetry } from "./components/Telemetry";
import { Toast, type ToastAction, type ToastMsg } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { computeDay, mergeSessions, parsePayload, replaceDay, shiftToToday } from "./compute";
import { buildHistory, resolveDay } from "./history";
import { MIN, dateLabel, dayKey, minutesFromInput, startOfDayKey, startOfToday } from "./time";
import type { DayResult, Session } from "./types";
import { useAttendance } from "./useAttendance";
import { useConsent } from "./useConsent";
import { useSheet } from "./useSheet";
import { useNow, useStore } from "./useStore";

/** Past days don't change; recomputing the whole history 4× a second would be waste. */
const HISTORY_TICK = 30_000;

/** The day as the punch API would have sent it — shown in the telemetry panel. */
function telemetry(day: DayResult): string {
  const open = day.sessions.find((s) => s.out == null);
  const iso = (t: number) => new Date(t + 330 * MIN).toISOString().replace("Z", "+05:30");
  if (!day.sessions.length) {
    return JSON.stringify({ status: "idle", sessions_today: [], target_minutes: 480 }, null, 2);
  }
  return JSON.stringify(
    {
      status: day.status,
      current_session: open
        ? { id: open.id, punch_in: iso(open.in), punch_out: null, duration_ms: day.now - open.in }
        : null,
      sessions_today: day.sessions.map((s) => ({
        id: s.id,
        punch_in: iso(s.in),
        punch_out: s.out == null ? null : iso(s.out),
      })),
    },
    null,
    2,
  );
}

export default function App() {
  const { consent, canPersist, allow, reject } = useConsent();
  const { store, setSessions, setSettings, setFilter, commitDay } = useStore(canPersist);
  const now = useNow();
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  /** The `YYYY-MM-DD` open in the day sheet, or null when it is closed. */
  const [sheetKey, setSheetKey] = useState<string | null>(null);

  const coarse = Math.floor(now / HISTORY_TICK) * HISTORY_TICK;
  const days = useMemo(
    () => buildHistory(store.sessions, store.settings, store.meta, coarse),
    [store.sessions, store.settings, store.meta, coarse],
  );

  // The calculator works on exactly one day: feeding it several would read the
  // night between them as a break. The filter decides which one that is.
  const selected = useMemo(() => resolveDay(days, store.filter), [days, store.filter]);
  const day = useMemo(
    () => computeDay(selected?.sessions ?? [], store.settings, now),
    [selected, store.settings, now],
  );

  /** The filter is pointing somewhere on purpose, rather than following the newest day. */
  const browsing = store.filter.day !== "latest" || store.filter.month !== "all";

  const [toast, setToast] = useState<ToastMsg | null>(null);
  const toastTimer = useRef<number>(0);
  const say = useCallback((text: string, ok: boolean, action?: ToastAction) => {
    setToast({ id: Date.now(), text, ok, ...(action ? { action } : {}) });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), action ? 9000 : 4200);
  }, []);

  const handleLoad = useCallback(
    (text: string) => {
      if (!text.trim()) return say("Paste a response first.", false);
      try {
        const parsed = parsePayload(text);
        if (parsed.added === 0) return say("No readable punch times in that response.", false);
        // A full `sessions_today` response is the authority for that day, so a
        // second paste replaces it outright — sessions and breaks both re-derive
        // from exactly what was pasted instead of accumulating stale rows.
        setSessions((prev) =>
          parsed.full ? replaceDay(prev, parsed.sessions) : mergeSessions(prev, parsed.sessions),
        );
        if (parsed.target) setSettings({ target: parsed.target });
        // Follow what was just pasted, so loading an older day while browsing
        // another one still shows the thing that landed.
        const landed = parsed.sessions[0];
        if (landed) setFilter({ month: "all", day: dayKey(landed.in) });
        say(
          `${parsed.full ? "Updated" : "Loaded"} ${parsed.added} session${parsed.added === 1 ? "" : "s"}` +
            (parsed.skipped ? ` (${parsed.skipped} skipped)` : "") +
            ".",
          true,
        );
      } catch (e) {
        say((e as Error).message, false);
      }
    },
    [say, setFilter, setSessions, setSettings],
  );

  const handleManual = useCallback(
    (date: string, punchIn: string, punchOut: string) => {
      const mIn = minutesFromInput(punchIn);
      if (mIn == null) return say("Enter a punch-in time.", false);
      const mOut = punchOut ? minutesFromInput(punchOut) : null;

      // The date typed into the dialog wins, so a day with nothing stored yet can
      // be started by hand; it falls back to the day on screen.
      const base = startOfDayKey(date) ?? selected?.at ?? startOfToday();
      const tIn = base + mIn * MIN;
      let tOut = mOut == null ? null : base + mOut * MIN;
      if (tOut != null && tOut < tIn) tOut += 24 * 60 * MIN; // crossed midnight

      const session: Session = { id: `m${tIn}`, in: tIn, out: tOut };
      setSessions((prev) => mergeSessions(prev, [session]));
      setFilter({ month: "all", day: dayKey(tIn) });
      say(`Session added to ${dateLabel(tIn)}.`, true);
    },
    [say, selected, setFilter, setSessions],
  );

  /** Start Timer punches in at this minute; Stop Timer closes whatever is open. */
  const handleTimer = useCallback(() => {
    const open = day.sessions.find((s) => s.out == null);
    if (open) {
      setSessions((prev) => prev.map((s) => (s.id === open.id ? { ...s, out: Date.now() } : s)));
      return say("Punched out.", true);
    }
    const at = Date.now();
    setSessions((prev) => mergeSessions(prev, [{ id: `t${at}`, in: at, out: null }]));
    setFilter({ month: "all", day: "latest" });
    setView("dashboard");
    say("Timer started — punched in.", true);
  }, [day.sessions, say, setFilter, setSessions]);

  const handleDelete = useCallback(
    (id: string) => setSessions((prev) => prev.filter((s) => s.id !== id)),
    [setSessions],
  );

  /** "Clear" means the day on screen — the rest of the history stays. */
  const handleClear = useCallback(() => {
    if (!selected) return;
    setSessions((prev) => prev.filter((s) => dayKey(s.in) !== selected.key));
    setFilter({ day: "latest" });
    say(`Cleared ${dateLabel(selected.at)}.`, true);
  }, [say, selected, setFilter, setSessions]);

  const handleDeleteDay = useCallback(
    (key: string) => {
      setSessions((prev) => prev.filter((s) => dayKey(s.in) !== key));
      if (store.filter.day === key) setFilter({ day: "latest" });
    },
    [setFilter, setSessions, store.filter.day],
  );

  const handleClearAll = useCallback(() => {
    if (!store.sessions.length) return;
    setSessions([]);
    setFilter({ month: "all", day: "latest" });
    say("History cleared.", true);
  }, [say, setFilter, setSessions, store.sessions.length]);

  const sheet = useSheet(day, say, canPersist);
  // Passing the view in keeps it from checking the session or hitting the HR
  // API until someone actually opens the screen.
  const attendance = useAttendance(view === "dashboard", say);

  /**
   * Copy the live HR punches into the store. It goes through `handleLoad`, the
   * same route the Raw Telemetry box uses, so a `sessions_today` response
   * replaces the day rather than merging — and the dashboard, history and
   * export all see it without a second code path.
   */
  const handleApplyHr = useCallback(() => {
    if (!attendance.today) return;
    handleLoad(JSON.stringify(attendance.today.raw));
  }, [attendance.today, handleLoad]);

  /**
   * On `always`, every fetch flows into the dashboard by itself — that is what
   * makes it live rather than a panel sitting next to stale numbers. Keyed on
   * `fetchedAt` so it runs once per response instead of on every clock tick,
   * and silent, because `handleLoad`'s toast every minute would be unbearable.
   */
  const appliedAt = useRef(0);
  useEffect(() => {
    const at = attendance.fetchedAt;
    if (attendance.syncMode !== "always" || at == null || at === appliedAt.current) return;
    if (!attendance.today?.sessions.length) return;
    appliedAt.current = at;
    const parsed = parsePayload(JSON.stringify(attendance.today.raw));
    setSessions((prev) =>
      parsed.full ? replaceDay(prev, parsed.sessions) : mergeSessions(prev, parsed.sessions),
    );
    if (parsed.target) setSettings({ target: parsed.target });
  }, [
    attendance.fetchedAt,
    attendance.syncMode,
    attendance.today,
    setSessions,
    setSettings,
  ]);

  /** Move only the day on screen — the other stored days must stay where they are. */
  const handleShift = useCallback(() => {
    if (!selected) return;
    const moved = shiftToToday(selected.sessions, startOfToday());
    setSessions((prev) => replaceDay(prev.filter((s) => dayKey(s.in) !== selected.key), moved));
    setFilter({ month: "all", day: "latest" });
    say("Moved to today — timer running.", true);
  }, [say, selected, setFilter, setSessions]);

  /** Submitting the day sheet: the edited punches replace that day and sign it off. */
  const handleCommit = useCallback(
    (key: string, edited: Session[]) => {
      commitDay(key, edited);
      setFilter({ month: "all", day: key });
      const base = startOfDayKey(key);
      say(
        edited.length === 0
          ? `Cleared ${base == null ? key : dateLabel(base)}.`
          : `Saved ${base == null ? key : dateLabel(base)} to history — ${edited.length} session${
              edited.length === 1 ? "" : "s"
            }.`,
        true,
      );
    },
    [commitDay, say, setFilter],
  );

  /** The day the sheet is editing, which is not always the one on screen. */
  const sheetDay = useMemo(
    () => (sheetKey == null ? null : (days.find((d) => d.key === sheetKey) ?? null)),
    [days, sheetKey],
  );

  const handleAllow = useCallback(() => {
    allow();
    say("Saved in this browser from now on.", true);
  }, [allow, say]);

  /** Rejecting is not just a preference — it wipes what this app already wrote. */
  const handleReject = useCallback(() => {
    reject();
    say("Nothing will be stored. Anything already saved has been deleted.", true);
  }, [reject, say]);

  /** Typing in the top bar is a history search, so send them where the results are. */
  const handleQuery = useCallback((value: string) => {
    setQuery(value);
    if (value.trim()) setView("history");
  }, []);

  const running = day.sessions.some((s) => s.out == null) && !day.stale;

  return (
    <div className="app">
      <Backdrop3D tone={day.sessions.length === 0 ? "idle" : day.reached ? "done" : day.status === "break" ? "break" : "working"} />
      <Sidebar view={view} onView={setView} running={running} onTimer={handleTimer} />

      <main className="main">
        <TopBar query={query} onQuery={handleQuery} viewing={day.first} stale={day.stale} />

        <AnimatePresence>
          {/* Browsing history on purpose isn't a problem to warn about — the
              banner is only for data that went stale under you, and its Shift
              button would drag a deliberately chosen old day onto today. */}
          {day.stale && day.first != null && !browsing && (
            <motion.div
              className="banner"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <span>This data is from {dateLabel(day.first)}, not today — the live timer is paused.</span>
              <button onClick={handleShift}>Shift to today</button>
            </motion.div>
          )}
        </AnimatePresence>

        {view === "dashboard" && (
          <>
            <AttendancePanel
              api={attendance}
              freeMinutes={store.settings.free}
              onApply={handleApplyHr}
            />
            <Hero day={day} target={store.settings.target} now={now} />
            <StatsStrip
              day={day}
              saved={selected?.submittedAt != null}
              onSave={() => setSheetKey(selected?.key ?? dayKey(Date.now()))}
            />
            <div className="cols">
              <SessionTable day={day} onDelete={handleDelete} onAdd={() => setModal(true)} sheet={sheet} />
              <div className="grid">
                <Efficiency day={day} />
                <Telemetry onLoad={handleLoad} onClear={handleClear} sample={telemetry(day)} />
              </div>
            </div>
            <StatusBar day={day} target={store.settings.target} />
          </>
        )}

        {view === "insights" && <Insights day={day} days={days} target={store.settings.target} />}

        {view === "history" && (
          <div className="narrow">
            <HistoryPanel
              days={days}
              filter={store.filter}
              selectedKey={selected?.key ?? null}
              query={query}
              onFilter={setFilter}
              onDeleteDay={handleDeleteDay}
              onClearAll={handleClearAll}
              onEdit={(key) => setSheetKey(key || dayKey(Date.now()))}
            />
          </div>
        )}

        {view === "export" && (
          <div className="narrow">
            <SheetPanel
              sheet={sheet}
              days={days}
              filter={store.filter}
              selected={selected}
              onFilter={setFilter}
              onAdd={() => setModal(true)}
            />
          </div>
        )}

        {view === "settings" && (
          <Settings
            settings={store.settings}
            onChange={setSettings}
            storedDays={days.length}
            onClearAll={handleClearAll}
            consent={consent}
            onAllow={handleAllow}
            onReject={handleReject}
          />
        )}
      </main>

      <DaySheetModal
        open={sheetKey != null}
        onClose={() => setSheetKey(null)}
        dateKey={sheetKey ?? ""}
        sessions={sheetDay?.sessions ?? []}
        settings={store.settings}
        now={now}
        onSubmit={(edited) => handleCommit(sheetKey ?? "", edited)}
      />
      <SessionModal
        open={modal}
        onClose={() => setModal(false)}
        onSubmit={handleManual}
        defaultDate={selected?.key ?? dayKey(Date.now())}
        isNewDay={(date) => !days.some((d) => d.key === date)}
      />
      <ConsentBanner open={consent === "unknown"} onAllow={handleAllow} onReject={handleReject} />
      <SheetSetup sheet={sheet} />
      <Toast toast={toast} />
    </div>
  );
}
