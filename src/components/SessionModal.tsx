import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarIcon, ClockIcon, LoginIcon } from "./Icons";
import { MIN, dateLabel, dayKey, hm, inputTimeNow, minutesFromInput, startOfDayKey } from "../time";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (date: string, punchIn: string, punchOut: string) => void;
  /** `YYYY-MM-DD` the fields start on — the day being viewed. */
  defaultDate: string;
  /** True when that date has nothing stored yet, so this entry starts a new day. */
  isNewDay: (date: string) => boolean;
}

interface Check {
  ok: boolean;
  message: string;
  tone: "ok" | "warn" | "error" | "idle";
}

function validate(date: string, pIn: string, pOut: string, isNewDay: (d: string) => boolean): Check {
  const base = startOfDayKey(date);
  if (base == null) return { ok: false, message: "Pick the date this session belongs to.", tone: "idle" };

  const mIn = minutesFromInput(pIn);
  if (mIn == null) return { ok: false, message: "Enter a punch-in time to continue.", tone: "idle" };

  const on = `on ${dateLabel(base)}${isNewDay(date) ? " — a day you have nothing stored for yet" : ""}`;
  if (!pOut) return { ok: true, message: `No punch-out — this session will run live, ${on}.`, tone: "warn" };

  const mOut = minutesFromInput(pOut);
  if (mOut == null) return { ok: false, message: "That punch-out time isn't valid.", tone: "error" };
  if (mOut === mIn) return { ok: false, message: "Punch-out can't be the same as punch-in.", tone: "error" };

  const crosses = mOut < mIn;
  const length = ((crosses ? mOut + 24 * 60 : mOut) - mIn) * MIN;
  return {
    ok: true,
    message: `${hm(length)} long ${on}${crosses ? ", crossing midnight into the next day" : ""}.`,
    tone: crosses ? "warn" : "ok",
  };
}

export function SessionModal({ open, onClose, onSubmit, defaultDate, isNewDay }: Props) {
  const [date, setDate] = useState(defaultDate);
  const [pIn, setPIn] = useState("");
  const [pOut, setPOut] = useState("");
  const [touched, setTouched] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);
  const check = validate(date, pIn, pOut, isNewDay);

  // reset and focus each time it opens; restore the page scroll on close
  useEffect(() => {
    if (!open) return;
    setDate(defaultDate);
    setPIn("");
    setPOut("");
    setTouched(false);
    const t = window.setTimeout(() => firstField.current?.focus(), 60);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open, defaultDate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = () => {
    setTouched(true);
    if (!check.ok) return;
    onSubmit(date, pIn, pOut);
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          >
            <div className="modal-head">
              <span className="icon-tile blue">
                <LoginIcon />
              </span>
              <div>
                <h3 id="modal-title">Add session</h3>
                <p>Pick the day and enter the punch times — breaks fill themselves in from the gaps.</p>
              </div>
              <button className="modal-x" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <label htmlFor="m-date">Date</label>
              <div className="field">
                <input id="m-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <button type="button" className="now" onClick={() => setDate(dayKey(Date.now()))}>
                  <CalendarIcon width={13} height={13} />
                  Today
                </button>
              </div>

              <div className="pair" style={{ marginTop: 14 }}>
                <div>
                  <label htmlFor="m-in">Punch in</label>
                  <div className="field">
                    <input
                      id="m-in"
                      ref={firstField}
                      type="time"
                      step={60}
                      value={pIn}
                      onChange={(e) => setPIn(e.target.value)}
                    />
                    <button type="button" className="now" onClick={() => setPIn(inputTimeNow())}>
                      <ClockIcon width={13} height={13} />
                      Now
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor="m-out">
                    Punch out <span className="opt">optional</span>
                  </label>
                  <div className="field">
                    <input
                      id="m-out"
                      type="time"
                      step={60}
                      value={pOut}
                      onChange={(e) => setPOut(e.target.value)}
                    />
                    <button type="button" className="now" onClick={() => setPOut(inputTimeNow())}>
                      <ClockIcon width={13} height={13} />
                      Now
                    </button>
                  </div>
                </div>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={check.message}
                  className={`preview ${touched && !check.ok ? "error" : check.tone}`}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  {check.message}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="modal-foot">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <motion.button
                className="btn primary"
                whileHover={check.ok ? { scale: 1.015 } : {}}
                whileTap={check.ok ? { scale: 0.975 } : {}}
                disabled={!check.ok}
                onClick={submit}
              >
                Add session
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
