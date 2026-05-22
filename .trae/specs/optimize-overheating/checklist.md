# Checklist

## 轮询频率
- [ ] `CACHE_TTL` 从 30s 改为 60s（文件: `src/registry/data-layer.ts`）
- [ ] `HIST_TTL` 从 5min 改为 15min（文件: `src/registry/data-layer.ts`）
- [ ] App.tsx ticker `setInterval` 从 2000 改为 5000

## CSS GPU 降级
- [ ] `.widget-card` backdrop-filter blur 从 24px 降至 12px
- [ ] `.glass` backdrop-filter blur 从 22px 降至 12px
- [ ] `.glass-header` backdrop-filter blur 从 30px 降至 14px
- [ ] `.monitor-scope` 上的 backdrop-filter 已移除，改为纯色背景
- [ ] 目视确认 UI 无明显差异

## Scroll 事件
- [ ] App.tsx scroll listener 使用 `{ passive: true }`
- [ ] onScroll 回调有 100ms 节流

## DigitalClock
- [ ] DigitalClock 已提取到独立文件 `src/components/DigitalClock.tsx`
- [ ] React.memo 包裹，确认每秒更新不触发父组件重渲染

## ElasticLayout
- [ ] 存在 `prefers-reduced-motion` 检测
- [ ] 检测到时跳过 motion spring 动画

## 代码拆分
- [ ] `src/lib/bs-math.ts` 存在，包含所有 BS 工具函数
- [ ] `src/lib/time-series.ts` 存在，包含 fitAR1/forecastAR1/rollingRV/percentileAt
- [ ] `src/lib/svg-utils.ts` 存在，包含 mapPts/poly/smooth/area/heatColor
- [ ] `src/registry/types.ts` 存在，包含所有数据类型定义
- [ ] `src/registry/data-layer.ts` 存在，包含 subscribeData/POLLERS/DERIBIT_CACHE 等
- [ ] `src/registry/data-hooks.ts` 存在，包含 useDeribitOptions/useDeribitHistory
- [ ] `src/registry/ui-helpers.tsx` 存在，包含 useCoinControl/WidgetShell/CoinTabs 等
- [ ] 6 个 tab widget 文件均存在且可正常 import

## MonitorPage 懒加载
- [ ] 6 个 LazyTab 组件文件均存在（`src/pages/tabs/` 目录）
- [ ] 每个 LazyTab 使用 `React.lazy` + `Suspense` + 骨架屏 fallback
- [ ] MonitorPage.tsx 不再直接 import 50+ widget
- [ ] Network 面板验证：初始仅加载当前 tab 的 widget chunk

## Widget React.memo
- [ ] 所有 widget 组件已包裹 React.memo
- [ ] onCoinChange 等回调使用了 useCallback 稳定引用

## ECharts 按需渲染
- [ ] 非活跃 tab 的 ReactECharts 组件不在 DOM 中（条件渲染）
- [ ] 切换 tab 时图表正常初始化

## Monte Carlo Worker
- [ ] `src/workers/var-worker.ts` 存在
- [ ] Worker 正确接收消息并返回 VaR/CVaR 结果
- [ ] 主线程在计算期间不被阻塞

## Vite 分包
- [ ] `vendor-echarts` 分包已添加到 vite.config.ts
- [ ] `vendor-plotly` 分包已从 vite.config.ts 移除
- [ ] `npm run build` 产物中 `vendor-echarts` 独立分块存在

## 构建与检查
- [ ] `npm run lint` 零错误
- [ ] `npm run build` 成功
- [ ] `npm run dev` 所有页面功能正常
