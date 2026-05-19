import React from 'react';
import { WidgetCardSkeleton } from '../../../components/card/WidgetCardSkeleton';

export function CardSkeleton({
  title,
  className,
}: {
  title?: string;
  className?: string;
}) {
  return <WidgetCardSkeleton className={className} />;
}
