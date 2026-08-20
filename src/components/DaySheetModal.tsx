import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ClockIcon, PlusIcon, SheetIcon } from "./Icons";
import { computeDay } from "../compute";
import type { Session, Settings } from "../types";
import {
  MIN,
  clockShort,
  clockTime,
  dateLabel,
  hm,
  inputTimeNow,
  minutesFromInput,
  startOfDayKey,
  weekday,
} from "../time";

interface Props {
  open: boolean;
  onClose: () => void;
  /** `YYYY-MM-DD` — the day being edited; every time typed is read against it. */
  dateKey: string;
  sessions: Session[];
  settings: Settings;
  now: number;
  onSubmit: (sessions: Session[]) => void;
}

/** A work session while it is being edited: times as `HH:MM`, blank out = running. */
interface Draft {
  id: string;
  in: string;
  out: string;
}

/** One line of the sheet — a work session, or the gap in front of it. */
type Row =
  | { kind: "work"; no: number; draft: Draft; index: number }
  | { kind: "break"; no: number; from: string; to: string; before: number };

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

const toInput = (t: number | null, base: number): string => {
  if (t == null) return "";
  const mins = Math.round((t - base) / MIN);
  const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};

/** `HH:MM` back to absolute ms, rolling past midnight when it lands before `after`. */
function toStamp(value: string, base: number, after?: number): number | null {
  const mins = minutesFromInput(value);
  if (mins == null) return null;
  let t = base + mins * MIN;
  if (after != null && t < after) t += 24 * 60 * MIN;
  return t;
}

function toDrafts(sessions: Session[], base: number): Draft[] {
  return [...sessions]
    .sort((a, b) => a.in - b.in)
    .map((s) => ({ id: s.id, in: toInput(s.in, base), out: toInput(s.out, base) }));
}

/** Drafts back to sessions. Returns null as soon as one row cannot be read. */
function toSessions(drafts: Draft[], base: number): Session[] | null {
  const out: Session[] = [];
  for (const d of drafts) {
    const punchIn = toStamp(d.in, base);
    if (punchIn == null) return null;
    const typed = d.out.trim().length > 0;
    const punchOut = typed ? toStamp(d.out, base, punchIn) : null;
    if (typed && punchOut == null) return null;
    out.push({ id: d.id, in: punchIn, out: punchOut });
  }
  return out.sort((a, b) => a.in - b.in);
}

interface Check {
  ok: boolean;
  message: string;
  tone: "ok" | "warn" | "error" | "idle";
}

function validate(drafts: Draft[], base: number): Check {
  if (drafts.length === 0) {
    return { ok: true, message: "No sessions — submitting clears this day.", tone: "warn" };
  }
  for (const [i, d] of drafts.entries()) {
    if (minutesFromInput(d.in) == null) {
      return { ok: false, message: `Session ${i + 1} needs a punch-in time.`, tone: "error" };
    }
    if (d.out.trim() && minutesFromInput(d.out) == null) {
      return { ok: false, message: `Session ${i + 1} has an unreadable punch-out.`, tone: "error" };
    }
    if (d.out.trim() && d.out === d.in) {
      return { ok: false, message: `Session ${i + 1} starts and ends at the same minute.`, tone: "error" };
    }
  }

  const sessions = toSessions(drafts, base);
  if (!sessions) return { ok: false, message: "One of those times cannot be read.", tone: "error" };

  // Overlaps get silently clipped by the calculation, so say so rather than absorb it.
  for (let i = 1; i < sessions.length; i += 1) {
    const prev = sessions[i - 1] as Session;
    const cur = sessions[i] as Session;
    if (prev.out == null) {
      return { ok: false, message: `Session ${i} is still running but another follows it.`, tone: "error" };
    }
    if (cur.in < prev.out) {
      return { ok: false, message: `Session ${i + 1} starts before session ${i} ends.`, tone: "error" };
    }
  }

  if (sessions.some((s) => s.out == null)) {
    return { ok: true, message: "The last session has no punch-out — it stays running.", tone: "warn" };
  }
  return { ok: true, message: "Every punch reads cleanly. Submit saves the day to history.", tone: "ok" };
}

/** Row length straight from the two `HH:MM` strings, so it tracks every keystroke. */
function lengthOf(from: string, to: string): string {
  const a = minutesFromInput(from);
  const b = minutesFromInput(to);
  if (a == null) return "--:--";
  if (b == null) return "running";
  return hm((b < a ? b + 24 * 60 - a : b - a) * MIN);
}

/**
 * The day as an editable sheet — the same shape the export writes, one row per
 * work session and per break. Only sessions are held in state: breaks are the
 * gaps, so editing a break's start moves the punch-out in front of it and
 * editing its end moves the punch-in after it.
 */
