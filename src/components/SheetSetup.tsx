import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DriveIcon } from "./Icons";
import { buildScript, sheetIdFrom, sheetUrlFrom } from "../appsScript";
import { copyText, isExecUrl, urlProblem, type Sheet } from "../useSheet";

/**
 * The one-time connect dialog, shared by every button that needs a connection.
 * A browser page opened from the file system cannot run Google's OAuth flow, so
 * the link is made through a small Apps Script the user deploys once — this
 * generates that script already pointed at their own sheet and Drive folder.
 */
export function SheetSetup({ sheet }: { sheet: Sheet }) {
  const [draft, setDraft] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sheet.setupOpen) return;
    setDraft(sheet.url);
    setLink(sheet.sheetId ? sheetUrlFrom(sheet.sheetId) : "");
  }, [sheet.setupOpen, sheet.url, sheet.sheetId]);

  useEffect(() => {
    if (!sheet.setupOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") sheet.closeSetup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  const id = sheetIdFrom(link);
  const valid = isExecUrl(draft);
  const problem = urlProblem(draft);

  const save = () => {
    if (!valid) return;
    if (id) sheet.setSheetId(id);
    sheet.setUrl(draft.trim());
    sheet.closeSetup();
  };

  return createPortal(
    <AnimatePresence>
      {sheet.setupOpen && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) sheet.closeSetup();
          }}
        >
          <motion.div
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="modal-head">
              <span className="icon-tile green">
                <DriveIcon />
              </span>
              <div>
                <h3 id="connect-title">
                  {sheet.configured ? "Reconnect Google Drive" : "Connect Google Drive"}
                </h3>
                <p>
                  {sheet.configured
                    ? "Already connected. Paste a new deployment URL to point it somewhere else, or disconnect."
                    : "A one-time authorisation. After this, saving is a single click."}
                </p>
              </div>
              <button className="modal-x" onClick={sheet.closeSetup} aria-label="Close">
                ×
              </button>
            </div>

            <div className="modal-body">
              <label htmlFor="sheet-link">Your Google Sheet link (optional)</label>
              <input
                id="sheet-link"
                type="url"
                spellCheck={false}
                placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
              <div className={`preview ${link.trim() ? (id ? "ok" : "error") : "idle"}`}>
                {!link.trim()
                  ? "Drive works without this — add a sheet link only if you also want rows appended."
                  : id
                    ? `Sheet id ${id.slice(0, 12)}… — the script is written for it.`
                    : "That isn't a Google Sheets link."}
              </div>

              <ol className="steps" style={{ marginTop: 18 }}>
                <li>
                  <motion.button
                    className="btn dashed"
                    style={{ width: "100%", marginTop: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      const ok = await copyText(buildScript(id ?? sheet.sheetId));
                      setCopied(ok);
                      window.setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "✓ Script copied" : "Copy setup script"}
                  </motion.button>
                </li>
                <li>
                  Open{" "}
                  <a href="https://script.new" target="_blank" rel="noreferrer">
                    script.new
                  </a>
                  , select all, paste, save.
                </li>
                <li>
                  <b>Deploy → New deployment → Web app</b>, run as <b>Me</b>, access <b>Anyone</b>.
                </li>
                <li>
                  Authorise it — it asks for <b>Drive</b> access so it can save the file. Your own
                  script shows an "unverified" warning: <b>Advanced → Go to project</b>.
                </li>
                <li>Paste the /exec URL it gives you below.</li>
              </ol>

              <label htmlFor="sheet-url" style={{ marginTop: 18 }}>
                Apps Script web app URL
              </label>
              <input
                id="sheet-url"
                type="url"
                spellCheck={false}
                placeholder="https://script.google.com/macros/s/.../exec"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
              />

              <div className={`preview ${draft.trim() ? (valid ? "ok" : "error") : "idle"}`}>
                {!draft.trim()
                  ? "Not connected yet — Download CSV works without any of this."
                  : valid
                    ? "Looks right. Save it and Drive is connected."
                    : problem}
              </div>

              {valid ? (
                <button
                  className="link-btn"
                  disabled={sheet.sending}
                  onClick={() => {
                    sheet.setUrl(draft.trim());
                    void sheet.testConnection();
                  }}
                >
                  {sheet.sending ? "Testing…" : "Test this connection"}
                </button>
              ) : (
                <button
                  className="link-btn"
                  onClick={() => {
                    sheet.downloadCsv();
                    sheet.closeSetup();
                  }}
                >
                  Skip this — download the CSV instead
                </button>
              )}
            </div>

            <div className={`modal-foot${sheet.configured ? " three" : ""}`}>
              <button className="btn" onClick={sheet.closeSetup}>
                Cancel
              </button>
              {sheet.configured && (
                <button
                  className="btn danger"
                  onClick={() => {
                    sheet.disconnect();
                    setDraft("");
                    sheet.closeSetup();
                  }}
                >
                  Disconnect
                </button>
              )}
              <motion.button
                className="btn primary"
                whileHover={valid ? { scale: 1.015 } : {}}
                whileTap={valid ? { scale: 0.975 } : {}}
                disabled={!valid}
                onClick={save}
              >
                Save &amp; connect
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
