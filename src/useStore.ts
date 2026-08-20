import { useCallback, useEffect, useRef, useState } from "react";
import { dayKey } from "./time";
import type { DayMeta, Filter, Session, Settings } from "./types";

const KEY = "otc.v3";
const V2 = "otc.v2";
const LEGACY = "otc.v1";

export interface Store {
  /** Every punch ever loaded, across every day — history lives here. */
  sessions: Session[];
  settings: Settings;
  filter: Filter;
  meta: DayMeta;
}

const DEFAULTS: Store = {
  sessions: [],
  settings: { target: 480, free: 0 },
  filter: { month: "all", day: "latest" },
  meta: {},
};

const settingsOf = (patch: Partial<Settings> | undefined): Settings => ({
  ...DEFAULTS.settings,
  ...(patch ?? {}),
});

const filterOf = (patch: Partial<Filter> | undefined): Filter => ({
  month: typeof patch?.month === "string" ? patch.month : DEFAULTS.filter.month,
  day: typeof patch?.day === "string" ? patch.day : DEFAULTS.filter.day,
});

/**
 * Seed the per-day timestamps for punches that predate them: the last thing
 * that happened that day is the truest "when was this recorded" we can recover.
 */
function seedMeta(sessions: Session[]): DayMeta {
  const meta: DayMeta = {};
  for (const s of sessions) {
    const key = dayKey(s.in);
    const at = s.out ?? s.in;
    if (!meta[key] || meta[key].savedAt < at) meta[key] = { savedAt: at };
  }
  return meta;
}

/** A per-day fingerprint of the punches, so only days that actually changed are re-stamped. */
function signature(sessions: Session[]): Map<string, string> {
  const sig = new Map<string, string>();
  for (const s of [...sessions].sort((a, b) => a.in - b.in)) {
    const key = dayKey(s.in);
    sig.set(key, `${sig.get(key) ?? ""}|${s.in}-${s.out ?? "open"}`);
  }
  return sig;
}

/** Stamp the days whose punches changed, and drop the days that no longer exist. */
function restamp(prev: Session[], next: Session[], meta: DayMeta, at: number): DayMeta {
  const before = signature(prev);
  const after = signature(next);
  const out: DayMeta = {};
  for (const [key, value] of after) {
    const kept = before.get(key) === value ? meta[key] : undefined;
    out[key] = kept ?? { savedAt: at };
  }
  return out;
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      if (Array.isArray(parsed.sessions)) {
        return {
          sessions: parsed.sessions,
          settings: settingsOf(parsed.settings),
          filter: filterOf(parsed.filter),
          meta: parsed.meta && typeof parsed.meta === "object" ? parsed.meta : seedMeta(parsed.sessions),
        };
      }
    }
    // v2: sessions + settings, one flat day, no history bookkeeping
    const v2 = localStorage.getItem(V2);
    if (v2) {
      const parsed = JSON.parse(v2) as Partial<Store>;
      if (Array.isArray(parsed.sessions)) {
        return {
          ...DEFAULTS,
          sessions: parsed.sessions,
          settings: settingsOf(parsed.settings),
          meta: seedMeta(parsed.sessions),
        };
      }
    }
    // v1: the flat shape the first version wrote
    const old = localStorage.getItem(LEGACY);
    if (old) {
      const v1 = JSON.parse(old) as { sessions?: Session[]; target?: number; free?: number };
      if (Array.isArray(v1.sessions)) {
        return {
          ...DEFAULTS,
          sessions: v1.sessions,
          settings: { target: v1.target ?? 480, free: v1.free ?? 0 },
          meta: seedMeta(v1.sessions),
        };
      }
    }
  } catch {
    /* corrupt storage — fall through to defaults */
  }
  return DEFAULTS;
}

/**
 * `canPersist` is the storage consent. Reading is unconditional — data already in
 * this browser belongs to the user and dropping it would be silent data loss —
 * but nothing is written back until they say yes, and the write happens the
 * moment they do.
 */
export function useStore(canPersist: boolean) {
  const [store, setStore] = useState<Store>(readStore);

  useEffect(() => {
    if (!canPersist) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {
      /* quota or private mode — the app still works, it just won't persist */
    }
  }, [store, canPersist]);

  const setSessions = useCallback(
    (update: Session[] | ((prev: Session[]) => Session[])) =>
      setStore((s) => {
        const sessions = typeof update === "function" ? update(s.sessions) : update;
        return { ...s, sessions, meta: restamp(s.sessions, sessions, s.meta, Date.now()) };
      }),
    [],
  );

  const setSettings = useCallback(
    (patch: Partial<Settings>) => setStore((s) => ({ ...s, settings: { ...s.settings, ...patch } })),
    [],
  );

  const setFilter = useCallback(
    (patch: Partial<Filter>) => setStore((s) => ({ ...s, filter: { ...s.filter, ...patch } })),
    [],
  );

  /**
   * Replace one day's punches and sign that day off, in a single update. It has
   * to be one: `restamp` drops the meta of a day whose punches changed, so
   * stamping in a second call would be racing its own write.
   */
  const commitDay = useCallback((key: string, sessions: Session[]) => {
    setStore((s) => {
      const next = [...s.sessions.filter((x) => dayKey(x.in) !== key), ...sessions].sort(
        (a, b) => a.in - b.in,
      );
      const at = Date.now();
      const meta = restamp(s.sessions, next, s.meta, at);
      // A day can be emptied from the sheet, in which case there is nothing to sign off.
      if (meta[key]) meta[key] = { savedAt: meta[key].savedAt, submittedAt: at };
      return { ...s, sessions: next, meta };
    });
  }, []);

  return { store, setSessions, setSettings, setFilter, commitDay };
}

/**
 * A shared clock. Ticks fast enough that the ring glides and the seconds never
 * visibly stall, but it is throttled to 4 fps so React isn't re-rendering the
 * whole tree 60 times a second — the smooth motion comes from framer-motion.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  const frame = useRef(0);

  useEffect(() => {
    let last = 0;
    const loop = (t: number) => {
      frame.current = requestAnimationFrame(loop);
      if (t - last < intervalMs) return;
      last = t;
      setNow(Date.now());
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [intervalMs]);

  return now;
}
