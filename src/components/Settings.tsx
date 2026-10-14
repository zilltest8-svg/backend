import { useEffect, useState } from "react";
import { BellIcon, HeartIcon } from "./Icons";
import type { Settings as SettingsValues } from "../types";
import type { Consent } from "../useConsent";
import type { HealthNotify } from "../useHealthAlerts";
import { hm, MIN } from "../time";

interface Props {
  settings: SettingsValues;
  onChange: (patch: Partial<SettingsValues>) => void;
  storedDays: number;
  onClearAll: () => void;
  consent: Consent;
  onAllow: () => void;
  onReject: () => void;
  /** Browser notification permission for the health reminders. */
  notify: HealthNotify;
}

const NOTIFY_TEXT: Record<HealthNotify["state"], string> = {
  granted: "Notifications on — reminders reach you even when this tab is in the background.",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings to get them.",
  default: "Reminders show as a banner here. Allow notifications to get them when the tab is in the background.",
  unsupported: "This browser cannot show notifications; reminders show as a banner here.",
};

/** Minutes in, minutes out — the two numbers the whole calculation rests on. */
export function Settings({
  settings,
  onChange,
  storedDays,
  onClearAll,
  consent,
  onAllow,
  onReject,
  notify,
}: Props) {
  const [target, setTarget] = useState(String(settings.target));
  const [free, setFree] = useState(String(settings.free));

  // A pasted response can carry its own target, so mirror it back into the field.
  useEffect(() => setTarget(String(settings.target)), [settings.target]);
  useEffect(() => setFree(String(settings.free)), [settings.free]);

  const commit = (raw: string, key: "target" | "free") => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    onChange({ [key]: key === "target" ? Math.max(1, Math.round(n)) : Math.round(n) });
  };

  return (
    <div className="cols">
      <div className="grid">
      <div className="card">
        <h2 className="sub">Working day</h2>
        <p className="lead">Both in minutes. The exit time is the first punch-in plus the target plus every break minute that isn't free.</p>

        <div className="pair">
          <div>
            <label htmlFor="s-target">Work target</label>
            <input
              id="s-target"
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() => commit(target, "target")}
            />
            <p className="hint">{hm(settings.target * MIN)} of actual work owed.</p>
          </div>
          <div>
            <label htmlFor="s-free">Free break</label>
            <input
              id="s-free"
              type="number"
              min={0}
              value={free}
              onChange={(e) => setFree(e.target.value)}
              onBlur={() => commit(free, "free")}
            />
            <p className="hint">
              {settings.free > 0
                ? `First ${settings.free} break minutes don't push the exit.`
                : "Every break minute pushes the exit."}
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="sub">
          <HeartIcon width={15} height={15} style={{ verticalAlign: "-2px", marginRight: 7 }} />
          Health break rule
        </h2>
        <p className="lead">Reminders at 2h, 3h and 4h of continuous work, and the auto punch-out at 4h 15m.</p>

        <div className="btn-row">
          <button className={`btn${settings.health ? " primary" : ""}`} disabled={settings.health} onClick={() => onChange({ health: true })}>
            On
          </button>
          <button className={`btn${settings.health ? "" : " primary"}`} disabled={!settings.health} onClick={() => onChange({ health: false })}>
            Off
          </button>
        </div>

        <div className={`preview ${settings.health ? "ok" : "idle"}`}>
          {settings.health
            ? "On — each reminder arrives as an alert, a notification and a short tone, with the reason it fired."
            : "Off — no reminders are shown."}
        </div>

        <div className="btn-row" style={{ gridTemplateColumns: "1fr" }}>
          <button
            className="btn"
            disabled={!settings.health || notify.state !== "default"}
            onClick={() => void notify.request()}
          >
            <BellIcon width={15} height={15} />
            {notify.state === "granted" ? "Browser notifications allowed" : "Allow browser notifications"}
          </button>
        </div>
        <p className="hint">{NOTIFY_TEXT[notify.state]}</p>
      </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2 className="sub">Storage</h2>
          <p className="lead">
            Your punches are saved in this browser automatically, including what the HR sync
            brings in every minute. No cookies are set and nothing is sent anywhere else.
          </p>

          <div className={`preview ${consent === "denied" ? "warn" : "ok"}`}>
            {consent === "denied"
              ? "Off — nothing is written, so closing the tab loses the day."
              : "Saving automatically — this day and every stored day survive a refresh."}
          </div>

          <div className="btn-row">
            <button className="btn primary" disabled={consent !== "denied"} onClick={onAllow}>
              Save in this browser
            </button>
            <button className="btn" disabled={consent === "denied"} onClick={onReject}>
              Stop &amp; wipe
            </button>
          </div>
          <p className="hint">Stopping also deletes what is already saved in this browser.</p>
        </div>

        <div className="card">
          <h2 className="sub">Stored data</h2>
          <p className="lead">
            {consent !== "denied"
              ? `${storedDays} ${storedDays === 1 ? "day" : "days"} kept in this browser's local storage, filed by date.`
              : `${storedDays} ${storedDays === 1 ? "day" : "days"} in memory for this session only — allow storage above to keep them.`}
          </p>
          <button className="btn danger wide" disabled={storedDays === 0} onClick={onClearAll}>
            Clear all stored days
          </button>
        </div>
      </div>
    </div>
  );
}
