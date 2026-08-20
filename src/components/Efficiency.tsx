import { motion } from "framer-motion";
import type { DayResult } from "../types";

/** Donut that draws itself to the current percentage. */
function Donut({ value }: { value: number }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  return (
    <svg width={78} height={78} viewBox="0 0 78 78" style={{ transform: "rotate(-90deg)", flex: "0 0 auto" }}>
      <circle cx="39" cy="39" r={r} fill="none" stroke="#26262b" strokeWidth="9" />
      <motion.circle
        cx="39"
        cy="39"
        r={r}
        fill="none"
        stroke="var(--green)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

export function Efficiency({ day }: { day: DayResult }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="eff">
        <div>
          <div className="k">Efficiency</div>
          <div className="v">{Math.round(day.efficiency * 100)}%</div>
          <div className="s">of goal achieved</div>
        </div>
        <Donut value={day.efficiency} />
      </div>
    </motion.div>
  );
}
