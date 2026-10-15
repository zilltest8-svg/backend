/**
 * History in Firestore — the same layout the Flutter app writes
 * (flutter_app/lib/state/cloud_history.dart), so both read each other's data:
 *
 *     users/{owner}                          the profile
 *       settings:    {target, free}
 *       sheet:       {url, id, file}         the Drive connection and its last export
 *     users/{owner}/days/{YYYY-MM-DD}        one document per stored day
 *       sessions:    [{id, in, out}]
 *       at:          number                  midnight of the day, UTC ms
 *       savedAt:     number
 *       submittedAt: number | null
 *       updatedAt:   server timestamp
 *
 * Every change the app makes is written through as a per-day set or delete,
 * and every change that lands from elsewhere comes back through the listener.
 */
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { dayKey, startOfDay } from "./time";
import type { DayMeta, Session } from "./types";

export interface DayStamp {
  savedAt: number;
  submittedAt?: number;
}

/** One day as it is stored in the cloud. */
export interface CloudDay {
  key: string;
  sessions: Session[];
  stamp: DayStamp;
}

/** A fingerprint of everything that is written, so unchanged days are not rewritten. */
export function daySignature(day: CloudDay): string {
  const punches = day.sessions.map((s) => `${s.id}:${s.in}-${s.out ?? "open"}`).join("|");
  return `${punches}#${day.stamp.savedAt}#${day.stamp.submittedAt ?? ""}`;
}

function toDoc(day: CloudDay): DocumentData {
  return {
    sessions: day.sessions.map((s) => ({ id: s.id, in: s.in, out: s.out ?? null })),
    at: day.sessions[0] ? startOfDay(day.sessions[0].in) : 0,
    savedAt: day.stamp.savedAt,
    submittedAt: day.stamp.submittedAt ?? null,
    updatedAt: serverTimestamp(),
  };
}

function fromDoc(key: string, data: DocumentData): CloudDay | null {
  const raw = Array.isArray(data.sessions) ? (data.sessions as unknown[]) : [];
  const sessions: Session[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (typeof r.in !== "number") continue;
    sessions.push({
      id: typeof r.id === "string" ? r.id : `t${r.in}`,
      in: r.in,
      out: typeof r.out === "number" ? r.out : null,
    });
  }
  sessions.sort((a, b) => a.in - b.in);
  const last = sessions[sessions.length - 1];
  if (!last) return null;
  const stamp: DayStamp = {
    savedAt: typeof data.savedAt === "number" ? data.savedAt : (last.out ?? last.in),
  };
  if (typeof data.submittedAt === "number") stamp.submittedAt = data.submittedAt;
  return { key, sessions, stamp };
}

