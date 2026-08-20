import { AnimatePresence, motion } from "framer-motion";
import { Counter } from "./Counter";
import { TimerThread3D } from "./TimerThread3D";
import { TimerRing3D, type RingTone } from "./TimerRing3D";
import { CalendarIcon, ClockIcon } from "./Icons";
import type { DayResult } from "../types";
import { MIN, clockShort, clockTime, clockWithSeconds, dateLabel, hm, hms, hmsParts, human, weekday } from "../time";

const STATUS = {
  working: { label: "Working", cls: "working" },
  break: { label: "On break", cls: "break" },
  out: { label: "Punched out", cls: "out" },
  empty: { label: "No data", cls: "empty" },
} as const;

interface Props {
  day: DayResult;
  target: number;
  now: number;
}

export function Hero({ day, target, now }: Props) {
  const [h, m, s] = hmsParts(day.office);
  const hasData = day.sessions.length > 0;
  const status = STATUS[day.status];
  const live = hasData && !day.stale;
  const past = hasData && day.stale;
  const viewing = day.first ?? now;
  const pct = Math.round(day.frac * 100);
  // Punched out is its own thing: nothing is running, so the thread must not
  // travel as though it were.
  const ringTone: RingTone = !hasData
    ? "idle"
    : day.reached
      ? "done"
      : day.status === "break"
        ? "break"
        : day.status === "out"
          ? "idle"
          : "working";

  return (
    <div className="cols">
      <motion.section
        className="card timer-card"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <TimerThread3D tone={ringTone} live={live} />

        <div className="card-head">
          <span className="card-title">
            <ClockIcon width={15} height={15} />
            Time in office
          </span>
          {live && (
            <span className="chip live">
              <motion.i
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
              />
              LIVE
            </span>
          )}
          {past && <span className="chip empty">Stored</span>}
        </div>

        <div className="timer-body">
          <TimerRing3D value={day.frac} tone={ringTone} live={live && day.status === "working"} />
          <div className="readout">
            <Counter hours={h} minutes={m} seconds={s} done={day.reached && hasData} />
            <div className="sub">
              {!hasData ? (
                <>of {hms(day.officeGoal)} goal &nbsp;•&nbsp; add today's punches to start</>
              ) : day.reached ? (
                <>
                  goal {hms(day.officeGoal)} reached &nbsp;•&nbsp; <b>+{human(day.office - day.officeGoal)} extra</b>
                </>
              ) : (
                <>
                  of {hms(day.officeGoal)} goal &nbsp;•&nbsp; <b>{hms(day.officeGoal - day.office)} still to work</b>
                </>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="bar">
            <motion.span
              className={day.reached ? "done" : ""}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="bar-foot">
            <span className="pct">{pct}%</span>
          </div>
        </div>

        <div className="status">
          <motion.span
            className={`chip ${status.cls}`}
            key={status.cls}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
          >
            <motion.i
              animate={day.status === "working" || day.status === "break" ? { opacity: [1, 0.3, 1] } : {}}
              transition={{ duration: 1.7, repeat: Infinity }}
            />
            {status.label}
            {day.status === "break" && ` · ${human(day.liveBreak)}`}
          </motion.span>
        </div>
      </motion.section>

      <div className="grid">
        <motion.div
          className="card date-card"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="k" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CalendarIcon width={14} height={14} />
            {weekday(viewing)}
          </span>
          <div className="v">{dateLabel(viewing)}</div>
          <div className="s">{past ? "stored day • IST" : "IST • UTC +05:30"}</div>
          <div className="s mono">{past ? `now ${clockShort(now)}` : clockWithSeconds(now)}</div>
        </motion.div>

        <AnimatePresence>
          {hasData && day.leave != null && (
            <motion.div
              className="leave-card"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="k">You can leave at</div>
              <div className="t">{clockShort(day.leave)}</div>
              <div className="s">
                {hm(target * MIN)} work &nbsp;•&nbsp; {hm(day.billableBreak)} break &nbsp;•&nbsp; from{" "}
                {clockTime(day.first)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
