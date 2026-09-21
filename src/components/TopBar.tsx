import { dateLabel, weekday } from "../time";

interface Props {
  /** The day currently on screen, shown on the right of the bar. */
  viewing: number | null;
  stale: boolean;
}

/** Just the day on screen, at the right-hand end. */
export function TopBar({ viewing, stale }: Props) {
  return (
    <div className="topbar">
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
