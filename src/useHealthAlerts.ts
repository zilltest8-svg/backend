import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Health, HealthAlert } from "./healthRule";

/** Stage keys already announced, kept across a reload so a refresh does not beep again. */
const FIRED_KEY = "otc.health.fired";

export type NotifyState = NotificationPermission | "unsupported";

export interface HealthNotify {
  state: NotifyState;
  request: () => Promise<void>;
}

export interface HealthAlerts {
  /** The alert to show across the top until it is dismissed or the stage moves on. */
  banner: HealthAlert | null;
  dismiss: () => void;
  notify: HealthNotify;
}

interface Options {
  health: Health;
  enabled: boolean;
  /** A stored day never alerts, however long its stretches were. */
  stale: boolean;
  /** The `YYYY-MM-DD` on screen, so the same stage on another day is a new alert. */
  dayKey: string;
}

function readFired(): Set<string> {
  try {
    const raw = sessionStorage.getItem(FIRED_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFired(set: Set<string>): void {
  try {
    sessionStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-60)));
  } catch {
    /* storage unavailable — the in-memory set still prevents repeats this session */
  }
}

/**
 * A short tone, synthesised rather than loaded, so the single-file build stays
 * asset-free. Two low notes for the auto punch-out, one for everything else.
 * Browsers refuse audio before the first interaction with the page; the catch
 * keeps that a silent failure.
 */
function chime(stop: boolean): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = stop ? [440, 330] : [660];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.28;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.28);
    });
    window.setTimeout(() => void ctx.close(), 1000);
  } catch {
    /* no audio — the banner still shows */
  }
}

const notifyState = (): NotifyState =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/**
 * Turns the health assessment into alerts: each stage of a stretch is
 * announced once — banner, browser notification and tone — and the banner
 * stays until it is dismissed or the next stage arrives. Nothing fires for a
 * stored day, or while the rule is switched off.
 */
export function useHealthAlerts({ health, enabled, stale, dayKey }: Options): HealthAlerts {
  const fired = useRef<Set<string> | null>(null);
  if (fired.current == null) fired.current = readFired();

  const [dismissed, setDismissed] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyState>(notifyState);

  const alert = enabled && !stale ? health.alert : null;
  // An auto punch-out has no open stretch, so the key falls back to the day.
  const key = alert ? `${dayKey}:${health.streakStart ?? "out"}:${alert.stage}` : null;

  useEffect(() => {
    if (!key || !alert) return;
    const set = fired.current as Set<string>;
    if (set.has(key)) return;
    set.add(key);
    writeFired(set);

    chime(alert.tone === "stop");
    if (notifyState() === "granted") {
      try {
        new Notification(alert.title, { body: `${alert.message}\n\n${alert.why}`, tag: key });
      } catch {
        /* notifications refused at this moment — the banner still shows */
      }
    }
  }, [key, alert]);

  const dismiss = useCallback(() => setDismissed(key), [key]);

  const request = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try {
      setPermission(await Notification.requestPermission());
    } catch {
      setPermission(notifyState());
    }
  }, []);

  const notify = useMemo(() => ({ state: permission, request }), [permission, request]);

  return { banner: alert && key !== dismissed ? alert : null, dismiss, notify };
}
