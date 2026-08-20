import { AnimatePresence, motion } from "framer-motion";

const roll = {
  initial: { y: "-90%", opacity: 0 },
  animate: { y: "0%", opacity: 1 },
  exit: { y: "90%", opacity: 0 },
};

function Place({ value, className }: { value: string; className: string }) {
  return (
    <span className={`place ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          {...roll}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: "inline-block" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

interface Props {
  hours: string;
  minutes: string;
  seconds: string;
  done: boolean;
}

/** `07:46:12` — hours and minutes large, seconds smaller and accented. */
export function Counter({ hours, minutes, seconds, done }: Props) {
  return (
    <div className={`counter${done ? " done" : ""}`}>
      <Place value={hours} className="lg" />
      <span className="colon">:</span>
      <Place value={minutes} className="lg" />
      <span className="colon sm">:</span>
      <Place value={seconds} className="sm" />
    </div>
  );
}