export function DaySheetModal({ open, onClose, dateKey, sessions, settings, now, onSubmit }: Props) {
  const base = startOfDayKey(dateKey) ?? 0;
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Loaded before paint, once per opening: the live clock re-renders the day under
  // this dialog every tick, and that must never overwrite what is being typed.
  useLayoutEffect(() => {
    if (!open) return;
    setDrafts(toDrafts(sessions, base));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, dateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const check = validate(drafts, base);

  const preview = useMemo(
    () => computeDay(toSessions(drafts, base) ?? [], settings, now),
    [drafts, base, settings, now],
  );

  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    let work = 0;
    let brk = 0;
    drafts.forEach((draft, index) => {
      const prev = drafts[index - 1];
      if (prev && prev.out.trim() && draft.in.trim() && prev.out !== draft.in) {
        brk += 1;
        out.push({ kind: "break", no: brk, from: prev.out, to: draft.in, before: index });
      }
      work += 1;
      out.push({ kind: "work", no: work, draft, index });
    });
    return out;
  }, [drafts]);

  const patch = (index: number, field: "in" | "out", value: string) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)));

  /** A break edge is really a punch on one of its neighbours. */
  const patchBreak = (before: number, edge: "from" | "to", value: string) =>
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (edge === "from" && i === before - 1) return { ...d, out: value };
        if (edge === "to" && i === before) return { ...d, in: value };
        return d;
      }),
    );

  const addRow = () => {
    const last = drafts[drafts.length - 1];
    const start = last && last.out.trim() ? last.out : inputTimeNow();
    setDrafts((prev) => [...prev, { id: `d${Date.now()}`, in: start, out: "" }]);
  };

  const removeRow = (index: number) => setDrafts((prev) => prev.filter((_, i) => i !== index));

  const submit = () => {
    if (!check.ok) return;
    const parsed = toSessions(drafts, base);
    if (!parsed) return;
    onSubmit(parsed);
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
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="modal-head">
              <span className="icon-tile green">
                <SheetIcon />
              </span>
              <div>
                <h3 id="sheet-title">{base ? dateLabel(base) : dateKey}</h3>
                <p>
                  {base ? `${weekday(base)} — ` : ""}check the punches, fill in the last punch-out,
                  then submit to save this day to history.
                </p>
              </div>
              <button className="modal-x" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="sheet-head">
                <span>No.</span>
                <span>Type</span>
                <span>Punch in</span>
                <span>Punch out</span>
                <span className="right">Duration</span>
                <span />
              </div>

              <div className="sheet-rows">
                <AnimatePresence initial={false}>
                  {rows.length === 0 && (
                    <motion.div key="empty" className="empty-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      Nothing on this day yet — add a row.
                    </motion.div>
                  )}

                  {rows.map((row) =>
                    row.kind === "work" ? (
                      <motion.div
                        key={`w-${row.draft.id}`}
                        className="sheet-row"
                        layout
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <span className="no">{row.no}</span>
                        <span className="kind">
                          <i />
                          Work
                        </span>
                        <input
                          type="time"
                          step={60}
                          aria-label={`Session ${row.no} punch in`}
                          value={row.draft.in}
                          onChange={(e) => patch(row.index, "in", e.target.value)}
                        />
                        <span className="out-cell">
                          <input
                            type="time"
                            step={60}
                            aria-label={`Session ${row.no} punch out`}
                            value={row.draft.out}
                            onChange={(e) => patch(row.index, "out", e.target.value)}
                          />
                          {!row.draft.out.trim() && (
                            <button
                              type="button"
                              className="now"
                              title="Punch out at this minute"
                              onClick={() => patch(row.index, "out", inputTimeNow())}
                            >
                              <ClockIcon width={12} height={12} />
                              Now
                            </button>
                          )}
                        </span>
                        <span className="dur right">{lengthOf(row.draft.in, row.draft.out)}</span>
                        <button
                          className="hist-x"
                          aria-label={`Remove session ${row.no}`}
                          onClick={() => removeRow(row.index)}
                        >
                          ×
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`b-${row.before}`}
                        className="sheet-row is-break"
                        layout
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <span className="no">{row.no}</span>
                        <span className="kind">
                          <i />
                          Break
                        </span>
                        <input
                          type="time"
                          step={60}
                          aria-label={`Break ${row.no} start`}
                          value={row.from}
                          onChange={(e) => patchBreak(row.before, "from", e.target.value)}
                        />
                        <input
                          type="time"
                          step={60}
                          aria-label={`Break ${row.no} end`}
                          value={row.to}
                          onChange={(e) => patchBreak(row.before, "to", e.target.value)}
                        />
                        <span className="dur right">{lengthOf(row.from, row.to)}</span>
                        <span />
                      </motion.div>
                    ),
                  )}
                </AnimatePresence>
              </div>

              <button className="btn dashed wide" style={{ marginTop: 12 }} onClick={addRow}>
                <PlusIcon width={14} height={14} />
                Add row
              </button>

              <div className="sheet-totals">
                <span>
                  <small>Total work</small>
                  <b className="green">{hm(preview.worked)}</b>
                </span>
                <span>
                  <small>Total break</small>
                  <b className="amber">{hm(preview.breakMs)}</b>
                </span>
                <span>
                  <small>Time in office</small>
                  <b>{hm(preview.office)}</b>
                </span>
                <span>
                  <small>First in</small>
                  <b>{clockTime(preview.first)}</b>
                </span>
                <span>
                  <small>Can leave at</small>
                  <b>{preview.leave == null ? "--:--" : clockShort(preview.leave)}</b>
                </span>
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={check.message}
                  className={`preview ${check.tone}`}
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
                Submit to history
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
