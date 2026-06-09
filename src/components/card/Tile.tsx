import React from 'react';
import { cn } from '../../lib/utils';

// Inner data block used inside cards. Bybit-style L3 surface with a faint 1px
// inset line; padding/layout are left to the caller via className.
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
