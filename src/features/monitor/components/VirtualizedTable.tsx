import React, { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../lib/utils';

/**
 * 轻量行虚拟化（用于监控页内可能增长的列表/表格）。
 * - 只负责 “row virtualization + sticky header（可选）” 的基础骨架
 * - 列对齐/复杂表格结构交给 renderRow（保持可控，不引入额外表格库）
 */
export function VirtualizedTable<T>({
  rows,
  rowHeight,
  overscan = 10,
  className,
  renderRow,
}: {
  rows: T[];
  rowHeight: number;
  overscan?: number;
  className?: string;
  renderRow: (row: T, idx: number) => React.ReactNode;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const items = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = items.length ? items[0]!.start : 0;
  const paddingBottom = items.length ? totalSize - items[items.length - 1]!.end : 0;

  const visible = useMemo(() => items.map(v => ({ ...v, row: rows[v.index]! })), [items, rows]);

  return (
    <div ref={parentRef} className={cn('h-full overflow-auto', className)}>
      <div style={{ height: paddingTop }} />
      {visible.map(v => (
        <div key={v.key} style={{ height: v.size }}>
          {renderRow(v.row, v.index)}
        </div>
      ))}
      <div style={{ height: paddingBottom }} />
    </div>
  );
}

