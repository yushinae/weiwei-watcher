import React from 'react';
import { cn } from '../../lib/utils';

export function WidgetCardSkeleton({
  className,
}: {
  className?: string;
  tone?: 'blue' | 'red' | 'accent';
}) {
  return (
    <div className={cn('widget-card h-full w-full', className)}>
      <div className="widget-head">
        <div className="widget-head-left">
          <div className="widget-icon ico-blue">
            <div className="h-2.5 w-2.5 rounded bg-white/8" />
          </div>
          <div className="min-w-0">
            <div className="h-2.5 w-16 rounded bg-white/8" />
            <div className="h-2 w-10 rounded bg-white/5 mt-1" />
          </div>
        </div>
      </div>

      <div className="relative h-full w-full min-h-[60px]">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/6 to-transparent animate-shimmer" />
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="h-2.5 w-1/3 rounded bg-white/6" />
          <div className="h-8 w-full rounded bg-white/4" />
          <div className="grid grid-cols-3 gap-2">
            <div className="h-8 rounded bg-white/4" />
            <div className="h-8 rounded bg-white/4" />
            <div className="h-8 rounded bg-white/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
