import { SearchIcon } from "./Icons";
import { dateLabel, weekday } from "../time";

interface Props {
  query: string;
  onQuery: (value: string) => void;
  /** The day currently on screen, shown on the right of the bar. */
  viewing: number | null;
  stale: boolean;
}

export function TopBar({ query, onQuery, viewing, stale }: Props) {
  return (
    <div className="topbar">
      <div className="search">
        <SearchIcon width={16} height={16} />
        <input
          type="search"
          value={query}
          placeholder="Search stored days — 18 aug, august, 2026-08…"
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {viewing != null && (
        <div className="day-chip">
          {stale ? "Stored day" : "Today"}
          <b>
            {weekday(viewing).slice(0, 3)} {dateLabel(viewing)}
          </b>
        </div>
      )}
    </div>
  );
}
