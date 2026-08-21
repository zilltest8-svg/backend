import { useCallback, useEffect, useState } from "react";
import { csvFilename, saveBlob, toCSV, toPayload, toRows, toTSV } from "./export";
import { DEFAULT_SHEET_ID, sheetIdFrom } from "./appsScript";
import type { DayResult } from "./types";

const URL_KEY = "otc.sheetUrl";
const ID_KEY = "otc.sheetId";
const FILE_KEY = "otc.lastFile";

/**
 * Real deployment URLs come in a few shapes — personal and Workspace accounts
 * differ, and Google often appends a query string when you copy the link:
 *   https://script.google.com/macros/s/AKfy…/exec
 *   https://script.google.com/a/macros/company.com/s/AKfy…/exec
 *   …/exec?usp=sharing        …/exec/       (trailing slash)
 * Anything ending in /exec on script.google.com is accepted.
 */
const EXEC = /^https:\/\/script\.google\.com\/\S*\/exec\/?(\?\S*)?$/i;

export const isExecUrl = (value: string): boolean => EXEC.test(value.trim());

/**
 * Canonical endpoint to call. The validator deliberately accepts a trailing
 * slash and a copied `?usp=sharing`, but Apps Script only serves the bare
 * `/exec` — calling `/exec/` 404s, which surfaces as "couldn't reach".
 */
