import React from 'react';
import { cn } from '../../lib/utils';

export function WidgetCardSkeleton({
  className,
  tone = 'blue',
}: {
  className?: string;
  tone?: 'blue' | 'red' | 'accent';
}) {
  const shellClass = cn(
    'card-shell',
    tone === 'blue' && 'shell-blue',
    tone === 'red' && 'shell-red',
    tone === 'accent' && 'shell-accent',
  );

  return (
    <div className={cn('relative overflow-hidden rounded-[16px]', shellClass, className)}>
      <div className="card-inner">
        <div className="card-head">
          <div className="card-head-left">
            <div className="card-logo lg-btc">
              <div className="h-3 w-3 rounded bg-surface-2/70" />
            </div>
            <div className="card-name-group">
              <div className="h-3 w-20 rounded bg-surface-2/70" />
              <div className="h-2 w-14 rounded bg-surface-2/50 mt-1" />
            </div>
          </div>
          <div className="card-head-actions">
            <div className="btn h-5 w-5 rounded bg-surface-2/60" />
            <div className="btn h-5 w-5 rounded bg-surface-2/60" />
          </div>
        </div>

        <div className="relative h-full w-full">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/6 to-transparent animate-shimmer" />
          <div className="flex flex-col gap-3">
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
