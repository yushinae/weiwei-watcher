# 薇薇看板性能优化 · 发烫问题 Spec

## Why
薇薇看板在长时间运行后设备严重发烫，CPU/GPU 占用过高。根本原因是：50+ widget 全量加载、大量 GPU 毛玻璃效果、频繁轮询触发的全量重渲染、主线程密集计算（BS Greeks / Monte Carlo 等）以及缺少代码分割与懒加载。本 spec 聚焦于降低 CPU/GPU 占用，减少不必要的渲染和计算。

## What Changes
- **代码分割**：`monitorWidgets.tsx`（7918 行）按 tab 拆分为 6 个子模块，支持按需加载
- **懒加载**：MonitorPage 各 tab 的 widget 网格改为 `React.lazy` + `Suspense`，仅加载当前可见 tab
- **React.memo 包裹 widget**：所有 widget 组件加 `React.memo`，避免无关 state 变更导致级联重渲染
- **CSS GPU 降级**：减少 `backdrop-filter: blur()` 的层级和模糊半径，引入 `will-change` 优化策略
- **降低轮询频率**：数据刷新间隔从 30s 提升到 60s，历史数据从 5min 提升到 15min
- **DigitalClock 独立化**：将每秒重渲染的时钟隔离到独立子树，避免触发整页渲染
- **ECharts 实例复用与懒初始化**：PositionBuilder 中 ECharts 图表仅在对应 tab 可见时初始化
- **Scroll 事件节流**：App.tsx 中的 scroll 监听改用 `passive` + 简单节流
- **Web Worker 试点**：将 Monte Carlo VaR 计算移到 Web Worker
- **移除未使用的依赖**：`plotly.js-dist`、`zustand` 等未实际使用的大包清理或按需引入
- **`useMemo` / `useCallback` 审查**：修复缺失的依赖项，消除不必要的重算

## Impact
- Affected specs: 全部（这是全局性能优化）
- Affected code:
  - `src/registry/monitorWidgets.tsx` — 拆分
  - `src/pages/MonitorPage.tsx` — 懒加载
  - `src/App.tsx` — scroll 优化、时钟隔离
  - `src/components/ElasticLayout.tsx` — motion 降级
  - `src/features/positionBuilder/PositionBuilder.tsx` — ECharts 懒加载、Worker
  - `src/index.css` — GPU 降级
  - `vite.config.ts` — 分包优化

## ADDED Requirements

### Requirement: Monitor Widgets 按 Tab 代码分割
系统 SHALL 将 `monitorWidgets.tsx` 按 6 个 tab（market / vol / oi / flow / analysis / trade）拆分为独立模块，共享的数据层（hooks、BS 工具函数）提取到单独的 `data/` 和 `math/` 模块。

#### Scenario: 仅加载当前 tab 的 widget 代码
- **WHEN** 用户打开监控页，tab 默认为 `market`
- **THEN** 仅 `market` tab 对应的 widget bundle 被下载和执行，其他 tab 的 widget 代码不被加载

#### Scenario: 切换 tab 时按需加载
- **WHEN** 用户从 `market` 切换到 `vol` tab
- **THEN** `vol` tab 的 widget bundle 异步加载，加载期间显示骨架屏，加载完成后渲染

### Requirement: Widget 组件记忆化
系统 SHALL 为所有 widget 组件包裹 `React.memo`，使用浅比较 props（`coin`、`onCoinChange`），避免父组件 state 变更导致无关 widget 重渲染。

#### Scenario: 切换 tab 不影响其他已缓存的 widget
- **WHEN** 用户在 `market` tab 和 `vol` tab 之间切换
- **THEN** 之前已渲染的 widget DOM 树不被销毁重建（通过 `Suspense` + `React.memo` 保持）

### Requirement: GPU 毛玻璃降级
系统 SHALL 降低 `backdrop-filter: blur()` 的使用层级和强度：widget 卡片模糊从 24px 降至 12px，移除 monitor-scope 层的 blur，将频繁更新的卡片（如 SpotTicker）的 `backdrop-filter` 替换为纯色背景。

#### Scenario: 设备发烫改善
- **WHEN** 应用运行超过 10 分钟
- **THEN** GPU 占用显著降低，设备温度不再持续攀升

### Requirement: 轮询频率降低
系统 SHALL 将期权数据轮询间隔从 30s 调整为 60s，历史数据轮询从 5min 调整为 15min，价格 ticker 从 2s 调整为 5s。

#### Scenario: 数据仍保持合理新鲜度
- **WHEN** 应用运行中
- **THEN** 网络请求频率降低 40-50%，UI 仍能在 60s 内反映最新 market data

### Requirement: DigitalClock 渲染隔离
系统 SHALL 将 `DigitalClock` 组件的每秒重渲染隔离在独立子树中（使用独立的 state 或 `useSyncExternalStore`），确保不会触发 App 组件树的其他部分重渲染。

#### Scenario: 时钟更新不影响 widget
- **WHEN** 时钟每秒更新
- **THEN** App 的其他子组件不会因此触发 render

### Requirement: Scroll 事件优化
系统 SHALL 将 App.tsx 中的 scroll 事件监听改为 `passive: true`，并增加 100ms 节流，减少主线程占用。

#### Scenario: 快速滚动时帧率稳定
- **WHEN** 用户在监控页快速滚动
- **THEN** 页面帧率保持 60fps，不出现明显卡顿

### Requirement: ECharts 按需渲染
系统 SHALL 将 PositionBuilder 中右侧 5 个 tab 的 ECharts 图表改为仅在对应 tab 可见时初始化/更新，隐藏时销毁实例释放内存。

#### Scenario: 仅当前可见 tab 的图表占用资源
- **WHEN** 用户在头寸压力测试页切换 tab
- **THEN** 仅当前可见 tab 的 ECharts 实例处于活跃状态

### Requirement: Monte Carlo Web Worker
系统 SHALL 将 PositionBuilder 中的 5000 路径 Monte Carlo VaR/CVaR 计算迁移到 Web Worker 中执行，避免阻塞主线程。

#### Scenario: VaR 计算不阻塞 UI
- **WHEN** 用户点击「重算」触发 Monte Carlo
- **THEN** UI 保持响应，计算结果通过 Worker 消息异步返回

### Requirement: ElasticLayout 动效降级
系统 SHALL 为 ElasticLayout 的 motion 弹簧动效增加 `prefers-reduced-motion` 检测，并在检测到时禁用弹性效果。

#### Scenario: 低性能设备上禁用弹性
- **WHEN** 系统设置了 `prefers-reduced-motion` 或设备性能较低
- **THEN** 橡皮筋弹性效果被禁用，滚动容器使用原生 overflow 行为

## MODIFIED Requirements

### Requirement: Vite 分包策略
**原策略**: 仅 `vendor-plotly`、`vendor-motion`、`vendor-react` 三个手动分包。
**新策略**: 增加 `vendor-echarts` 分包，将 `echarts` + `echarts-for-react` 与业务代码分离；移除 `vendor-plotly`（plotly 当前未实际使用）。

#### Scenario: 首屏加载更快
- **WHEN** 用户首次访问应用
- **THEN** 首屏 JS 体积减少，主线程解析/编译时间缩短

## REMOVED Requirements
无。
