import { useEffect, useState } from "react";
import type { Settings as SettingsValues } from "../types";
import type { Consent } from "../useConsent";
import { hm, MIN } from "../time";

interface Props {
  settings: SettingsValues;
  onChange: (patch: Partial<SettingsValues>) => void;
  storedDays: number;
  onClearAll: () => void;
  consent: Consent;
  onAllow: () => void;
  onReject: () => void;
}

/** Minutes in, minutes out — the two numbers the whole calculation rests on. */
export function Settings({
  settings,
  onChange,
  storedDays,
  onClearAll,
  consent,
  onAllow,
  onReject,
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
