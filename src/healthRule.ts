/**
 * The health break rule the HR system enforces, read off the day the
 * calculator already produced:
 *
 *   - A break counts only if it is 15 minutes or longer. A shorter gap does
 *     not reset the continuous-work timer.
 *   - Reminders at 2h, 3h and 4h of continuous work; at 4h 15m the system
 *     punches you out, and 30 minutes of rest are owed before returning.
 *   - One hour of counted break is required per eight hours of work target.
 *
 * This module only observes. It never changes a punch or the exit time —
 * what it says is why the HR system did, or is about to do, what it does.
 */
import { MIN, clockShort, human } from "./time";
import type { DayResult, Settings } from "./types";

export const HEALTH = {
  /** A gap shorter than this is not a break: it does not reset the timer and does not count. */
  minBreak: 15 * MIN,
  /** Continuous work at which the three reminders fire. */
  remindAt: [120 * MIN, 180 * MIN, 240 * MIN],
  /** Continuous work at which the HR system punches you out. */
  autoOut: 255 * MIN,
  /** Rest owed after an automatic punch-out. */
  restAfterAutoOut: 30 * MIN,
} as const;

/** 0 none · 1 the 2h nudge · 2 the 3h reminder · 3 the 4h warning · 4 auto punch-out */
export type HealthStage = 0 | 1 | 2 | 3 | 4;
export type HealthTone = "info" | "warn" | "strong" | "stop";

export interface HealthAlert {
  stage: HealthStage;
  tone: HealthTone;
  title: string;
  /** What to do, in the policy's own voice. */
  message: string;
  /** Why it fired: the stretch, when it began, what did and did not count, what comes next. */
  why: string;
}

export interface Health {
  /** The unbroken stretch so far: runs while you work and through any gap under 15 min. 0 after a real break. */
  streak: number;
  streakStart: number | null;
  working: boolean;
  /** Away right now, but for less than 15 minutes, so the stretch is still alive. */
  shortBreak: boolean;
  /** Gaps under 15 minutes inside the current stretch — they did not reset it. */
  ignored: number;
  /** The longest stretch of the day, the one the system tracks. */
  longest: number;
  /** Break time that counts: gaps of 15 minutes or more, the live one included once it qualifies. */
  counted: number;
  /** Counted break the policy asks for today. */
  required: number;
  stage: HealthStage;
  /** When the next reminder lands if the stretch goes on; null when none is open or none is left. */
  nextAt: number | null;
  /** The last stretch reached the auto punch-out length and has ended — the system punched you out. */
  autoOut: boolean;
  /** Rest still owed after that punch-out, 0 otherwise. */
  restLeft: number;
  /** When that punch-out happened, or null. */
  autoOutAt: number | null;
  alert: HealthAlert | null;
}

const stageOf = (streak: number): HealthStage => {
  if (streak >= HEALTH.autoOut) return 4;
  if (streak >= HEALTH.remindAt[2]) return 3;
  if (streak >= HEALTH.remindAt[1]) return 2;
  if (streak >= HEALTH.remindAt[0]) return 1;
  return 0;
};

const TONES: Record<HealthStage, HealthTone> = { 0: "info", 1: "info", 2: "warn", 3: "strong", 4: "stop" };

const TITLES: Record<HealthStage, string> = {
  0: "",
  1: "2 hours of continuous work",
  2: "3 hours without a break",
  3: "4 hours without a break",
  4: "Auto punch-out",
};

const ADVICE: Record<HealthStage, string> = {
  0: "",
  1: "Time for a short break. Get up, stretch, move around and step away for at least 15 minutes — a shorter break does not count.",
  2: "Please step away and recharge. A break of 15 minutes or more resets your continuous-work timer.",
  3: "Stop, move around and give your body the rest it needs. At 4h 15m the system punches you out automatically.",
  4: "You've reached 4h 15m of continuous work — the system punches you out at this point. Please take at least 30 minutes before returning.",
};

/** The message the HR system sends with an automatic punch-out, word for word. */
export const AUTO_OUT_MESSAGE =
  "You've been auto punched out. Please take at least 30 min before returning. " +
  "For your health, 1 hr total break is required per 8 net work hrs for your optimum health. " +
  "Each break must be 15+ min to count. You can work 4 hrs, take 1 hr, then work 4 hrs, " +
  "or split the 1 hr into 15+ min breaks.";

