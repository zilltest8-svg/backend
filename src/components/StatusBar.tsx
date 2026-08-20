import { motion } from "framer-motion";
import { CheckIcon } from "./Icons";
import type { DayResult } from "../types";
import { verdict } from "../verdict";

export function StatusBar({ day, target }: { day: DayResult; target: number }) {
  const v = verdict(day, target);
  return (
    <motion.div
      className={`statusbar ${v.tone}`}
      key={v.text}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <CheckIcon width={16} height={16} />
      {v.text}
    </motion.div>
  );
}
