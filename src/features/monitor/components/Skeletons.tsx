import React from 'react';
import { WidgetCardSkeleton } from '../../../components/card/WidgetCardSkeleton';

export function CardSkeleton({
  title,
  className,
}: {
  title?: string;
  className?: string;
}) {
  // 保持旧导出名，内部统一复用共享 skeleton（避免体系分叉）
  return <WidgetCardSkeleton className={className} headerDensity="compact" />;
}
