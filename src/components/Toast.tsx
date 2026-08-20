import { AnimatePresence, motion } from "framer-motion";

export interface ToastAction {
  label: string;
  href: string;
}

export interface ToastMsg {
  id: number;
  text: string;
  ok: boolean;
  action?: ToastAction;
}

export function Toast({ toast }: { toast: ToastMsg | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className={`toast ${toast.ok ? "ok" : "err"}`}
          initial={{ opacity: 0, y: 26, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        >
          <span>{toast.ok ? "✓" : "!"}</span>
          {toast.text}
          {toast.action && (
            <a className="toast-action" href={toast.action.href} target="_blank" rel="noreferrer">
              {toast.action.label} ↗
            </a>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
