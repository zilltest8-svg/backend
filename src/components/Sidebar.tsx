import type { ReactNode } from "react";
import { Logo } from "./Logo";
import {
  DriveIcon,
  GearIcon,
  GridIcon,
  HistoryIcon,
  TrendIcon,
} from "./Icons";
import { AUTO_SYNC_MS, type AttendanceApi } from "../useAttendance";
import { clockShort } from "../time";

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
  /** True while a session is open — the logo's tip pulses. */
  running: boolean;
  api: AttendanceApi;
}

/**
 * Where the timer button used to be: punches now come from the HR API by
 * themselves, so what is worth a permanent place is whether that is working.
 */
function SyncStatus({ api }: { api: AttendanceApi }) {
  const signedIn = api.auth === "signed-in";
  const failed = signedIn && (api.error ?? api.syncError) != null;
  const title = !signedIn
    ? "Not signed in"
    : failed
      ? "Sync problem"
      : api.syncing || api.loading
        ? "Syncing…"
        : "Live sync on";
  const note = !signedIn
    ? "Sign in on the dashboard"
    : api.fetchedAt == null
      ? `every ${AUTO_SYNC_MS / 1000}s`
      : `updated ${clockShort(api.fetchedAt)}`;

  return (
    <div className={`sync-status${signedIn ? " on" : ""}${failed ? " failed" : ""}`}>
      <i />
      <span>
        <b>{title}</b>
        <small>{note}</small>
      </span>
    </div>
  );
}

export function Sidebar({ view, onView, running, api }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">
          <Logo size={22} live={running} />
        </span>
        <span>
          <b>Zil Time</b>
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
        <SyncStatus api={api} />
      </div>
    </aside>
  );
}
