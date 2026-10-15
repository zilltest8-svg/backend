import { Logo } from "./Logo";
import { GearIcon } from "./Icons";
import { NAV, SyncStatus, type View } from "./Sidebar";
import type { AttendanceApi } from "../useAttendance";

interface Props {
  view: View;
  onView: (view: View) => void;
  /** True while a session is open — the logo's tip pulses. */
  running: boolean;
  api: AttendanceApi;
}

/**
 * The phone's header: the brand and whether the HR sync is working — the two
 * things the sidebar carries on a desktop that still need a home when the
 * sidebar is gone. Hidden by CSS above the phone breakpoint.
 */
export function MobileHeader({ running, api }: Pick<Props, "running" | "api">) {
  return (
    <header className="mobile-head">
      <div className="brand">
        <span className="mark">
          <Logo size={20} live={running} />
        </span>
        <span>
          <b>Zil Time</b>
        </span>
      </div>
      <SyncStatus api={api} />
    </header>
  );
}

const TABS: typeof NAV = [
  ...NAV,
  { id: "settings", label: "Settings", icon: <GearIcon width={20} height={20} /> },
];

/** Four tabs along the bottom edge, the way a phone app navigates. Hidden by CSS on a desktop. */
export function BottomNav({ view, onView }: Pick<Props, "view" | "onView">) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {TABS.map((item) => (
        <button
          key={item.id}
          className={view === item.id ? "on" : ""}
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onView(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
