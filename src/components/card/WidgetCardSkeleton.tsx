import React from 'react';
import { cn } from '../../lib/utils';

export function WidgetCardSkeleton({
  className,
  headerDensity = 'default',
}: {
  className?: string;
  headerDensity?: 'default' | 'compact';
}) {
  const headerH = headerDensity === 'compact' ? 36 : 32;
  return (
    <div className={cn('widget-card relative overflow-hidden rounded-[10px]', className)}>
      <div className="absolute left-0 top-0 z-10 flex w-full items-center justify-between px-3" style={{ height: headerH }}>
        <div className="h-3 w-24 rounded bg-surface-2/70" />
        <div className="flex gap-2">
          <div className="h-7 w-7 rounded-[8px] bg-surface-2/60" />
          <div className="h-7 w-7 rounded-[8px] bg-surface-2/60" />
        </div>
      </div>

      <div className="h-full w-full" style={{ paddingTop: headerH }}>
        <div className="relative h-full w-full bg-bg-card">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/6 to-transparent animate-shimmer" />
          <div className="p-4 flex flex-col gap-3">
            <div className="h-3 w-1/3 rounded bg-surface-2/60" />
            <div className="h-10 w-full rounded bg-surface-2/40" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-10 rounded bg-surface-2/40" />
              <div className="h-10 rounded bg-surface-2/40" />
              <div className="h-10 rounded bg-surface-2/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

