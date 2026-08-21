import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { CheckIcon, SheetIcon, StarIcon } from "./Icons";
import type { DayResult } from "../types";
import { hm } from "../time";

interface Cell {
  icon: ReactNode;
  tone: string;
  label: string;
  value: string;
  /** Rendered smaller and dimmed — the live seconds, or the AM/PM suffix. */
  tail?: string;
  unit: string;
}

interface Props {
  day: DayResult;
  /** Opens the day sheet, where the day is checked over and signed off. */
  onSave: () => void;
  /** True once that day has been submitted, so the button says so. */
  saved: boolean;
}

export function StatsStrip({ day, onSave, saved }: Props) {
  // Worked, Break, Remaining and First in all used to sit here. Every one of
  // them is now in the HR panel at the top of the dashboard, reading the same
  // day, so this row is down to what is genuinely only here: overtime once
  // there is any, and the button into the day sheet.
  const cells: Cell[] = [];

  if (day.overtime > 0) {
    cells.push({ icon: <StarIcon />, tone: "red", label: "Overtime", value: hm(day.overtime), unit: "hours" });
  }

  return (
    <div className="stats">
      {cells.map((c, i) => (
        <motion.div
          className="stat stat-key"
          key={c.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className={`icon-tile ${c.tone}`}>{c.icon}</div>
          <div>
            <div className="k">{c.label}</div>
            <div className="v">
              {c.value}
              {c.tail && <span className="tail">{c.tail}</span>}
            </div>
            <div className="u">{c.unit}</div>
          </div>
        </motion.div>
      ))}

      <motion.div
        className="stat stat-action"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 * cells.length, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <button className="btn wide" disabled={day.sessions.length === 0} onClick={onSave}>
          {saved ? <CheckIcon width={15} height={15} /> : <SheetIcon width={15} height={15} />}
          {saved ? "Saved — edit day" : "Add to History"}
        </button>
      </motion.div>
    </div>
  );
}
