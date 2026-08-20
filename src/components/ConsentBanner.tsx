import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { createPortal } from "react-dom";
import { DatabaseIcon } from "./Icons";

interface Props {
  open: boolean;
  onAllow: () => void;
  onReject: () => void;
}

/**
 * The storage question, asked once. Worth being straight about what is behind
 * it: no cookies are set and nothing leaves the browser, so the only thing to
 * consent to is this browser keeping your own punches between visits.
 */
export function ConsentBanner({ open, onAllow, onReject }: Props) {
  const [details, setDetails] = useState(false);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="consent"
          role="dialog"
          aria-live="polite"
          aria-label="Cookies and storage"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="consent-in">
            <span className="icon-tile green">
              <DatabaseIcon />
            </span>

            <div className="consent-text">
              <b>Keep your day in this browser?</b>
              <p>
                Chronos sets no tracking cookies and sends nothing anywhere. Allowing lets it store
                your punches and settings in this browser so they survive a refresh.{" "}
                <button className="link-btn" onClick={() => setDetails((d) => !d)}>
                  {details ? "Hide details" : "What is stored?"}
                </button>
              </p>

              <AnimatePresence initial={false}>
                {details && (
                  <motion.ul
                    className="consent-list"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <li>
                      <b>Punches and settings</b> — every stored day, your work target and break
                      allowance, in local storage under <code>otc.v3</code>.
                    </li>
                    <li>
                      <b>Your export connection</b> — the Apps Script URL and sheet id, so Drive
                      stays one click away.
                    </li>
                    <li>
                      <b>Nothing else.</b> No cookies, no analytics, no third party. Rejecting keeps
                      the app working for this session and wipes anything already saved.
                    </li>
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>

            <div className="consent-actions">
              <motion.button
                className="btn primary"
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.975 }}
                onClick={onAllow}
              >
                Allow cookies
              </motion.button>
              <button className="btn" onClick={onReject}>
                Reject
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