export function execEndpoint(value: string): string {
  const withoutQuery = value.trim().split(/[?#]/)[0] ?? "";
  return withoutQuery.replace(/\/+$/, "");
}

/** Why a pasted URL was rejected, in words the user can act on. */
export function urlProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (isExecUrl(v)) return null;
  if (!/^https?:\/\//i.test(v)) return "That doesn't look like a URL — paste the whole https://… link.";
  if (!/script\.google\.com/i.test(v)) {
    return "That's not an Apps Script URL. Don't paste the spreadsheet link — deploy the script and copy the URL it gives you.";
  }
  if (/\/dev\/?$/i.test(v)) return "That's the /dev test URL. Use the /exec one from Deploy → New deployment.";
  if (/\/edit/i.test(v)) return "That's the script editor link. Use Deploy → New deployment and copy the /exec URL.";
  return "The deployment URL should end in /exec.";
}

export interface Sheet {
  url: string;
  setUrl: (value: string) => void;
  /** The Google Sheets document id, used to generate the setup script. */
  sheetId: string;
  setSheetId: (value: string) => void;
  /** A usable Apps Script /exec URL is saved. */
  configured: boolean;
  /** Nothing to export yet. */
  empty: boolean;
  rowCount: number;
  sending: boolean;
  /** Append the day's rows to the connected spreadsheet. */
  send: () => Promise<boolean>;
  /** Save the day as a CSV file in the connected Drive folder. */
  saveToDrive: () => Promise<boolean>;
  /** The most recent file written to Drive, so it stays one click away. */
  lastSaved: SavedFile | null;
  /** Ping the endpoint and report exactly what is wrong. */
  testConnection: () => Promise<boolean>;
  /** Forget the saved deployment so a new one can be connected. */
  disconnect: () => void;
  copyRows: () => Promise<void>;
  downloadCsv: () => void;
  /** The connect dialog is shared by every button that needs a connection. */
  setupOpen: boolean;
  openSetup: () => void;
  closeSetup: () => void;
}

export interface SavedFile {
  name: string;
  url: string;
  folder: string;
  folderUrl: string;
}

interface JsonpReply {
  ok?: boolean;
  error?: string;
  /** drive save */
  file?: string;
  url?: string;
  folder?: string;
  folderUrl?: string;
  /** health check */
  sheet?: string;
  tab?: string;
  driveFolder?: string;
}

/**
 * Load a URL through a <script> tag and resolve with whatever it calls back.
 * Script tags are exempt from CORS, which makes this the only way a page opened
 * from the file system can read an Apps Script response.
 */
function jsonp(url: string, timeoutMs = 20000): Promise<JsonpReply> {
  return new Promise((resolve, reject) => {
    const name = `otcCallback${Math.floor(Math.random() * 1e9)}`;
    const script = document.createElement("script");
    const globals = window as unknown as Record<string, unknown>;

    const cleanup = () => {
      window.clearTimeout(timer);
      delete globals[name];
      script.remove();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);

    globals[name] = (data: JsonpReply) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("network"));
    };
    script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${name}`;
    document.head.appendChild(script);
  });
}

/**
 * A failed <script> load says nothing about *why*. Google serves every response
 * with `X-Content-Type-Options: nosniff`, so a sign-in page or plain JSON is
 * refused by the browser exactly like an unreachable host. This second probe
 * tells the two apart: an opaque no-cors fetch resolves for anything that
 * answered at all, and only rejects when nothing did.
 */
async function isReachable(endpoint: string): Promise<boolean> {
  try {
    await fetch(endpoint, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/** Translate a JSONP failure into the specific thing to go and fix. */
async function reachProblem(kind: string, endpoint: string): Promise<string> {
  if (kind === "timeout") {
    return "The script answered but never called back. Copy the setup script again, then Deploy → New deployment.";
  }
  if (await isReachable(endpoint)) {
    return (
      "The URL answered, but not with JavaScript — so it is NOT a wrong URL. " +
      "Either the deployment is still running the old code (Deploy → New deployment, not just Save), " +
      'or Google returned a sign-in page because access is not "Anyone". Open the /exec link to see which.'
    );
  }
  return "That URL doesn't resolve at all — it's from a deleted deployment, or you're offline. Redeploy and paste the new /exec URL.";
}

/** Clipboard API first, with the old selection trick as a fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* blocked — fall through to the fallback */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function useSheet(
  day: DayResult,
  say: (text: string, ok: boolean, action?: { label: string; href: string }) => void,
  /** Storage consent — the connection is only remembered once it is granted. */
  canPersist = true,
): Sheet {
  const [url, setUrlState] = useState("");
  const [sheetId, setSheetIdState] = useState(DEFAULT_SHEET_ID);
  const [sending, setSending] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [lastSaved, setLastSaved] = useState<SavedFile | null>(null);

  useEffect(() => {
    try {
      setUrlState(localStorage.getItem(URL_KEY) ?? "");
      setSheetIdState(localStorage.getItem(ID_KEY) ?? DEFAULT_SHEET_ID);
      const file = localStorage.getItem(FILE_KEY);
      if (file) setLastSaved(JSON.parse(file) as SavedFile);   // "" is falsy, so a cleared link stays cleared
    } catch {
      /* storage unavailable */
    }
  }, []);

  const remember = (key: string, value: string) => {
    if (!canPersist) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  };

  const setUrl = useCallback((value: string) => {
    setUrlState(value);
    remember(URL_KEY, value);
  }, []);

  /** Accepts a full Sheets URL or a bare id. */
  const setSheetId = useCallback((value: string) => {
    const id = sheetIdFrom(value) ?? value.trim();
    setSheetIdState(id);
    remember(ID_KEY, id);
  }, []);

  const rowCount = toRows(day).length;
  const empty = rowCount === 0;
  const configured = isExecUrl(url);

  /**
   * Apps Script replies from a host that sends no CORS headers, so every post
   * here is deliberately fire-and-forget: the data lands, the reply is
   * unreadable. Both destinations go through the one endpoint.
   */
  const post = useCallback(
    async (body: unknown, done: string): Promise<boolean> => {
      if (empty) {
        say("Nothing to send yet.", false);
        return false;
      }
      if (!configured) {
        setSetupOpen(true);
        return false;
      }
      setSending(true);
      try {
        await fetch(execEndpoint(url), {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(body),
        });
        say(done, true);
        return true;
      } catch {
        say("Couldn't reach the script URL.", false);
        return false;
      } finally {
        setSending(false);
      }
    },
    [configured, empty, say, url],
  );

  const send = useCallback(
    () => post(toPayload(day), `Sent ${rowCount} rows to your spreadsheet.`),
    [day, post, rowCount],
  );

  const saveToDrive = useCallback(async () => {
    if (empty) {
      say("Nothing to save yet.", false);
      return false;
    }
    if (!configured) {
      setSetupOpen(true);
      return false;
    }
    const filename = csvFilename(day);
    const csv = toCSV(day);
    setSending(true);
    try {
      // JSONP, not fetch: a cross-origin reply is unreadable from a file:// page,
      // and without the reply there is no way to show where the file landed.
      const query = `mode=drive&filename=${encodeURIComponent(filename)}&csv=${encodeURIComponent(csv)}`;
      const res = await jsonp(`${execEndpoint(url)}?${query}`);

      if (!res.ok) {
        say(res.error ? `Drive refused it: ${res.error}` : "Drive refused the file.", false);
        return false;
      }
      const saved: SavedFile = {
        name: res.file ?? filename,
        url: res.url ?? "",
        folder: res.folder ?? "Office Time",
        folderUrl: res.folderUrl ?? "",
      };
      setLastSaved(saved);
      remember(FILE_KEY, JSON.stringify(saved));
      say(`Saved ${saved.name} to ${saved.folder}.`, true, saved.url ? { label: "Open in Drive", href: saved.url } : undefined);
      return true;
    } catch (e) {
      say(await reachProblem((e as Error).message, execEndpoint(url)), false, {
        label: "Open /exec",
        href: execEndpoint(url),
      });
      return false;
    } finally {
      setSending(false);
    }
  }, [configured, day, empty, say, url]);

  /** Call the endpoint with no data, purely to report what is wrong. */
  const testConnection = useCallback(async (): Promise<boolean> => {
    if (!configured) {
      setSetupOpen(true);
      return false;
    }
    setSending(true);
    try {
      const res = await jsonp(execEndpoint(url));
      if (!res.ok) {
        say(`The script ran but failed: ${res.error ?? "unknown error"}`, false);
        return false;
      }
      say(
        res.driveFolder
          ? `Connected. Drive folder "${res.driveFolder}"${res.sheet ? `, sheet "${res.sheet}"` : ""}.`
          : "Connected, but this is the old script — copy the setup script again and re-deploy.",
        Boolean(res.driveFolder),
      );
      return Boolean(res.driveFolder);
    } catch (e) {
      say(await reachProblem((e as Error).message, execEndpoint(url)), false, {
        label: "Open /exec",
        href: execEndpoint(url),
      });
      return false;
    } finally {
      setSending(false);
    }
  }, [configured, say, url]);

  const copyRows = useCallback(async () => {
    if (empty) return say("Nothing to copy yet.", false);
    const ok = await copyText(toTSV(day));
    say(ok ? `${rowCount} rows copied — paste into your sheet.` : "Couldn't reach the clipboard.", ok);
  }, [day, empty, rowCount, say]);

  const downloadCsv = useCallback(() => {
    if (empty) return say("Nothing to download yet.", false);
    saveBlob(new Blob([toCSV(day)], { type: "text/csv;charset=utf-8;" }), csvFilename(day));
    say("CSV downloaded.", true);
  }, [day, empty, say]);

  /**
   * Drop the saved deployment. The last-saved file link goes too — it belongs
   * to the old connection and would point somewhere the new one doesn't own.
   */
  const disconnect = useCallback(() => {
    setUrlState("");
    setLastSaved(null);
    remember(URL_KEY, "");
    remember(FILE_KEY, "");
    say("Disconnected. Connect a deployment to save again.", true);
  }, [say]);

  const openSetup = useCallback(() => setSetupOpen(true), []);
  const closeSetup = useCallback(() => setSetupOpen(false), []);

  return {
    url, setUrl, sheetId, setSheetId, configured, empty, rowCount, sending,
    send, saveToDrive, lastSaved, testConnection, disconnect,
    copyRows, downloadCsv, setupOpen, openSetup, closeSetup,
  };
}
