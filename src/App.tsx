import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttendancePanel } from "./components/AttendancePanel";
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
import { Toast, type ToastAction, type ToastMsg } from "./components/Toast";
import { TopBar } from "./components/TopBar";
import { computeDay, mergeSessions, parsePayload, replaceDay, shiftToToday } from "./compute";
import { saveBlob } from "./export";
import { buildHistory, resolveDay, totalsOf, type DayEntry } from "./history";
import { historyPdf, historyPdfFilename } from "./historyPdf";
import { MIN, dateLabel, dayKey, minutesFromInput, startOfDayKey, startOfToday } from "./time";
import type { Session } from "./types";
import { useAttendance } from "./useAttendance";
import { useConsent } from "./useConsent";
import { useSheet } from "./useSheet";
import { useNow, useStore } from "./useStore";

/** Past days don't change; recomputing the whole history 4× a second would be waste. */
const HISTORY_TICK = 30_000;

export default function App() {
  const { consent, canPersist, allow, reject } = useConsent();
  const { store, setSessions, setSettings, setFilter, commitDay } = useStore(canPersist);
  const now = useNow();
  const [view, setView] = useState<View>("dashboard");
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

  const handleDelete = useCallback(
    (id: string) => setSessions((prev) => prev.filter((s) => s.id !== id)),
    [setSessions],
  );

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

  /** The days on screen in the history panel, saved as a PDF report. */
  const handleDownloadPdf = useCallback(
    (list: DayEntry[], scope: string) => {
      if (list.length === 0) return say("Nothing to download yet.", false);
      const meta = { scope, at: Date.now() };
      saveBlob(historyPdf(list, totalsOf(list), meta), historyPdfFilename(meta));
      say(`PDF downloaded — ${list.length} ${list.length === 1 ? "day" : "days"}.`, true);
    },
    [say],
  );

  const sheet = useSheet(day, say, canPersist);
  const attendance = useAttendance(say);

  /**
   * Every fetch flows into the store by itself, so the whole dashboard reads
   * the HR response — the ring and Time in office, First in, Sessions & Breaks,
   * Efficiency, and the exit time — rather than only the panel at the top while
   * everything below sits at zero.
   *
   * `my-today` carrying `sessions_today` already means "this is the authority
   * for that day" in `parsePayload`, so taking it as truth is the existing rule
   * rather than a new one. The cost is that hand-edits to today are replaced by
   * the next fetch.
   *
   * Keyed on `fetchedAt` so it runs once per response rather than on every
   * clock tick, and silent, because a toast every minute would be unbearable.
   */
  const appliedAt = useRef(0);
  useEffect(() => {
    const at = attendance.fetchedAt;
    if (at == null || at === appliedAt.current) return;
    // An empty response never wipes the day — before the first punch of the
    // morning my-today has nothing, and that is not a reason to erase punches.
    if (!attendance.today?.sessions.length) return;
    appliedAt.current = at;
    const parsed = parsePayload(JSON.stringify(attendance.today.raw));
    setSessions((prev) =>
      parsed.full ? replaceDay(prev, parsed.sessions) : mergeSessions(prev, parsed.sessions),
    );
    if (parsed.target) setSettings({ target: parsed.target });
    // Deliberately no setFilter here: yanking the view back to today while
    // someone is reading an older day would be rude.
  }, [attendance.fetchedAt, attendance.today, setSessions, setSettings]);

  /** Move only the day on screen — the other stored days must stay where they are. */
  const handleShift = useCallback(() => {
    if (!selected) return;
    const moved = shiftToToday(selected.sessions, startOfToday());
    setSessions((prev) => replaceDay(prev.filter((s) => dayKey(s.in) !== selected.key), moved));
    setFilter({ month: "all", day: "latest" });
    say("Moved to today.", true);
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

  const running = day.sessions.some((s) => s.out == null) && !day.stale;

  return (
    <div className="app">
      <Sidebar view={view} onView={setView} running={running} api={attendance} />

      <main className="main">
        <TopBar viewing={day.first} stale={day.stale} />

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
            <AttendancePanel api={attendance} freeMinutes={store.settings.free} />
            <Hero day={day} target={store.settings.target} now={now} />
            <StatsStrip
              day={day}
              saved={selected?.submittedAt != null}
              onSave={() => setSheetKey(selected?.key ?? dayKey(Date.now()))}
            />
            <div className="cols">
              <SessionTable day={day} onDelete={handleDelete} onAdd={() => setModal(true)} sheet={sheet} />
              <Efficiency day={day} />
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
              onFilter={setFilter}
              onDeleteDay={handleDeleteDay}
              onClearAll={handleClearAll}
              onDownload={handleDownloadPdf}
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
      <SheetSetup sheet={sheet} />
      <Toast toast={toast} />
    </div>
  );
}
