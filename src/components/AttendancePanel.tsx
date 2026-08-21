import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { CodeIcon, LoginIcon, SheetIcon, StopwatchIcon, TrendIcon } from "./Icons";
import { HrLoginModal } from "./HrLoginModal";
import { computeDay } from "../compute";
import { AUTO_SYNC_MS, type AttendanceApi } from "../useAttendance";
import { MIN, clockShort, clockTime, hoursMinutes, human } from "../time";
import { useNow } from "../useStore";

const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** `17:30` — the 24-hour ETA the tile shows. */
function eta24(t: number): string {
  const d = new Date(t + 330 * MIN);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** The seconds of a wall-clock instant, for the ETA's dimmed tail. */
const etaSeconds = (t: number): string => p2(new Date(t + 330 * MIN).getUTCSeconds());

/**
 * A duration split into `4h 30m` plus a `12s` tail, so the seconds can be
 * dimmed the way the dashboard's stat tiles do it. `live` is false for a value
 * that is not currently moving — a still tail reads as a stopped clock.
 */
function ticking(ms: number, live: boolean): { value: string; tail?: string } {
  const value = hoursMinutes(ms);
  if (!live) return { value };
  return { value, tail: `${p2(Math.floor(Math.abs(ms) / 1000) % 60)}s` };
}

/* -------------------------------------------------------------------- panel */

interface Props {
  api: AttendanceApi;
  /** The user's own free-break allowance, from Settings. */
  freeMinutes: number;
  /** Loads these punches into the store, the same route the JSON box takes. */
  onApply: () => void;
}

export function AttendancePanel({ api, freeMinutes, onApply }: Props) {
  const now = useNow();
  const [rawOpen, setRawOpen] = useState(false);
  const [askLogin, setAskLogin] = useState(false);

  // Opening the screen while signed out puts the modal up on its own; dismissing
  // it leaves the prompt below, so there is always a way back in.
  const signedOut = api.auth === "signed-out";
  useEffect(() => {
    if (signedOut) setAskLogin(true);
  }, [signedOut]);

  // The punches from my-today go through the same calculator as the rest of the
  // app, so worked, break, remaining and the exit time are one implementation.
  //
  // `free` comes from Settings, NOT from the API's `break_minutes` — that field
  // measures the break actually taken (it equals the gap between the punches),
  // and feeding a measurement in as an allowance would forgive every break and
  // pull the exit time earlier by exactly the length of it.
  const settings = useMemo(
    () => ({ target: api.today?.targetMinutes ?? 480, free: freeMinutes }),
    [api.today?.targetMinutes, freeMinutes],
  );
  const day = useMemo(
    () => computeDay(api.today?.sessions ?? [], settings, now),
    [api.today?.sessions, settings, now],
  );

  const gate =
    api.auth === "checking" ? (
      <div className="card narrow">
        <p className="lead" style={{ margin: 0 }}>
          Checking your HR session…
        </p>
      </div>
    ) : api.auth !== "signed-in" ? (
      <div className="card narrow">
        <h2 className="with-icon sub">
          <span className="icon-tile sm violet">
            <StopwatchIcon width={15} height={15} />
          </span>
          Sign in to see your attendance
        </h2>
        <p className="lead">
          This screen reads live from the HR API rather than your stored punches, so it needs your
          work login.
        </p>
        <button className="btn primary" onClick={() => setAskLogin(true)}>
          <LoginIcon width={15} height={15} />
          Sign in to HR
        </button>
      </div>
    ) : null;

  if (gate) {
    return (
      <>
        {gate}
        <HrLoginModal
          open={askLogin && api.auth !== "checking"}
          onClose={() => setAskLogin(false)}
          onSubmit={(email, password) => void api.signIn(email, password)}
          busy={api.auth === "signing-in"}
          error={api.authError}
        />
      </>
    );
  }

  const running = day.status === "working";
  const open = day.sessions.find((s) => s.out == null);
  const target = settings.target * MIN;

  const onBreak = day.status === "break";

  // Straight off the response's earliest punch_in, not the store — the store is
  // empty until Apply is pressed, which is why this read "--:--" while the
  // response plainly carried a punch-in time.
  const [firstTime, firstMer] = (day.first == null ? "--:--" : clockTime(day.first)).split(" ");

  const cells = [
    {
      key: "first",
      label: "First in",
      value: firstTime ?? "--:--",
      tail: firstMer,
      note:
        day.first == null
          ? "not punched in yet"
          : `${day.sessions.length} punch${day.sessions.length === 1 ? "" : "es"} today`,
      tone: "",
    },
    {
      key: "today",
      label: "Today",
      ...(api.today ? ticking(day.worked, running) : { value: "--" }),
      note: api.today
        ? `of ${hoursMinutes(target)}` + (open ? ` · running ${hoursMinutes(now - open.in)}` : "")
        : "nothing loaded yet",
      tone: day.reached ? "green" : "",
    },
    {
      key: "eta",
      label: "Target ETA",
      value: day.reached ? "Met" : day.leave != null ? eta24(day.leave) : "--:--",
      // The exit second only moves while a break is actually pushing it back.
      // Working, or still inside the free allowance, and it is fixed — a
      // ticking tail on a stationary number is a lie.
      tail:
        !day.reached && day.leave != null && onBreak && day.billableBreak > 0
          ? `:${etaSeconds(day.leave)}`
          : undefined,
      note: day.reached
        ? `${hoursMinutes(day.overtime)} over`
        : day.leave != null
          ? running
            ? "if working"
            : onBreak
              ? day.billableBreak > 0
                ? "on break — slipping"
                : `on break — ${hoursMinutes(settings.free * MIN - day.breakMs)} free left`
              : "punched out"
          : "not punched in",
      tone: day.reached ? "green" : "",
    },
    {
      key: "pace",
      label: "Pace",
      ...(day.reached
        ? { value: `+${human(day.overtime)}`, tail: running ? `${p2(Math.floor(day.overtime / 1000) % 60)}s` : undefined }
        : day.remaining > 0
          ? { value: `-${human(day.remaining)}`, tail: running ? `${p2(Math.floor(day.remaining / 1000) % 60)}s` : undefined }
          : { value: "0" }),
      note: day.reached
        ? "target met"
        : day.sessions.length === 0
          ? "no punches today"
          : `${human(day.remaining)} still owed`,
      tone: day.reached ? "green" : day.remaining > 0 ? "red" : "",
    },
    {
      key: "break",
      label: "Break",
      ...ticking(day.breakMs, onBreak),
      // The API reports its own break total; showing it next to the one derived
      // from the gaps makes a disagreement obvious instead of silent.
      note:
        api.today?.breakMinutes != null
          ? `HR says ${api.today.breakMinutes}m` +
            (settings.free > 0 ? ` · ${settings.free}m free` : " · all of it pushes exit")
          : settings.free > 0
            ? `${settings.free}m free · rest pushes exit`
            : "every minute pushes exit",
      tone: "",
    },
  ];

  return (
    <div className="grid">
      <div className="hr-head">
        <div>
          <h2 className="hr-title">
            <span className="icon-tile sm violet">
              <StopwatchIcon width={15} height={15} />
            </span>
            Live attendance
          </h2>
          <p className="hr-sub">
            {api.user?.name ?? api.user?.email ?? "Signed in"}
            {api.today?.status ? ` · ${api.today.status}` : ""}
            {api.fetchedAt ? ` · updated ${clockShort(api.fetchedAt)}` : ""}
          </p>
        </div>
        <div className="hr-actions">
          <div className="hr-field inline">
            <label htmlFor="hr-start">Sync from</label>
            <input
              id="hr-start"
              type="date"
              value={api.startDate}
              max={api.endDate}
              onChange={(e) => api.setRange(e.target.value, api.endDate)}
            />
          </div>
          <div className="hr-field inline">
            <label htmlFor="hr-end">To</label>
            <input
              id="hr-end"
              type="date"
              value={api.endDate}
              min={api.startDate}
              onChange={(e) => api.setRange(api.startDate, e.target.value)}
            />
          </div>
          <motion.button
            className="btn sm primary"
            whileHover={api.syncing ? {} : { scale: 1.015 }}
            whileTap={api.syncing ? {} : { scale: 0.975 }}
            onClick={() => void api.startSync()}
            disabled={api.syncing}
            title={`Pull punches off the devices for ${api.startDate} to ${api.endDate}, then reload`}
          >
            <StopwatchIcon width={14} height={14} />
            {api.syncing ? "Syncing…" : "Sync now"}
          </motion.button>
          <button className="btn sm" onClick={api.refresh} disabled={api.loading}>
            <TrendIcon width={14} height={14} />
            {api.loading ? "Loading…" : "Refresh"}
          </button>
          <motion.button
            className="btn sm"
            whileHover={day.sessions.length ? { scale: 1.015 } : {}}
            whileTap={day.sessions.length ? { scale: 0.975 } : {}}
            onClick={onApply}
            disabled={day.sessions.length === 0}
            title="Copy these punches into the dashboard, history and export"
          >
            <SheetIcon width={14} height={14} />
            Apply to Dashboard
          </motion.button>
          <button
            className={`btn sm icon-only${rawOpen ? " on" : ""}`}
            onClick={() => setRawOpen((v) => !v)}
            disabled={api.today == null}
            title={rawOpen ? "Hide the raw HR response" : "Show the raw HR response"}
            aria-expanded={rawOpen}
            aria-label="Raw HR response"
          >
            <CodeIcon width={14} height={14} />
          </button>
          <button className="btn sm ghost" onClick={() => void api.signOut()}>
            Sign out
          </button>
        </div>
      </div>

      <div className="sync-mode">
        <span className="k">Sync</span>
        {(
          [
            { id: "tap", label: "Only when I tap", hint: "Sync now is the only thing that calls the API" },
            { id: "always", label: "Always", hint: `re-syncs every ${AUTO_SYNC_MS / 1000}s while this screen is open` },
          ] as const
        ).map((option) => (
          <label key={option.id} className={api.syncMode === option.id ? "on" : ""} title={option.hint}>
            <input
              type="radio"
              name="hr-sync-mode"
              value={option.id}
              checked={api.syncMode === option.id}
              onChange={() => api.setSyncMode(option.id)}
            />
            <i />
            {option.label}
          </label>
        ))}
        <span className="s">
          {api.syncMode === "always"
            ? `Automatic — every ${AUTO_SYNC_MS / 1000}s, quietly.`
            : "Manual — nothing is fetched until you press Sync now."}
        </span>
      </div>

      <AnimatePresence>
        {(api.error || api.syncError) && (
          <motion.div
            className="preview error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <b>{api.error ?? api.syncError}</b>
            <button className="link-btn tail" onClick={api.refresh}>
              Try again
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* What the last device pull reported — the sync endpoint returns this
          rather than any attendance, so it is shown as its own line. The tone is
          never "idle": the usual result is "Added 0 new records", and a muted
          strip for the normal case reads as nothing having happened. */}
      <AnimatePresence>
        {api.sync && !api.syncError && (
          <motion.div
            className={`preview ${api.sync.status === "completed" ? "ok" : "warn"}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <b>{api.sync.message}</b>
            {/* The range the HR side reports back, so what was actually pulled
                is on screen rather than only in the request. */}
            <span>
              {api.sync.range.start === api.sync.range.end
                ? api.sync.range.start
                : `${api.sync.range.start} → ${api.sync.range.end}`}
            </span>
            <span>
              {api.sync.devices
                .map((d) => `${d.name}: ${d.totalRecords} read, ${d.newRecords} new`)
                .join(" · ")}
            </span>
            <span className="tail">synced {clockShort(api.sync.at)}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="hr-cards">
        {cells.map((c, i) => (
          <motion.div
            className="hr-card"
            key={c.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="k">{c.label}</div>
            <div className={`v${c.tone ? ` ${c.tone}` : ""}`}>
              {api.loading && !api.today ? (
                "…"
              ) : (
                <>
                  {c.value}
                  {c.tail && <span className="tail">{c.tail}</span>}
                </>
              )}
            </div>
            <div className="s">{c.note}</div>
          </motion.div>
        ))}
      </div>

      {/* Collapsed to nothing until asked for. The punches themselves are in
          Sessions & Breaks directly below, so the only thing worth room here is
          the response, and that is for debugging rather than daily use. */}
      <AnimatePresence initial={false}>
        {rawOpen && api.today != null && (
          <motion.div
            className="tele-code"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <textarea
              readOnly
              value={JSON.stringify(
                { "my-today": api.today.raw, "my-sync": api.sync?.raw ?? null },
                null,
                2,
              )}
            />
            <button className="tele-clear" onClick={() => setRawOpen(false)} aria-label="Hide">
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
