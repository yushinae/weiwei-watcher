# Tasks

## 阶段一：低风险快速收益（并行）
这些任务互不依赖，可同时进行。

- [ ] Task 1: 降低轮询频率
  - [ ] 将 `CACHE_TTL` 从 30_000 (30s) 改为 60_000 (60s)
  - [ ] 将 `HIST_TTL` 从 300_000 (5min) 改为 900_000 (15min)
  - [ ] 将 App.tsx 中 `useDeribitIndexPrices` 的 `setInterval` 从 2000 改为 5000
  - [ ] 验证：`npm run dev` 启动后观察 Network 面板请求间隔

- [ ] Task 2: CSS GPU 降级
  - [ ] `.widget-card` 的 `backdrop-filter: blur(24px)` 降为 `blur(12px)`
  - [ ] `.glass` 的 `backdrop-filter: blur(22px)` 降为 `blur(12px)`
  - [ ] `.glass-header` 的 `backdrop-filter: blur(30px)` 降为 `blur(14px)`
  - [ ] 移除 `.monitor-scope` 上的 `backdrop-filter: blur(30px) saturate(1.6)`，改为纯色 `background: var(--color-bg-base)`
  - [ ] 为 `.glass-bar` 增加 `transform: translateZ(0)` 创建独立合成层
  - [ ] 验证：`npm run dev` 后目视 UI 无明显差异，DevTools Performance 面板 GPU 占用降低

- [ ] Task 3: Scroll 事件优化
  - [ ] App.tsx 中 `window.addEventListener('scroll', onScroll, true)` 增加 `{ passive: true }` 选项
  - [ ] 为 onScroll 回调增加 100ms 节流（throttle）
  - [ ] 验证：快速滚动时 DevTools Performance 面板无明显 long task

- [ ] Task 4: DigitalClock 渲染隔离
  - [ ] 将 `DigitalClock` 组件从 App.tsx 提取到独立文件 `src/components/DigitalClock.tsx`
  - [ ] 用 `React.memo` 包裹，确保其 state 更新不触发父组件重渲染
  - [ ] 验证：React DevTools Profiler 确认时钟每秒更新时不触发 App 其他部分重渲染

- [ ] Task 5: ElasticLayout 动效降级
  - [ ] 在 ElasticLayout 组件内增加 `prefers-reduced-motion` 媒体查询检测
  - [ ] 检测到时跳过 motion spring 动画，使用纯 CSS overflow 滚动
  - [ ] 验证：系统设置「减少动态效果」后橡皮筋弹性消失

## 阶段二：代码分割与懒加载（依赖阶段一完成）

- [ ] Task 6: 拆分 monitorWidgets.tsx
  - [ ] 将 `normCDF/normPDF/bsDelta/bsGamma/bsVega/bsTheta/bsVanna/bsCharm/bsCall/bsPut` 等 BS 工具函数提取到 `src/lib/bs-math.ts`
  - [ ] 将 `fitAR1/forecastAR1/rollingRV/percentileAt` 等时间序列工具提取到 `src/lib/time-series.ts`
  - [ ] 将 `mapPts/poly/smooth/area/heatColor` 等 SVG 绘图辅助提取到 `src/lib/svg-utils.ts`
  - [ ] 将 `ParsedOption/ExpiryGroup/DeribitData/HistoryData/SkewSnap` 等类型提取到 `src/registry/types.ts`
  - [ ] 将 `subscribeData/POLLERS/_pauseAll/_resumeAll` 等数据层提取到 `src/registry/data-layer.ts`
  - [ ] 将 `useDeribitOptions/useDeribitHistory/DERIBIT_CACHE/HIST_CACHE` 等 hooks 提取到 `src/registry/data-hooks.ts`
  - [ ] 将 `useCoinControl/WidgetShell/CoinTabs/LiveBadge/...` 等 UI 辅助提取到 `src/registry/ui-helpers.tsx`
  - [ ] 创建 6 个 tab widget 文件：
    - `src/registry/widgets-market.tsx` — SpotTicker, SentimentComposite, OrderbookDepth, Alerts, IVSignal, ImpliedMove, LiveOptionsChain, BlockTrade, VolOverview, StrategyPricer
    - `src/registry/widgets-vol.tsx` — DVOLSeries, SkewHistory, TermStructureDrift, VolSmile, IVSurface, OptionsSkew, VRPHistory, VannaCharm, VolCone, IVRankHistory, RVvsIVTenor, DollarGreeks, CalendarSpread, ForwardVol
    - `src/registry/widgets-oi.tsx` — OIByStrike, GEX, DEX, KeyLevels, ExpiryCalendar, TopOI, OIDelta, GammaPin
    - `src/registry/widgets-flow.tsx` — FundingRate, FuturesBasis, OptionsFlow, FearGreed, PCRHistory, PremiumFlow, LargeTradeAlert
    - `src/registry/widgets-analysis.tsx` — VolRegime, GreeksScenario, PriceTargetProb, EWMAForecast, BTCETHSpread, TenorIVHeatmap, Correlation, IVCheapness
    - `src/registry/widgets-trade.tsx` — PositionTracker, PayoffProfile, VerticalSpreadPricer, Watchlist, RollCost, StrategyPricer
  - [ ] 保留 `src/registry/monitorWidgets.tsx` 作为 barrel export，re-export 所有 widget + GlobalGradDefs
  - [ ] 验证：`npm run lint` 无类型错误，`npm run dev` 各 tab widget 正常渲染

