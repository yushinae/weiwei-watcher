import React, { useRef, useCallback, useState, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';

interface ElasticLayoutProps {
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  overflowX?: 'hidden' | 'auto';
  /** When provided, scroll-position detection uses this ref instead of the inner scroll div */
  detectionRef?: React.RefObject<HTMLDivElement>;
  /** Resting gap height in px at top and bottom (default 6) */
  restGap?: number;
  /** Background color for the top/bottom gaps (default transparent) */
  gapColor?: string;
}

// Resting divider height (always visible, creates the 3-layer colour split)
const REST_GAP = 6;
// Max additional stretch on top of REST_GAP — kept short so the elastic feel stays subtle
const MAX_EXTRA = 20;

const SPRING = { type: 'spring' as const, stiffness: 420, damping: 28, mass: 0.7 };

export const ElasticLayout = React.forwardRef<HTMLDivElement, ElasticLayoutProps>(
  ({ header, children, className = '', overflowX = 'hidden', detectionRef, restGap = REST_GAP, gapColor = 'transparent' }, forwardedRef) => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const internalRef = useRef<HTMLDivElement>(null);

  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (typeof forwardedRef === 'function') {
      forwardedRef(el);
    } else if (forwardedRef) {
      (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }
  }, [forwardedRef]);

  // extra pixels of stretch beyond the resting gap (0 at rest)
  const extra = useMotionValue(0);

  // gap height = restGap + extra (clamped ≥ 0)
  const gapHeight = useTransform(extra, (v) => restGap + Math.max(0, v));

  const springBack = useCallback(() => {
    animate(extra, 0, SPRING);
  }, [extra]);

  // ── Pointer (mouse / touch) drag ──
  const pointerStartY = useRef(0);
  const isDragging = useRef(false);
  const atTopOnStart = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = detectionRef?.current ?? internalRef.current;
    if (!el) return;
    atTopOnStart.current = el.scrollTop === 0;
    pointerStartY.current = e.clientY;
    isDragging.current = true;
  }, [detectionRef]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    const el = detectionRef?.current ?? internalRef.current;
    if (!el) return;
    if (!atTopOnStart.current || el.scrollTop > 0) {
      atTopOnStart.current = false;
      return;
    }
    const delta = e.clientY - pointerStartY.current;
    if (delta <= 0) return;
    // Rubber-band: resistance grows with stretch
    const damped = MAX_EXTRA * (1 - Math.exp(-delta / 140));
    extra.set(damped);
  }, [extra, detectionRef]);

  const handlePointerUp = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    atTopOnStart.current = false;
    springBack();
  }, [springBack]);

  // ── Trackpad / wheel overscroll ──
  const accumulated = useRef(0);
  const overscrolling = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = detectionRef?.current ?? internalRef.current;
    if (!el) return;

    if (el.scrollTop > 0) {
      accumulated.current = 0;
      overscrolling.current = false;
      return;
    }

    if (e.deltaY < 0) {
      overscrolling.current = true;
      accumulated.current += Math.abs(e.deltaY);
      const damped = MAX_EXTRA * (1 - Math.exp(-accumulated.current / 180));
      extra.set(damped);

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        overscrolling.current = false;
        accumulated.current = 0;
        springBack();
      }, 70);
    } else if (overscrolling.current) {
      overscrolling.current = false;
      accumulated.current = 0;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      springBack();
    }
  }, [extra, springBack, detectionRef]);

  if (reducedMotion) {
    return (
      <div className={`flex flex-col w-full h-full overflow-hidden select-none ${className}`}>
        {header && <div className="shrink-0 relative z-[120]">{header}</div>}
        <div ref={setScrollRef} className="flex-1 min-h-0 overflow-y-auto" style={{ overflowX }}>
          {children}
        </div>
        <div style={{ height: restGap, backgroundColor: gapColor }} className="shrink-0 w-full" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col w-full h-full overflow-hidden select-none ${className}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      <motion.div
        style={{ height: gapHeight, backgroundColor: gapColor }}
        className="shrink-0 w-full"
        aria-hidden
      />

      {/* Header */}
      {header && (
        <div className="shrink-0 relative z-[120]">
          {header}
        </div>
      )}

      {/* Scrollable content */}
      <div
        ref={setScrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ overflowX }}
      >
        {children}
      </div>

      <div
        style={{ height: restGap, backgroundColor: gapColor }}
        className="shrink-0 w-full"
        aria-hidden
      />
    </div>
  );
});

ElasticLayout.displayName = 'ElasticLayout';

export default ElasticLayout;
