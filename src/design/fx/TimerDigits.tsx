import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { durations, easings } from "../motion";
import "./feedback.css";

/** Fixed digit slots prevent the readout from shifting while a minute is added. */
export function TimerDigits({ text }: { text: string }) {
  const reduce = useReducedMotion();
  return <span className="ig-timer-digits" aria-label={text}>
    {[...text].map((digit, index) => <span className="ig-timer-digit" key={text.length - index} aria-hidden="true">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span key={digit} className="ig-timer-digit-ink"
          initial={{ opacity: 0, y: reduce ? 0 : "100%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : "-100%" }}
          transition={{ duration: durations.slow, ease: easings.out }}>{digit}</motion.span>
      </AnimatePresence>
    </span>)}
  </span>;
}