- [ ] Task 7: MonitorPage 懒加载
  - [ ] 创建 6 个懒加载组件文件（`src/pages/tabs/`目录）：
    - `MarketTab.tsx` — `React.lazy(() => import('@/src/registry/widgets-market'))` + Suspense + 骨架屏
    - `VolTab.tsx`、`OiTab.tsx`、`FlowTab.tsx`、`AnalysisTab.tsx`、`TradeTab.tsx`
  - [ ] 每个 LazyTab 组件内部渲染对应 widget 网格，外层用 `Suspense fallback={<WidgetCardSkeleton />}`
  - [ ] MonitorPage.tsx 中删除直接 import 50+ widget，改为按 tab 条件渲染对应的 LazyTab
  - [ ] 验证：打开 DevTools Network 面板，初始仅加载 market tab 的 widget 代码；切换 tab 时出现新的 chunk 请求

- [ ] Task 8: Widget React.memo 包裹
  - [ ] 在每个 tab widget 文件中，为所有导出的 widget 组件包裹 `React.memo`
  - [ ] 确保 `onCoinChange` 等回调使用 `useCallback` 稳定引用
  - [ ] 验证：React DevTools Profiler 显示切换 coin 时仅有当前 tab 的 widget 重渲染

## 阶段三：PositionBuilder 深度优化（依赖阶段一完成）

- [ ] Task 9: ECharts 按需渲染
  - [ ] 当前所有 tab 的图表（chart、greeks heatmap、scenario matrix 内的图表）都在 DOM 中存在，改为仅在 `activeTab` 匹配时才渲染 `ReactECharts` 组件
  - [ ] 图表容器上增加 `display: none` 不会阻止 ECharts 初始化，需要条件渲染 `{activeTab === 'chart' && <ReactECharts .../>}`
  - [ ] 验证：切换 PositionBuilder 右侧 tab 时，非活跃 tab 的 canvas 元素不存在于 DOM

- [ ] Task 10: Monte Carlo Web Worker
  - [ ] 创建 `src/workers/var-worker.ts`，包含 `bsPrice`/`normCdf`/`normInv` 等纯函数
  - [ ] Worker 接收 `{spot, sigma, T, legs, numPaths}` 消息，计算各条路径的 P/L，返回 `{histEdges, histCounts, hWidth, var95, cvar95, var99, cvar99, baseS}`
  - [ ] PositionBuilder 中 `varCvar` 的 useMemo 改为调用 Worker，使用 `useState` + `useEffect` 异步模式
  - [ ] 计算期间显示 loading 状态
  - [ ] 验证：点击「重算」按钮后主线程不阻塞，Worker 返回结果后 UI 更新

- [ ] Task 11: Vite 分包优化
  - [ ] `vite.config.ts` 中移除 `vendor-plotly` 分包
  - [ ] 新增 `vendor-echarts` 分包：`['echarts', 'echarts-for-react']`
  - [ ] 可选：如果 `plotly.js-dist` 已无引用，从 `package.json` 中移除
  - [ ] 验证：`npm run build` 后检查 `dist/` 中 JS 分块，确认 `vendor-echarts` 独立出现且无 `vendor-plotly`

## 阶段四：验证与收尾

- [ ] Task 12: 全面验证
  - [ ] `npm run lint` 零错误
  - [ ] `npm run build` 成功
  - [ ] `npm run dev` 各页面功能正常
  - [ ] 手动测试：监控页 6 个 tab 切换正常，数据正常加载
  - [ ] 手动测试：头寸压力测试页所有功能正常
  - [ ] DevTools Performance 录制 30s，对比优化前后 CPU/GPU 占用

# Task Dependencies
- Task 6 依赖 Task 1-5（需要先拆分数据层和工具函数）
- Task 7 依赖 Task 6（需要先有拆分后的 widget 模块才能懒加载）
- Task 8 依赖 Task 6（需要在拆分后的文件中包裹 React.memo）
- Task 9、10、11 与 Task 6-8 可并行（修改不同文件）
- Task 12 依赖所有其他 Task
