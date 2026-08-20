import { useId } from "react";

interface Props {
  size?: number;
  /** True while a session is running — the tip pulses, as the timer ring does. */
  live?: boolean;
}

/**
 * The mark: an open ring with the tip left bright, and a pair of hands inside.
 * It is the timer ring the dashboard draws in WebGL, reduced to something that
 * still reads at 20px — the gap and the tip are what make it a clock rather
 * than a circle, so both survive the shrink.
 */
export function Logo({ size = 26, live = false }: Props) {
  // Two of these can be on screen at once, so the gradient id has to be unique.
  // useId puts colons in it, which some browsers refuse inside url(#…).
  const arc = `arc-${useId().replace(/:/g, "")}`;

  return (
    <svg
      className={`logo${live ? " live" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Chronos"
    >
      <defs>
        <linearGradient id={arc} x1="6" y1="2" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#aab6f5" />
          <stop offset="0.55" stopColor="#34d399" />
          <stop offset="1" stopColor="#22a37a" />
        </linearGradient>
      </defs>

      {/* The ring, opened at the top so the tip reads as "now". */}
      <path
        d="M16 4.5a11.5 11.5 0 1 1-8.13 3.37"
        stroke={`url(#${arc})`}
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle className="logo-tip" cx="16" cy="4.5" r="2.9" fill="#aab6f5" />
      <path d="M16 16.5V11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 16.5l4.1 2.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}
