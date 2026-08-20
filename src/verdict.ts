import type { DayResult } from "./types";
import { MIN, clockShort, hm, human } from "./time";

export interface Verdict {
  text: string;
  tone: "ok" | "warn" | "muted";
}

/** One sentence on how the day is going — the line along the bottom of the dashboard. */
export function verdict(day: DayResult, target: number): Verdict {
  if (day.sessions.length === 0) {
    return { text: "Load today's punches to see how your day is going.", tone: "muted" };
  }
  if (day.stale) {
    return {
      text: `Showing a stored day — ${hm(day.worked)} worked, exit was ${clockShort(day.leave)}.`,
      tone: "muted",
    };
  }
  if (day.reached) {
    return {
      text: `Goal complete — you put in ${hm(day.worked)} of your ${hm(target * MIN)}. Free to go.`,
      tone: "ok",
    };
  }
  if (day.status === "break") {
    return {
      text: `On a break — every minute away pushes your exit, now ${clockShort(day.leave)}.`,
      tone: "warn",
    };
  }
  if (day.status === "out") {
    return {
      text: `Punched out with ${hm(Math.max(0, day.remaining))} still owed — exit was ${clockShort(day.leave)}.`,
      tone: "warn",
    };
  }
  return {
    text: `On track — ${human(day.span - day.elapsed)} to go, leaving at ${clockShort(day.leave)}.`,
    tone: "ok",
  };
}