/** Split the app's flat session list and per-day stamps into cloud days. */
export function cloudDaysOf(sessions: Session[], meta: DayMeta): Map<string, CloudDay> {
  const byDay = new Map<string, Session[]>();
  for (const s of [...sessions].sort((a, b) => a.in - b.in)) {
    const key = dayKey(s.in);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  const out = new Map<string, CloudDay>();
  for (const [key, list] of byDay) {
    const last = list[list.length - 1];
    if (!last) continue;
    out.set(key, { key, sessions: list, stamp: meta[key] ?? { savedAt: last.out ?? last.in } });
  }
  return out;
}

/** What a snapshot from the cloud looks like to the app. */
export interface CloudSnapshot {
  days: Map<string, CloudDay>;
  /** The first snapshot after attaching: local days missing from it are pushed, not deleted. */
  first: boolean;
  fromCache: boolean;
}

/** Everything about the owner that is not a day. */
export interface CloudProfile {
  data: DocumentData;
  /** False when the owner has no profile in the cloud yet. */
  exists: boolean;
  first: boolean;
}

/** The profile's content in a fixed order, so unchanged profiles are not rewritten. */
function fingerprint(data: DocumentData): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, stable(o[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(stable(data));
}

export class CloudHistory {
  private _owner: string | null = null;
  private unsub: Unsubscribe | null = null;
  private unsubProfile: Unsubscribe | null = null;
  private first = true;
  /** What the cloud last agreed with, per day, so writes are diffs. */
  private synced = new Map<string, string>();
  private profileSynced: string | null = null;

  constructor(private readonly db: Firestore) {}

  get owner(): string | null {
    return this._owner;
  }

  /** Firestore document ids may not contain `/`; an email is otherwise fine. */
  static ownerId(raw: string): string {
    return raw.trim().toLowerCase().replace(/\//g, "_");
  }

  private profile(owner: string) {
    return doc(this.db, "users", owner);
  }

  private days(owner: string) {
    return collection(this.db, "users", owner, "days");
  }

  /** Start mirroring `owner`. The listeners fire with the full state on every change. */
  attach(
    owner: string,
    onSnapshot_: (snap: CloudSnapshot) => void,
    onError: (error: unknown) => void,
    onProfile?: (profile: CloudProfile) => void,
  ): void {
    if (owner === this._owner) return;
    this.detach();
    this._owner = owner;
    this.first = true;

    if (onProfile) {
      let firstProfile = true;
      this.unsubProfile = onSnapshot(
        this.profile(owner),
        (snap) => {
          const raw = snap.data() ?? {};
          const data: DocumentData = {};
          for (const [k, v] of Object.entries(raw)) if (k !== "updatedAt") data[k] = v;
          this.profileSynced = snap.exists() ? fingerprint(data) : null;
          const first = firstProfile;
          firstProfile = false;
          onProfile({ data, exists: snap.exists(), first });
        },
        onError,
      );
    }

    this.unsub = onSnapshot(
      this.days(owner),
      (snap) => {
        const days = new Map<string, CloudDay>();
        for (const d of snap.docs) {
          const day = fromDoc(d.id, d.data());
          if (day) days.set(d.id, day);
        }
        // What the snapshot holds is what the cloud holds, our own pending
        // writes included — a write that is later refused surfaces as an error.
        this.synced = new Map([...days].map(([k, v]) => [k, daySignature(v)]));
        const first = this.first;
        this.first = false;
        onSnapshot_({ days, first, fromCache: snap.metadata.fromCache });
      },
      onError,
    );
  }

  detach(): void {
    this.unsub?.();
    this.unsubProfile?.();
    this.unsub = null;
    this.unsubProfile = null;
    this._owner = null;
    this.synced.clear();
    this.profileSynced = null;
  }

  /** Write the days that changed and delete the ones that are gone, in one batch. */
  async push(days: Map<string, CloudDay>): Promise<void> {
    const owner = this._owner;
    if (!owner) return;
    const batch = writeBatch(this.db);
    let writes = 0;
    for (const day of days.values()) {
      const sig = daySignature(day);
      if (this.synced.get(day.key) === sig) continue;
      batch.set(doc(this.days(owner), day.key), toDoc(day));
      this.synced.set(day.key, sig);
      writes++;
    }
    for (const key of [...this.synced.keys()]) {
      if (days.has(key)) continue;
      batch.delete(doc(this.days(owner), key));
      this.synced.delete(key);
      writes++;
    }
    if (writes) await batch.commit();
  }

  /** Write the profile if it differs from what the cloud holds. */
  async pushProfile(data: DocumentData): Promise<void> {
    const owner = this._owner;
    if (!owner) return;
    const print = fingerprint(data);
    if (print === this.profileSynced) return;
    this.profileSynced = print;
    await setDoc(this.profile(owner), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }

  /** Remove everything the owner has stored. */
  async clear(): Promise<void> {
    const owner = this._owner;
    if (!owner) return;
    const all = await getDocs(this.days(owner));
    const batch = writeBatch(this.db);
    for (const d of all.docs) batch.delete(d.ref);
    batch.delete(this.profile(owner));
    this.synced.clear();
    this.profileSynced = null;
    await batch.commit();
  }
}
