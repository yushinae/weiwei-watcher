import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { useEscapeKey } from '../../lib/useEscapeKey';
import { DUR_POP, EASE_EMPHASIS } from '../../motion/tokens';
import './popup.css';

type BackdropTone = 'transparent' | 'dim';

function Backdrop({
  open,
  onClose,
  zIndex,
  tone,
  blur,
  initial,
  animate,
  exit,
}: {
  open: boolean;
  onClose: () => void;
  zIndex: number;
  tone: BackdropTone;
  blur?: boolean;
  initial?: any;
  animate?: any;
  exit?: any;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="popup-backdrop"
          style={{
            zIndex,
            background: tone === 'dim' ? 'var(--popup-backdrop-dim)' : 'transparent',
            backdropFilter: tone === 'dim' && blur ? 'blur(6px)' : undefined,
          }}
          initial={initial ?? { opacity: 0 }}
          animate={animate ?? { opacity: 1 }}
          exit={exit ?? { opacity: 0 }}
          transition={{ duration: DUR_POP, ease: EASE_EMPHASIS }}
          onClick={onClose}
        />
      )}
    </AnimatePresence>
  );
}

function PopupCard({
  children,
  className,
  style,
  zIndex,
  initial,
  animate,
  exit,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  zIndex: number;
  initial?: any;
  animate?: any;
  exit?: any;
} & Record<string, any>) {
  return (
    <motion.div
      className={cn('popup-card', className)}
      style={{ zIndex, ...style }}
      initial={initial ?? { opacity: 0, y: -6, scale: 0.98 }}
      animate={animate ?? { opacity: 1, y: 0, scale: 1 }}
      exit={exit ?? { opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: DUR_POP, ease: EASE_EMPHASIS }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// HoverPopover — anchored panel + NO backdrop (for hover tooltips/menus)
// ─────────────────────────────────────────────────────────────
export function HoverPopover({
  open,
  panelZ = 60,
  panelClassName,
  panelStyle,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  open: boolean;
  panelZ?: number;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  children: React.ReactNode;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
}) {
  return (
    <AnimatePresence>
      {open && (
        <PopupCard zIndex={panelZ} className={panelClassName} style={panelStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
          {children}
        </PopupCard>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────
// Drawer — slide-in side panel + dim backdrop
// ─────────────────────────────────────────────────────────────
export function Drawer({
  open,
  onClose,
  side = 'right',
  zIndex = 100,
  width = 420,
  children,
  className,
  style,
}: {
  open: boolean;
  onClose: () => void;
  side?: 'right' | 'left';
  zIndex?: number;
  width?: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fromX = side === 'right' ? 24 : -24;
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);
  useEscapeKey(open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0" style={{ zIndex }}>
          <Backdrop open={open} onClose={onClose} zIndex={zIndex} tone="dim" blur />
          <PopupCard
            zIndex={zIndex + 1}
            className={cn('fixed top-0 bottom-0', className)}
            style={{
              width,
              right: side === 'right' ? 0 : undefined,
              left: side === 'left' ? 0 : undefined,
              borderRadius: 0,
              ...style,
            }}
            initial={{ opacity: 0, x: fromX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: fromX }}
          >
            {children}
          </PopupCard>
        </div>
      )}
    </AnimatePresence>
  );
}
