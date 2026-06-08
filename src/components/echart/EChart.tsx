// Thin wrapper around echarts-for-react with the app's dark widget theme.
// Tree-shaken ECharts: we only register the chart/component modules each widget
// actually uses, so the bundle stays small.

import React, { Suspense, lazy, useMemo } from 'react';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  VisualMapComponent,
} from 'echarts/components';
import { LineChart, BarChart, BoxplotChart, ScatterChart, HeatmapChart, CustomChart, GaugeChart } from 'echarts/charts';
import type { EChartsOption } from 'echarts';

const ReactECharts = lazy(() => import('echarts-for-react'));

// Register once. Adding a new chart type? Import it from 'echarts/charts' and
// add it to this list. Keep imports narrow to keep bundle size in check.
echarts.use([
  CanvasRenderer,
  LineChart,
  BarChart,
  BoxplotChart,   // 波动率锥
  ScatterChart,   // 散点 / 当前 IV 标记
  HeatmapChart,   // Vanna/Charm 热力图
  GaugeChart,     // Fear&Greed / VolRegime 半圆仪表
  CustomChart,    // 自定义渲染（保留以备需要）
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  VisualMapComponent, // 热力图配色梯度
]);

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
    <Suspense fallback={<div className={className} style={{ width: '100%', height: '100%', ...style }} />}>
      <ReactECharts
        option={merged}
        notMerge={notMerge}
        onEvents={onEvents}
        lazyUpdate
        opts={{ renderer: 'canvas' }}
        style={{ width: '100%', height: '100%', ...style }}
        className={className}
      />
    </Suspense>
  );
});

export default EChart;
