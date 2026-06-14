import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';

// Generic titled card used throughout the position builder layout.
export function Panel({ title, subtitle, actions, noPadding, noScroll, children }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  noPadding?: boolean;
  noScroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="widget-card !p-0 w-full flex flex-col rounded-xl overflow-hidden"
    >
      <div className="flex items-center px-3 py-2 border-b border-white/[0.06] shrink-0">
        <span className="text-[13px] font-semibold text-white/65 shrink-0">{title}</span>
        {subtitle && <div className="ml-3 min-w-0 flex-1 text-[11px] text-white/65">{subtitle}</div>}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      <div className={cn(
        'min-h-0',
        noScroll ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden',
        !noPadding && 'p-3',
      )}>
        {children}
      </div>
    </motion.div>
  );
}
