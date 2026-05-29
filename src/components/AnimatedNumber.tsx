import React, { useEffect, useRef, useState } from 'react';
import { useMotionValue, animate } from 'motion/react';
import { EASE_EMPHASIS } from '../motion/tokens';

interface Props {
  /** Target value. Counts up from 0 on mount, tweens between values on change. */
  value: number;
  /** Format the (interpolating) value into display text. Default: rounded integer. */
  format?: (v: number) => string;
  /** Tween duration in seconds. */
  duration?: number;
  /** Flash a one-shot glow pulse when the value changes (after first mount). */
  pulseOnChange?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * A number that tweens to its target — from 0 on first mount (count-up), and
 * smoothly between values when `value` changes (e.g. data refresh / coin switch).
 * Respects `prefers-reduced-motion` by snapping instantly.
 */
export function AnimatedNumber({ value, format, duration = 0.6, pulseOnChange = false, className, style }: Props) {
  const fmt = format ?? ((v: number) => Math.round(v).toString());
  const fmtRef = useRef(fmt);
  fmtRef.current = fmt;

  const mv = useMotionValue(0);
  const [text, setText] = useState(() => fmt(0));
  // Bumped on every value change after the first mount; used as a remount key on
  // the inner span so the CSS pulse animation restarts each time.
  const [pulseKey, setPulseKey] = useState(0);
  const firstRef = useRef(true);

  useEffect(() => {
    if (pulseOnChange && !firstRef.current) setPulseKey(k => k + 1);
    firstRef.current = false;

    const unsub = mv.on('change', v => setText(fmtRef.current(v)));
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      mv.set(value);
      setText(fmtRef.current(value));
      return unsub;
    }
    const controls = animate(mv, value, { duration, ease: EASE_EMPHASIS });
    return () => { unsub(); controls.stop(); };
  }, [value, duration, mv, pulseOnChange]);

  if (pulseOnChange) {
    return (
      <span className={className} style={style}>
        <span key={pulseKey} className={pulseKey > 0 ? 'dash-pulse' : undefined}>{text}</span>
      </span>
    );
  }
  return <span className={className} style={style}>{text}</span>;
}

export default AnimatedNumber;
