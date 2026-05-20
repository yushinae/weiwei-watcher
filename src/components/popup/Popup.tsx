import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../../lib/utils';
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

// FloatingCard — exported building block for advanced layouts (e.g., flyout menus)
export function FloatingCard({
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
    <PopupCard
      zIndex={zIndex}
      className={className}
      style={style}
      initial={initial}
      animate={animate}
      exit={exit}
      {...rest}
    >
      {children}
    </PopupCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Popover (dropdown) — anchored panel + transparent click-away backdrop
// ─────────────────────────────────────────────────────────────
export function Popover({
  open,
  onClose,
  backdropZ = 120,
  panelZ = 121,
  panelClassName,
  panelStyle,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  open: boolean;
  onClose: () => void;
  backdropZ?: number;
  panelZ?: number;
  panelClassName?: string;
  panelStyle?: React.CSSProperties;
  children: React.ReactNode;
  onMouseEnter?: React.MouseEventHandler;
  onMouseLeave?: React.MouseEventHandler;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <Backdrop open={open} onClose={onClose} zIndex={backdropZ} tone="transparent" />
      <AnimatePresence>
        {open && (
          <PopupCard zIndex={panelZ} className={panelClassName} style={panelStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
            {children}
          </PopupCard>
        )}
      </AnimatePresence>
    </>
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
// Modal — centered + dim backdrop
// ─────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  zIndex = 100,
  children,
  className,
  style,
}: {
  open: boolean;
  onClose: () => void;
  zIndex?: number;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 flex items-center justify-center" style={{ zIndex }}>
          <Backdrop
            open={open} onClose={onClose} zIndex={zIndex} tone="dim" blur
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <PopupCard
            zIndex={zIndex + 1}
            className={cn('relative', className)}
            style={style}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            {children}
          </PopupCard>
        </div>
      )}
    </AnimatePresence>,
    document.body,
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

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