export function assessHealth(day: DayResult, settings: Settings): Health {
  const now = day.now;
  const required = Math.round((settings.target / 8) * MIN);

  let stretchStart: number | null = null;
  let stretchEnd = 0;
  let ignored = 0;
  let longest = 0;
  let counted = 0;
  // The stretch that most recently ended, and when — what an auto punch-out is judged on.
  let lastLen = 0;
  let lastStart = 0;
  let lastEnd = 0;

  const close = (end: number) => {
    if (stretchStart == null) return;
    lastLen = end - stretchStart;
    lastStart = stretchStart;
    lastEnd = end;
    longest = Math.max(longest, lastLen);
    stretchStart = null;
    ignored = 0;
  };

  for (const b of day.blocks) {
    if (b.kind === "work") {
      if (stretchStart == null) stretchStart = b.from;
      stretchEnd = b.to;
      continue;
    }
    const gap = b.to - b.from;
    if (gap >= HEALTH.minBreak) {
      counted += gap;
      close(b.from);
    } else if (stretchStart != null) {
      ignored += 1;
    }
  }

  const working = day.status === "working";
  let shortBreak = false;
  let streak = 0;

  if (stretchStart != null) {
    if (working) {
      streak = now - stretchStart;
    } else if (day.status === "break" && stretchEnd - stretchStart < HEALTH.autoOut) {
      // Punched out for less than 15 minutes: the stretch is still alive.
      shortBreak = true;
      streak = now - stretchStart;
    } else {
      // The day is over, or the stretch hit the limit and the system ended it.
      close(stretchEnd);
    }
  }

  // Only a live day owes rest: a stored day's punch-out is just a fact about it.
  const autoOut = !working && !shortBreak && lastLen >= HEALTH.autoOut;
  const restLeft =
    autoOut && !day.stale && day.status === "break"
      ? Math.max(0, HEALTH.restAfterAutoOut - (now - lastEnd))
      : 0;

  let stage: HealthStage = stretchStart != null ? stageOf(streak) : 0;
  if (autoOut && restLeft > 0) stage = 4;

  let nextAt: number | null = null;
  if (stretchStart != null) {
    const next = [...HEALTH.remindAt, HEALTH.autoOut].find((t) => t > streak);
    nextAt = next == null ? null : stretchStart + next;
  }

  let alert: HealthAlert | null = null;
  if (!day.stale && stage > 0) {
    if (autoOut) {
      const rest =
        restLeft > 0
          ? `Rest ${human(restLeft)} more before punching back in (until ${clockShort(lastEnd + HEALTH.restAfterAutoOut)}).`
          : "Your 30-minute rest is complete — you can punch back in.";
      alert = {
        stage,
        tone: "stop",
        title: "You've been auto punched out",
        message: AUTO_OUT_MESSAGE,
        why: `Why: your last stretch ran ${human(lastLen)}, from ${clockShort(lastStart)} to ${clockShort(lastEnd)}, past the 4h 15m limit. ${rest}`,
      };
    } else {
      const start = stretchStart as number;
      const parts = [
        `Why: you have worked ${human(streak)} without a break of 15 minutes or more, since ${clockShort(start)}.`,
      ];
      if (ignored > 0) {
        parts.push(`${ignored} short gap${ignored === 1 ? "" : "s"} under 15 min did not reset the timer.`);
      }
      if (stage === 3) parts.push(`Auto punch-out at ${clockShort(start + HEALTH.autoOut)}.`);
      else if (nextAt != null) parts.push(`Next reminder at ${clockShort(nextAt)}.`);

      let message = ADVICE[stage];
      if (shortBreak) {
        const away = now - stretchEnd;
        message = `You're on a break of ${human(away)} so far. Breaks under 15 minutes do not reset the timer — stay away ${human(HEALTH.minBreak - away)} more for it to count.`;
      }
      alert = { stage, tone: TONES[stage], title: TITLES[stage], message, why: parts.join(" ") };
    }
  }

  return {
    streak,
    streakStart: stretchStart,
    working,
    shortBreak,
    ignored,
    longest: Math.max(longest, streak),
    counted,
    required,
    stage,
    nextAt,
    autoOut,
    restLeft,
    autoOutAt: autoOut ? lastEnd : null,
    alert,
  };
}
