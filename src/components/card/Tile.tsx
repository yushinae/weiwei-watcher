import React from 'react';
import { cn } from '../../lib/utils';

// Inner data block used inside cards. Solid surface-2 (#242424), 8px radius, no
// border — relies on pure color difference per the design system. Hover gives a
// subtle 1px lift + brightness (see `.dash-tile` in index.css). Padding/layout
// are left to the caller via className; the default `bg-surface-2` can be
// overridden (twMerge keeps the last bg-* class) for accent tiles.
export function Tile({
  className,
  interactive = false,
  children,
  ...rest
}: {
  className?: string;
  interactive?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('dash-tile rounded-lg bg-surface-2', interactive && 'is-interactive', className)}
      {...rest}
    >
      {children}
    </div>
  );
}
