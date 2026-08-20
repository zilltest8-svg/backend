import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoginIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (email: string, password: string) => void;
  /** True while the sign-in request is out, which locks the fields. */
  busy: boolean;
  /** What the HR API said went wrong, if anything. */
  error: string | null;
}

export function HrLoginModal({ open, onClose, onSubmit, busy, error }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  // Focus the email field each time it opens, and hold the page still behind it.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => firstField.current?.focus(), 60);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prev;
    };
  }, [open]);

  // The password only ever lives in this component's state, and only while the
  // modal is mounted — closing it drops both fields.
  useEffect(() => {
    if (open) return;
    setPassword("");
    setShow(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  const ready = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = () => {
    if (!ready) return;
    onSubmit(email.trim(), password);
    // Drop the password the moment it is handed over — if sign-in fails the
    // field starts empty rather than holding it while the modal sits open.
    setPassword("");
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) onClose();
          }}
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="hr-login-title"
            initial={{ opacity: 0, y: 26, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
          >
            <div className="modal-head">
              <span className="icon-tile violet">
                <LoginIcon />
              </span>
              <div>
                <h3 id="hr-login-title">Sign in to HR</h3>
                <p>
                  Your attendance comes from the HR API, which needs your work login. The password is
                  sent once and never stored in this browser.
                </p>
              </div>
              <button className="modal-x" onClick={onClose} aria-label="Close" disabled={busy}>
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <div className="modal-body">
                <label htmlFor="hr-email">Work email</label>
                <input
                  id="hr-email"
                  ref={firstField}
                  type="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />

                <label htmlFor="hr-password" style={{ marginTop: 14 }}>
                  Password
                </label>
                <div className="field">
                  <input
                    id="hr-password"
                    type={show ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="now"
                    onClick={() => setShow((v) => !v)}
                    disabled={busy}
                    aria-label={show ? "Hide password" : "Show password"}
                  >
                    {show ? "Hide" : "Show"}
                  </button>
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={error ?? (busy ? "busy" : "idle")}
                    className={`preview ${error ? "error" : busy ? "warn" : "idle"}`}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {error ?? (busy ? "Signing in…" : "Your HR account — the same login as the HR portal.")}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="modal-foot">
                <button className="btn" type="button" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <motion.button
                  className="btn primary"
                  type="submit"
                  whileHover={ready ? { scale: 1.015 } : {}}
                  whileTap={ready ? { scale: 0.975 } : {}}
                  disabled={!ready}
                >
                  {busy ? "Signing in…" : "Sign in"}
                </motion.button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
