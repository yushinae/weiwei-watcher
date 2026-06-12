// Thin wrapper around echarts-for-react with the app's dark widget theme.
// Tree-shaken ECharts: modules are registered in echartsCore.ts, and we go through
// 'echarts-for-react/lib/core' — the full 'echarts-for-react' entry would import
// the entire 'echarts' bundle and undo the tree-shaking.

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react/lib/core';
import echartsCore from './echartsCore';
import type { EChartsOption } from 'echarts';

interface Props {
  option: EChartsOption;
  /** Force a fresh chart instance when this value changes (e.g. coin switch). */
  notMerge?: boolean;
  /** ECharts events — { click, mouseover, ... } */
  onEvents?: Record<string, (...args: unknown[]) => void>;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Dark-theme ECharts wrapped for the widget card layout. The chart fills its
 * parent and auto-resizes — make sure the parent has an explicit height.
 */
export const EChart = React.memo(function EChart({ option, notMerge, onEvents, className, style }: Props) {
  // Merge the caller's option on top of dark-chart defaults.
  // Tooltip is intentionally left at ECharts default (light) per user preference —
  // light tooltips read better against the dark widget background.
  // IMPORTANT: spread caller's `option` FIRST, then explicitly merge `tooltip`
  // and `grid` on TOP. If `...option` came last, it would wipe our merged keys.
  const merged = useMemo<EChartsOption>(() => ({
    backgroundColor: 'transparent',
    textStyle: {
      color: 'rgba(226,232,240,0.65)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    },
    animation: false, // big perf win — animation triggers re-renders on every WS tick
    ...option,
    grid: { left: 36, right: 12, top: 24, bottom: 28, containLabel: true, ...option.grid },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross', lineStyle: { color: 'rgba(255,255,255,0.15)' } },
      // 12px corner to match the top-bar status pill (实时). ECharts only allows
      // borderRadius on canvas-rendered tooltips, but our tooltips are DOM-based
      // (richer formatting), so we inject the radius via extraCssText.
      extraCssText: 'border-radius: 12px !important; box-shadow: 0 4px 16px rgba(0,0,0,0.18);',
      ...option.tooltip,
    },
  }), [option]);

  return (
    <ReactECharts
      echarts={echartsCore}
      option={merged}
      notMerge={notMerge}
      onEvents={onEvents}
      lazyUpdate
      opts={{ renderer: 'canvas' }}
      style={{ width: '100%', height: '100%', ...style }}
      className={className ? `ui-chart-surface ${className}` : 'ui-chart-surface'}
    />
  );
});

export default EChart;
