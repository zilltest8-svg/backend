import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ChevronIcon, PlusIcon, SheetIcon } from "./Icons";
import { daysInMonth, monthsOf, totalsOf, type DayEntry } from "../history";
import type { Block, Filter } from "../types";
import {
  clockShort,
  clockTime,
  dateLabel,
  dayMonth,
  hm,
  human,
  monthLabel,
  monthLabelFromKey,
  weekday,
} from "../time";

interface Props {
  days: DayEntry[];
  filter: Filter;
  /** The day the calculator is showing — marked in the list. */
  selectedKey: string | null;
  /** Free text from the top bar; narrows the list further. */
  query: string;
  onFilter: (patch: Partial<Filter>) => void;
  onDeleteDay: (key: string) => void;
  onClearAll: () => void;
  /** Opens the day sheet for that date. */
  onEdit: (key: string) => void;
}

/** Matches a day against what was typed: "18 aug", "august", "2026-08", "wed". */
function matches(day: DayEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${day.key} ${dateLabel(day.at)} ${weekday(day.at)} ${monthLabel(day.at)}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/** "Session 2" / "Break 1", numbered in the order they happened. */
function numbered(blocks: Block[]): { block: Block; caption: string }[] {
  let work = 0;
  let brk = 0;
  return blocks.map((block) => {
    if (block.kind === "work") {
      work += 1;
      return { block, caption: `Session ${work}` };
    }
    brk += 1;
    return { block, caption: `Break ${brk}` };
  });
}

/** What happened inside one day, opened by tapping its row. */
function Detail({
  day,
  isSelected,
  onShow,
  onEdit,
}: {
  day: DayEntry;
  isSelected: boolean;
  onShow: () => void;
  onEdit: () => void;
}) {
  const r = day.result;
  const rows = numbered(r.blocks);

  return (
    <motion.div
      className="hist-detail"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="hist-detail-in">
        <div className="hist-facts">
          <span>
            <small>Date</small>
            <b>{dateLabel(day.at)}</b>
          </span>
          <span>
            <small>First in</small>
            <b>{clockTime(r.first)}</b>
          </span>
          <span>
            <small>Last out</small>
            <b>{r.status === "working" ? "running" : clockTime(r.last)}</b>
          </span>
          <span>
            <small>Total work</small>
            <b className="green">{hm(r.worked)}</b>
          </span>
          <span>
            <small>Total break</small>
            <b className="amber">{hm(r.breakMs)}</b>
          </span>
          <span>
            <small>In office</small>
            <b>{hm(r.office)}</b>
          </span>
          <span>
            <small>Could leave at</small>
            <b>{r.leave == null ? "--:--" : clockShort(r.leave)}</b>
          </span>
        </div>

        <div className="hist-lines">
          {rows.length === 0 && <div className="empty-row">No punches on this day.</div>}
          {rows.map(({ block, caption }) => (
            <div key={`${block.kind}-${block.from}`} className={`hist-line${block.kind === "break" ? " is-break" : ""}`}>
              <span className="c">
                <i />
                {caption}
              </span>
              <span className="t">
                {clockTime(block.from)} → {block.live ? "running" : clockTime(block.to)}
              </span>
              <span className="t right">{hm(block.to - block.from)}</span>
            </div>
          ))}
        </div>

        <div className="hist-actions">
          <button className="btn sm" disabled={isSelected} onClick={onShow}>
            {isSelected ? "On the dashboard" : "Show on dashboard"}
          </button>
          <button className="btn sm" onClick={onEdit}>
            <SheetIcon width={14} height={14} />
            Edit day
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function HistoryPanel({
  days,
  filter,
  selectedKey,
  query,
  onFilter,
  onDeleteDay,
  onClearAll,
  onEdit,
}: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const months = monthsOf(days);
  const visible = daysInMonth(days, filter.month).filter((d) => matches(d, query));
  const totals = totalsOf(visible);

  // A month or day saved in the filter can outlive its data — deleting the last
  // day of August leaves `2026-08` selected with nothing to select it from. Keep
  // the option around rather than letting the <select> render blank.
  const monthMissing = filter.month !== "all" && !months.some((m) => m.key === filter.month);
  const dayMissing = filter.day !== "latest" && !visible.some((d) => d.key === filter.day);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="card-head" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>History</h2>
        {days.length > 0 && (
          <button className="link-btn" onClick={onClearAll}>
            Clear history
          </button>
        )}
      </div>

      <div className="pair">
        <div>
          <label htmlFor="f-month">Month</label>
          <select
            id="f-month"
            className="select"
            value={filter.month}
            onChange={(e) => onFilter({ month: e.target.value, day: "latest" })}
          >
            <option value="all">All months ({days.length} days)</option>
            {months.map((m) => (
              <option key={m.key} value={m.key}>
                {monthLabel(m.at)} ({m.days} {m.days === 1 ? "day" : "days"})
              </option>
            ))}
            {monthMissing && <option value={filter.month}>{monthLabelFromKey(filter.month)} (empty)</option>}
          </select>
        </div>
        <div>
          <label htmlFor="f-day">Day</label>
          <select id="f-day" className="select" value={filter.day} onChange={(e) => onFilter({ day: e.target.value })}>
            <option value="latest">Latest day</option>
            {visible.map((d) => (
              <option key={d.key} value={d.key}>
                {dateLabel(d.at)} — {weekday(d.at).slice(0, 3)}
              </option>
            ))}
            {dayMissing && <option value={filter.day}>{filter.day} (hidden)</option>}
          </select>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {totals.days > 0 && (
          <motion.div
            key={`${filter.month}-${totals.days}`}
            className="hist-totals"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <span>
              <b>{totals.days}</b> {totals.days === 1 ? "day" : "days"}
            </span>
            <span className="green">
              <b>{hm(totals.worked)}</b> worked
            </span>
            <span className="amber">
              <b>{hm(totals.breakMs)}</b> break
            </span>
            <span className="tail">avg {hm(totals.worked / totals.days)} / day</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="hist-rows">
        <AnimatePresence initial={false}>
          {visible.length === 0 && (
            <motion.div key="empty" className="empty-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {days.length === 0
                ? "Nothing stored yet — the days you load are kept here."
                : query.trim()
                  ? `No stored day matches "${query.trim()}".`
                  : "No days stored in that month."}
            </motion.div>
          )}

          {visible.map((d, i) => (
            <motion.div
              key={d.key}
              className={`hist-row${d.key === selectedKey ? " on" : ""}${open === d.key ? " open" : ""}`}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8, height: 0 }}
              transition={{ duration: 0.26, delay: Math.min(0.18, i * 0.03), ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="hist-main">
                <button
                  className="hist-pick"
                  aria-expanded={open === d.key}
                  onClick={() => setOpen((cur) => (cur === d.key ? null : d.key))}
                >
                  <span className="d">
                    <b>{dayMonth(d.at)}</b>
                    <small>{weekday(d.at)}</small>
                  </span>
                  <span className="t">
                    {clockTime(d.result.first)} → {d.result.status === "working" ? "running" : clockTime(d.result.last)}
                  </span>
                  <span className="n green">{hm(d.result.worked)}</span>
                  <span className="n amber">{hm(d.result.breakMs)}</span>
                  <span className="state">
                    <span className={`chip ${d.submittedAt == null ? "empty" : "saved"}`}>
                      {d.submittedAt == null ? "In progress" : `Saved ${clockTime(d.submittedAt)}`}
                    </span>
                    <motion.span
                      className="caret"
                      animate={{ rotate: open === d.key ? 90 : 0 }}
                      transition={{ duration: 0.22 }}
                    >
                      <ChevronIcon width={14} height={14} />
                    </motion.span>
                  </span>
                </button>
                <button className="hist-x" aria-label={`Remove ${dateLabel(d.at)}`} onClick={() => onDeleteDay(d.key)}>
                  ×
                </button>
              </div>

              <AnimatePresence initial={false}>
                {open === d.key && (
                  <Detail
                    day={d}
                    isSelected={d.key === selectedKey}
                    onShow={() => onFilter({ month: "all", day: d.key })}
                    onEdit={() => onEdit(d.key)}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {visible.length > 0 && (
        <p className="hint">
          Tap a day to see what happened inside it. Totals cover{" "}
          {filter.month === "all" ? "every stored day" : monthLabelFromKey(filter.month)}: {human(totals.office)} in
          the office.
        </p>
      )}

      <div className="btn-row">
        <button className="btn" onClick={() => onFilter({ month: "all", day: "latest" })}>
          Back to the latest day
        </button>
        <button className="btn dashed" onClick={() => onEdit(selectedKey ?? visible[0]?.key ?? "")}>
          <PlusIcon width={14} height={14} />
          Edit the shown day
        </button>
      </div>
    </motion.div>
  );
}
