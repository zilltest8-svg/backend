import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { CodeIcon } from "./Icons";
import { parsePayload } from "../compute";
import { clockTime } from "../time";

interface Props {
  onLoad: (text: string) => void;
  onClear: () => void;
  /** Rendered when the box is empty, so the panel always shows the day's shape. */
  sample: string;
}

type Preview =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "ok"; count: number; from: string; to: string; target?: number; replaces: boolean };

/** Parse as the user types so they see what will land before committing. */
function preview(text: string): Preview {
  if (!text.trim()) return { kind: "idle" };
  try {
    const p = parsePayload(text);
    if (p.added === 0) return { kind: "error", message: "No readable punch times in that response." };
    const first = p.sessions[0];
    const last = p.sessions[p.sessions.length - 1];
    return {
      kind: "ok",
      count: p.added,
      from: clockTime(first?.in ?? null),
      to: last?.out == null ? "running" : clockTime(last.out),
      ...(p.target != null ? { target: p.target } : {}),
      replaces: p.full,
    };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

/**
 * The raw punch payload. Reads as a code panel, but it is the input: paste an
 * API response over it and the day re-derives from exactly what was pasted.
 */
export function Telemetry({ onLoad, onClear, sample }: Props) {
  const [text, setText] = useState("");
  const state = useMemo(() => preview(text), [text]);
  const canLoad = state.kind === "ok";

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="card-head">
        <span className="card-title">Raw Telemetry</span>
        <span style={{ color: "var(--muted)", display: "flex" }}>
          <CodeIcon width={16} height={16} />
        </span>
      </div>

      <div className="tele-code">
        <textarea
          aria-label="Punch API response"
          spellCheck={false}
          value={text}
          placeholder={sample}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canLoad) onLoad(text);
          }}
        />
        <AnimatePresence>
          {text.trim() && (
            <motion.button
              className="tele-clear"
              type="button"
              title="Clear the box"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={() => setText("")}
            >
              ×
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {state.kind !== "idle" && (
          <motion.div
            key={state.kind === "ok" ? `ok-${state.count}-${state.from}-${state.to}` : state.message}
            className={`preview ${state.kind}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {state.kind === "ok" ? (
              <>
                <b>
                  {state.count} session{state.count === 1 ? "" : "s"}
                </b>
                <span>
                  {state.from} → {state.to}
                </span>
                {state.target != null && <span>goal {state.target} min</span>}
                <span className="tail">{state.replaces ? "replaces that day" : "merges in"}</span>
              </>
            ) : (
              state.message
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="btn-row">
        <motion.button
          className="btn primary"
          whileHover={canLoad ? { scale: 1.015 } : {}}
          whileTap={canLoad ? { scale: 0.975 } : {}}
          disabled={!canLoad}
          onClick={() => onLoad(text)}
        >
          Load JSON
        </motion.button>
        <button className="btn" title="Remove the day on screen — the rest of the history stays" onClick={onClear}>
          Clear day
        </button>
      </div>
    </motion.div>
  );
}
