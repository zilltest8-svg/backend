import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { BulbIcon, ChartIcon, CoffeeIcon, StopwatchIcon } from "./Icons";
import { DayBars3D } from "./DayBars3D";
import { Efficiency } from "./Efficiency";
import type { DayEntry } from "../history";
import type { DayResult } from "../types";
import { MIN, clockShort, clockTime, hm, hms, human } from "../time";

const TIPS = [
  "Take regular breaks to stay productive and healthy.",
  "Every break minute pushes your exit time back by the same amount.",
  "Re-paste the API response any time — sessions update instead of duplicating.",
  "Punch out before lunch so the break is counted from the right minute.",
] as const;

/** Facts worth surfacing, all derived from the day rather than guessed at. */
function insights(day: DayResult): string[] {
  const works = day.blocks.filter((b) => b.kind === "work");
  const breaks = day.blocks.filter((b) => b.kind === "break");
  if (works.length === 0) return ["Nothing loaded yet — add punches to see insights."];

  const longest = works.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  const longestBreak = breaks.length ? breaks.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a)) : null;
  const avg = day.worked / works.length;

  const out = [
    `${works.length} work session${works.length === 1 ? "" : "s"}, averaging ${human(avg)} each.`,
    `Longest stretch ${hm(longest.to - longest.from)}, from ${clockTime(longest.from)}.`,
    breaks.length
      ? `${breaks.length} break${breaks.length === 1 ? "" : "s"} totalling ${hm(day.breakMs)}${
          longestBreak ? ` — longest ${hm(longestBreak.to - longestBreak.from)} at ${clockTime(longestBreak.from)}` : ""
        }.`
      : "No breaks taken on this day.",
  ];

  if (day.leave != null) {
    out.push(
      day.reached
        ? `Goal was met at ${clockShort(day.leave)}; that is ${human(Math.abs(day.elapsed - day.span))} past it.`
        : `Break time has pushed the exit ${human(day.billableBreak)} later, to ${clockShort(day.leave)}.`,
    );
  }
  if (day.remaining > 0) {
    out.push(`${hm(day.remaining)} of work still owed against the ${hm(day.span - day.billableBreak)} target.`);
  }
  return out;
}

function splitLive(ms: number, live: boolean): { value: string; tail?: string } {
  if (!live) return { value: hm(ms) };
  const full = hms(ms);
  const i = full.lastIndexOf(":");
  return { value: full.slice(0, i), tail: full.slice(i) };
}

interface Props {
  day: DayResult;
  /** Every stored day, for the averages across the whole record. */
  days: DayEntry[];
  /** Minutes of work owed, drawn as the goal line on the chart. */
  target: number;
}

export function Insights({ day, days, target }: Props) {
  const [tip, setTip] = useState(0);
  const live = !day.stale;

  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), 9000);
    return () => window.clearInterval(id);
  }, []);

  const worked = days.reduce((a, d) => a + d.result.worked, 0);
  const breaks = days.reduce((a, d) => a + d.result.breakMs, 0);

  const tiles = [
    { icon: <StopwatchIcon />, tone: "blue", label: "Total work time", ...splitLive(day.worked, live && day.status === "working"), sub: `${Math.round(day.worked / MIN)} minutes` },
    { icon: <CoffeeIcon />, tone: "amber", label: "Total break time", ...splitLive(day.breakMs, live && day.status === "break"), sub: `${Math.round(day.breakMs / MIN)} minutes` },
    { icon: <ChartIcon />, tone: "violet", label: "Office span", ...splitLive(day.elapsed, live && day.sessions.length > 0), sub: "first in → now" },
  ];

  return (
    <div className="grid">
      <div className="tip">
        <span className="tag">Tip</span>
        <span style={{ display: "flex", color: "var(--amber)" }}>
          <BulbIcon width={15} height={15} />
        </span>
        {TIPS[tip]}
      </div>

      <DayBars3D days={days} target={target} />

      <div className="cols">
        <div className="grid">
          <div className="card">
            <h2>This day</h2>
            <div className="mini-grid">
              {tiles.map((t, i) => (
                <motion.div
                  className="mini"
                  key={t.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i, duration: 0.4 }}
                >
                  <div className={`icon-tile ${t.tone}`}>{t.icon}</div>
                  <div>
                    <div className="k">{t.label}</div>
                    <div className="v">
                      {t.value}
                      {t.tail && <span className="tail">{t.tail}</span>}
                    </div>
                    <div className="sub">{t.sub}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>What the day says</h2>
            <ul className="insight-list">
              {insights(day).map((line, i) => (
                <motion.li
                  key={line}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.04 * i, duration: 0.3 }}
                >
                  {line}
                </motion.li>
              ))}
            </ul>
            <p className="hint">
              Exit = first punch-in + {hm(day.span - day.billableBreak)} work + every break minute
              {day.billableBreak > 0 && ` (currently ${Math.round(day.billableBreak / MIN)} min)`}.
            </p>
          </div>
        </div>

        <div className="grid">
          <Efficiency day={day} />
          <div className="card">
            <h2>Across {days.length} stored {days.length === 1 ? "day" : "days"}</h2>
            <div className="grid" style={{ gap: 10 }}>
              <div className="mini">
                <div>
                  <div className="k">Worked in total</div>
                  <div className="v green">{hm(worked)}</div>
                  <div className="sub">{days.length ? `${hm(worked / days.length)} a day on average` : "nothing stored yet"}</div>
                </div>
              </div>
              <div className="mini">
                <div>
                  <div className="k">Break in total</div>
                  <div className="v">{hm(breaks)}</div>
                  <div className="sub">{days.length ? `${hm(breaks / days.length)} a day on average` : "—"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
