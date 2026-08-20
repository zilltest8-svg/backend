import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { DotsIcon, PlusIcon } from "./Icons";
import { SheetButton } from "./SheetButton";
import type { Sheet as SheetState } from "../useSheet";
import type { Block, DayResult } from "../types";
import { clockTime, hm, hms } from "../time";

interface Row extends Block {
  /** "Session 2" / "Break 1" */
  caption: string;
}

function numbered(blocks: Block[]): Row[] {
  let work = 0;
  let brk = 0;
  return blocks.map((b) => {
    if (b.kind === "work") {
      work += 1;
      return { ...b, caption: `Session ${work}` };
    }
    brk += 1;
    return { ...b, caption: `Break ${brk}` };
  });
}

interface Props {
  day: DayResult;
  onDelete: (id: string) => void;
  onAdd: () => void;
  sheet: SheetState;
}

export function SessionTable({ day, onDelete, onAdd, sheet }: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const live = !day.stale;
  const rows = numbered(day.blocks);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="card-head" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Sessions &amp; Breaks</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="btn ghost sm" onClick={onAdd}>
            <PlusIcon width={14} height={14} />
            Add Manual
          </button>
          <SheetButton sheet={sheet} text="Save Day" />
        </div>
      </div>

      <div className="thead">
        <span>Type</span>
        <span>In / Start</span>
        <span>Out / End</span>
        <span className="right">Duration</span>
        <span />
      </div>

      <div className="rows">
        <AnimatePresence initial={false}>
          {rows.length === 0 && (
            <motion.div key="empty" className="empty-row" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              No sessions yet — start the timer, add one manually, or paste a response.
            </motion.div>
          )}

          {rows.map((r, i) => (
            <motion.div
              className={`srow${r.kind === "break" ? " is-break" : ""}${r.live ? " is-live" : ""}`}
              key={`${r.kind}-${r.from}`}
              layout
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10, height: 0 }}
              transition={{ duration: 0.28, delay: Math.min(0.2, i * 0.04), ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="type">
                <i />
                <span>
                  <b>
                    {r.kind === "work" ? "Work" : "Break"}
                    {r.live && <span className="badge">LIVE</span>}
                  </b>
                  <small>{r.caption}</small>
                </span>
              </span>
              <span className="t">{clockTime(r.from)}</span>
              <span className="t">
                {r.live ? (
                  <motion.span
                    className="running"
                    animate={{ opacity: [1, 0.45, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  >
                    Running
                  </motion.span>
                ) : (
                  clockTime(r.to)
                )}
              </span>
              <span className="t right">{r.live && live ? hms(r.to - r.from) : hm(r.to - r.from)}</span>
              <span className="menu-cell">
                {r.sessionId && (
                  <button
                    className="dots"
                    aria-label="Row actions"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(menu === r.sessionId ? null : (r.sessionId as string));
                    }}
                  >
                    <DotsIcon width={15} height={15} />
                  </button>
                )}
                <AnimatePresence>
                  {menu === r.sessionId && (
                    <motion.button
                      className="menu"
                      initial={{ opacity: 0, scale: 0.9, y: -4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.16 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(r.sessionId as string);
                        setMenu(null);
                      }}
                    >
                      Remove session
                    </motion.button>
                  )}
                </AnimatePresence>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
