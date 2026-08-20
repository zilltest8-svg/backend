import { motion } from "framer-motion";
import { DatabaseIcon, DriveIcon, PlusIcon } from "./Icons";
import { SHEET_HEADERS } from "../export";
import type { DayEntry } from "../history";
import type { Filter } from "../types";
import { dateLabel, weekday } from "../time";
import { execEndpoint, urlProblem, type Sheet } from "../useSheet";

const press = { whileHover: { scale: 1.015 }, whileTap: { scale: 0.975 } };

interface Props {
  sheet: Sheet;
  /** Every stored day, so any of them can be the one exported. */
  days: DayEntry[];
  filter: Filter;
  /** The day the export will contain — the same day the rest of the app is showing. */
  selected: DayEntry | null;
  onFilter: (patch: Partial<Filter>) => void;
  /** Opens the manual-entry dialog, for filling a day in before saving it. */
  onAdd: () => void;
}

/** Export options that don't need any setup, plus the saved endpoint. */
export function SheetPanel({ sheet, days, filter, selected, onFilter, onAdd }: Props) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
      <h2 className="with-icon">
        <span className="icon-tile green sm">
          <DriveIcon width={16} height={16} />
        </span>
        Save & export
      </h2>

      <div className="card-head" style={{ marginBottom: 8 }}>
        <label htmlFor="export-day" style={{ marginBottom: 0 }}>
          Day to save
        </label>
        <button className="btn ghost sm" onClick={onAdd}>
          <PlusIcon width={14} height={14} />
          Add session
        </button>
      </div>
      <select
        id="export-day"
        className="select"
        value={filter.day}
        onChange={(e) => onFilter({ month: "all", day: e.target.value })}
      >
        <option value="latest">Latest stored day</option>
        {days.map((d) => (
          <option key={d.key} value={d.key}>
            {weekday(d.at).slice(0, 3)} {dateLabel(d.at)}
          </option>
        ))}
      </select>

      <div className={`preview ${sheet.empty ? "idle" : "ok"}`}>
        {sheet.empty ? (
          "Nothing stored for that day yet — add punches and they'll be ready to export."
        ) : (
          <>
            <b>{selected ? dateLabel(selected.at) : "This day"}</b>
            <span>
              {sheet.rowCount} {sheet.rowCount === 1 ? "row" : "rows"} · {SHEET_HEADERS.length} columns
            </span>
            <span className="tail">
              {sheet.configured ? "Drive connected" : "not connected — Download CSV still works"}
            </span>
          </>
        )}
      </div>

      <div className="btn-row two" style={{ marginTop: 12 }}>
        <motion.button
          className="btn primary"
          {...press}
          disabled={sheet.empty || sheet.sending}
          onClick={() => void sheet.saveToDrive()}
        >
          <DriveIcon width={15} height={15} />
          {sheet.sending ? "Saving…" : "Add to Drive"}
        </motion.button>
        <motion.button className="btn" {...press} disabled={sheet.empty} onClick={sheet.downloadCsv}>
          Download CSV
        </motion.button>
      </div>

      {sheet.lastSaved && (
        <motion.a
          className="saved-file"
          href={sheet.lastSaved.url || sheet.lastSaved.folderUrl}
          target="_blank"
          rel="noreferrer"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          whileHover={{ x: 2 }}
        >
          <DriveIcon width={15} height={15} />
          <span>
            <b>{sheet.lastSaved.name}</b>
            <small>in {sheet.lastSaved.folder} — open in Drive</small>
          </span>
          <span className="go">↗</span>
        </motion.a>
      )}

      <div className="divider">
        <span>Connected account</span>
      </div>

      <label htmlFor="sheet-url-panel">Apps Script web app URL</label>
      <input
        id="sheet-url-panel"
        type="url"
        spellCheck={false}
        placeholder="https://script.google.com/macros/s/.../exec"
        value={sheet.url}
        onChange={(e) => sheet.setUrl(e.target.value)}
      />

      {sheet.url.trim() && (
        <div className={`preview ${sheet.configured ? "ok" : "error"}`}>
          {sheet.configured ? "Connected — Add to Drive saves straight into your Drive." : urlProblem(sheet.url)}
        </div>
      )}

      <div className="link-row">
        {sheet.configured && (
          <>
            <button className="link-btn" disabled={sheet.sending} onClick={() => void sheet.testConnection()}>
              {sheet.sending ? "Testing…" : "Test connection"}
            </button>
            <a className="link-btn" href={execEndpoint(sheet.url)} target="_blank" rel="noreferrer">
              Open /exec ↗
            </a>
          </>
        )}
        <button className="link-btn" onClick={sheet.openSetup}>
          {sheet.configured ? "Reconnect to Drive" : "Connect to Drive"}
        </button>
      </div>

      <p className="hint">
        <DatabaseIcon width={13} height={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
        One day per save, named <b>office-time-DD-MM-YYYY.csv</b>, in an <b>Office Time</b> folder;
        re-saving replaces that date rather than adding it twice. Picking a day here is the same
        choice as the History filter, so the dashboard follows it. Columns: {SHEET_HEADERS.join(" · ")}
      </p>
    </motion.div>
  );
}
