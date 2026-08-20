import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import {
  DriveIcon,
  GearIcon,
  GridIcon,
  HistoryIcon,
  PlayIcon,
  StopIcon,
  TrendIcon,
} from "./Icons";

export type View = "dashboard" | "insights" | "history" | "export" | "settings";

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <GridIcon width={17} height={17} /> },
  { id: "insights", label: "Insights", icon: <TrendIcon width={17} height={17} /> },
  { id: "history", label: "History", icon: <HistoryIcon width={17} height={17} /> },
  { id: "export", label: "Export", icon: <DriveIcon width={17} height={17} /> },
];

interface Props {
  view: View;
  onView: (view: View) => void;
  /** True while a session is open, which turns the button into Stop. */
  running: boolean;
  onTimer: () => void;
}

export function Sidebar({ view, onView, running, onTimer }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">
          <Logo size={22} live={running} />
        </span>
        <span>
          <b>Chronos</b>
          <small>Deep Work Mode</small>
        </span>
      </div>

      <nav className="nav">
        {NAV.map((item) => (
          <button key={item.id} className={view === item.id ? "on" : ""} onClick={() => onView(item.id)}>
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      <div className="side-foot">
        <nav className="nav">
          <button className={view === "settings" ? "on" : ""} onClick={() => onView("settings")}>
            <GearIcon width={17} height={17} />
            Settings
          </button>
        </nav>
        <motion.button
          className={`timer-btn${running ? " stop" : ""}`}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.975 }}
          onClick={onTimer}
          title={running ? "Punch out now" : "Punch in now"}
        >
          {running ? <StopIcon width={14} height={14} /> : <PlayIcon width={14} height={14} />}
          {running ? "Stop Timer" : "Start Timer"}
        </motion.button>
      </div>
    </aside>
  );
}
