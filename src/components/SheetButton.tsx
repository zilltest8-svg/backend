import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { CheckIcon, DriveIcon, SaveIcon, SheetIcon } from "./Icons";
import type { Sheet } from "../useSheet";

type Target = "drive" | "sheet";

const LABEL: Record<Target, { idle: string; done: string; className: string }> = {
  drive: { idle: "Add to Drive", done: "Saved to Drive", className: "drive-btn" },
  sheet: { idle: "Add to spreadsheet", done: "Added", className: "sheet-btn" },
};

/**
 * Saves the day to Drive (or the sheet). If nothing is connected yet it opens
 * the shared setup dialog instead of failing, so the button is never a dead end.
 */
export function SheetButton({
  sheet,
  target = "drive",
  text,
}: {
  sheet: Sheet;
  target?: Target;
  /** Overrides the idle label — the table header calls it "Save Day". */
  text?: string;
}) {
  const [done, setDone] = useState(false);
  const label = LABEL[target];

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 2000);
    return () => window.clearTimeout(t);
  }, [done]);

  const click = async () => {
    if (!sheet.configured) return sheet.openSetup();
    const ok = target === "drive" ? await sheet.saveToDrive() : await sheet.send();
    if (ok) setDone(true);
  };

  return (
    <motion.button
      className={`btn sm ${label.className}${done ? " done" : ""}`}
      whileHover={sheet.empty ? {} : { scale: 1.03 }}
      whileTap={sheet.empty ? {} : { scale: 0.96 }}
      disabled={sheet.empty || sheet.sending}
      onClick={click}
      title={
        sheet.configured
          ? target === "drive"
            ? "Save today as a CSV in your Drive"
            : "Append today's rows to your spreadsheet"
          : "Connect Google Drive"
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={done ? "done" : sheet.sending ? "sending" : "idle"}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
        >
          {done ? (
            <>
              <CheckIcon width={15} height={15} />
              {label.done}
            </>
          ) : sheet.sending ? (
            "Saving…"
          ) : (
            <>
              {text ? (
                <SaveIcon width={14} height={14} />
              ) : target === "drive" ? (
                <DriveIcon width={15} height={15} />
              ) : (
                <SheetIcon width={15} height={15} />
              )}
              {text ?? label.idle}
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
