import { useCallback, useState } from "react";

/**
 * The app sets no cookies and calls no third party — it keeps punches in this
 * browser's local storage. The consent choice governs that storage: until it is
 * granted nothing is written, and rejecting wipes whatever is already there.
 */
export type Consent = "unknown" | "granted" | "denied";

const KEY = "otc.consent";

/** Every key this app owns. Rejecting clears all of them — except the choice itself. */
const OWNED = ["otc.v3", "otc.v2", "otc.v1", "otc.sheetUrl", "otc.sheetId", "otc.lastFile"] as const;

function read(): Consent {
  try {
    const value = localStorage.getItem(KEY);
    return value === "granted" || value === "denied" ? value : "unknown";
  } catch {
    // private mode with storage blocked outright — nothing can be stored anyway
    return "unknown";
  }
}

export interface ConsentState {
  consent: Consent;
  /** True while the app may write to storage. */
  canPersist: boolean;
  allow: () => void;
  reject: () => void;
}

export function useConsent(): ConsentState {
  const [consent, setConsent] = useState<Consent>(read);

  const decide = useCallback((next: Exclude<Consent, "unknown">) => {
    try {
      if (next === "denied") for (const key of OWNED) localStorage.removeItem(key);
      // The choice itself is the one thing kept either way, so the question is
      // asked once rather than on every reload.
      localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable — the choice still holds for this session */
    }
    setConsent(next);
  }, []);

  const allow = useCallback(() => decide("granted"), [decide]);
  const reject = useCallback(() => decide("denied"), [decide]);

  return { consent, canPersist: consent === "granted", allow, reject };
}
