// Tree-shaken ECharts instance — the ONLY place echarts modules get registered.
// Import this instance and pass it to `echarts-for-react/lib/core`; never import
// 'echarts' or 'echarts-for-react' (full entries) — they pull the entire ~1.1MB
// bundle and defeat this registration.

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
import { LineChart, BarChart, BoxplotChart, ScatterChart, HeatmapChart } from 'echarts/charts';

// Register once. Adding a new chart type? Import it from 'echarts/charts' and
// add it to this list. Keep imports narrow to keep bundle size in check.
// (Gauge/Custom 已随对应 widget 下线移除——要用时从 'echarts/charts' 加回即可。)
echarts.use([
  CanvasRenderer,
  LineChart,
  BarChart,
  BoxplotChart,   // 波动率锥
  ScatterChart,   // 散点 / 当前 IV 标记
  HeatmapChart,   // Vanna/Charm 热力图
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  MarkPointComponent,
  AxisPointerComponent,
  VisualMapComponent, // 热力图配色梯度
]);

export default echarts;
