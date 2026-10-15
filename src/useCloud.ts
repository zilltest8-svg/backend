import { useEffect, useMemo, useRef } from "react";
import { CloudHistory, cloudDaysOf, daySignature, type CloudDay, type CloudProfile, type CloudSnapshot } from "./cloud";
import { firestore } from "./firebase";
import { dayKey } from "./time";
import type { DayMeta, Session, Settings } from "./types";
import type { Sheet } from "./useSheet";
import type { Store } from "./useStore";

/**
 * A stable id for this browser, so history has a home in the cloud before
 * anyone has signed in. Not wiped by "Stop & wipe", so a later "Allow" finds
 * the same (now empty) home rather than orphaning it.
 */
const DEVICE_KEY = "otc.device";

function deviceId(): string {
  try {
    const seen = localStorage.getItem(DEVICE_KEY);
    if (seen) return seen;
    const fresh = `device-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "device-anonymous";
  }
}

export interface CloudOptions {
  store: Store;
  /** Take days as the cloud holds them — sessions and stamps in one update. */
  applyRemote: (sessions: Session[], meta: DayMeta) => void;
  replaceSettings: (settings: Settings) => void;
  sheet: Sheet;
  /** The signed-in HR account, which owns the history once known. */
  email: string | null | undefined;
  canPersist: boolean;
  say: (text: string, ok: boolean) => void;
}

/**
 * Mirror the store and the sheet connection to Firestore, and fold whatever
 * lands there back in. Everything the UI already does — add, edit, delete,
 * clear — reaches the cloud through this, with no other code involved.
 */
export function useCloud({ store, applyRemote, replaceSettings, sheet, email, canPersist, say }: CloudOptions): void {
  const cloud = useMemo(() => {
    const db = firestore();
    return db ? new CloudHistory(db) : null;
  }, []);

  const owner = email && email.trim() ? CloudHistory.ownerId(email) : deviceId();

  // Callbacks fire from listeners, long after the render that created them.
  const latest = useRef({ store, sheet, canPersist, applyRemote, replaceSettings, say });
  latest.current = { store, sheet, canPersist, applyRemote, replaceSettings, say };

  /** The days the last cloud snapshot contained — what "deleted elsewhere" is measured against. */
  const seen = useRef<Set<string>>(new Set());
  const warned = useRef(false);

  const failed = (error: unknown) => {
    // Said once — a toast on every retry would drown the screen.
    if (warned.current) return;
    warned.current = true;
    latest.current.say(`Cloud sync failed: ${error instanceof Error ? error.message : String(error)}`, false);
  };

  const push = () => {
    const { store: s, sheet: sh, canPersist: ok } = latest.current;
    if (!cloud || !ok) return;
    cloud.push(cloudDaysOf(s.sessions, s.meta)).catch(failed);
    let file = "";
    try {
      file = localStorage.getItem("otc.lastFile") ?? "";
    } catch {
      /* storage unavailable */
    }
    cloud
      .pushProfile({ settings: s.settings, sheet: { url: sh.url, id: sh.sheetId, file } })
      .catch(failed);
  };

  /**
   * A day that differs on both sides goes to whichever was saved later; a day
   * the cloud has never held is pushed up; a day the cloud held and has since
   * dropped was deleted elsewhere.
   */
  const applyCloud = (snap: CloudSnapshot) => {
    const { store: s } = latest.current;
    const local = cloudDaysOf(s.sessions, s.meta);
    const next = new Map<string, CloudDay>();
    let changed = false;

    for (const remote of snap.days.values()) {
      const mine = local.get(remote.key);
      if (!mine) {
        next.set(remote.key, remote);
        changed = true;
      } else if (daySignature(mine) === daySignature(remote) || mine.stamp.savedAt > remote.stamp.savedAt) {
        next.set(remote.key, mine);
      } else {
        next.set(remote.key, remote);
        changed = true;
      }
    }
    for (const mine of local.values()) {
      if (next.has(mine.key)) continue;
      if (!snap.first && seen.current.has(mine.key)) changed = true; // gone from the cloud since we last saw it
      else next.set(mine.key, mine); // never reached the cloud — push it
    }
    seen.current = new Set(snap.days.keys());

    if (changed) {
      const sessions = [...next.values()].flatMap((d) => d.sessions).sort((a, b) => a.in - b.in);
      const meta: DayMeta = {};
      for (const d of next.values()) meta[d.key] = d.stamp;
      latest.current.applyRemote(sessions, meta);
      // The store effect below pushes once the new state has rendered.
    } else {
      push();
    }
  };

  /** The cloud's profile wins whenever it exists and differs; an owner with none yet gets this browser's. */
  const applyProfile = (profile: CloudProfile) => {
    if (!profile.exists) return push();
    const { store: s, sheet: sh } = latest.current;
    const settings = profile.data.settings as Partial<Settings> | undefined;
    if (settings && typeof settings.target === "number" && typeof settings.free === "number") {
      if (settings.target !== s.settings.target || settings.free !== s.settings.free) {
        latest.current.replaceSettings({ target: settings.target, free: settings.free });
      }
    }
    const remoteSheet = profile.data.sheet as Partial<{ url: string; id: string; file: string }> | undefined;
    if (remoteSheet) {
      sh.restore({
        url: typeof remoteSheet.url === "string" ? remoteSheet.url : "",
        sheetId: typeof remoteSheet.id === "string" ? remoteSheet.id : "",
        file: typeof remoteSheet.file === "string" ? remoteSheet.file : "",
      });
    }
    push();
  };

  // Signing in or out moves history to a different owner in the cloud.
  useEffect(() => {
    if (!cloud) return;
    seen.current = new Set();
    cloud.attach(owner, applyCloud, failed, applyProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, owner]);

  useEffect(() => () => cloud?.detach(), [cloud]);

  // Write-through: whatever changes here goes up, as a diff.
  useEffect(() => {
    push();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, store.sessions, store.meta, store.settings, sheet.url, sheet.sheetId, sheet.lastSaved, canPersist]);

  // "Stop & wipe" wipes the cloud copy too — it is the same data, just elsewhere.
  const could = useRef(canPersist);
  useEffect(() => {
    if (could.current && !canPersist) cloud?.clear().catch(failed);
    could.current = canPersist;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, canPersist]);
}

/** The day a filter points at still exists in these sessions. */
export function hasDay(sessions: Session[], day: string): boolean {
  return day === "latest" || sessions.some((s) => dayKey(s.in) === day);
}
