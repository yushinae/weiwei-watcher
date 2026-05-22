# Checklist

## 轮询频率
- [x] `CACHE_TTL` 从 30s 改为 60s（文件: `src/registry/monitorWidgets.tsx` L279）
- [x] `HIST_TTL` 从 5min 改为 15min（文件: `src/registry/monitorWidgets.tsx` L452）
- [x] App.tsx ticker `setInterval` 从 2000 改为 5000（L68）

## CSS GPU 降级
- [x] `.widget-card` backdrop-filter blur 从 24px 降至 12px
- [x] `.glass` backdrop-filter blur 从 22px 降至 12px
- [x] `.glass-header` backdrop-filter blur 从 30px 降至 14px
- [x] `.monitor-scope` 上的 backdrop-filter 已移除，改为纯色背景
- [x] `.glass-bar` 增加 `transform: translateZ(0)` + `will-change: transform`
- [x] 目视确认 UI 无明显差异

## Scroll 事件
- [x] App.tsx scroll listener 使用 `{ capture: true, passive: true }`
- [x] onScroll 回调有 100ms 节流

## DigitalClock
- [x] DigitalClock 已提取到独立文件 `src/components/DigitalClock.tsx`
- [x] React.memo 包裹

## ElasticLayout
- [x] 存在 `prefers-reduced-motion` 检测
- [x] 检测到时跳过 motion spring 动画

## 代码拆分 — 已放弃
- [ ] ~~`src/lib/bs-math.ts` 存在~~ — 不实施文件拆分，保持原架构
- [ ] ~~6 个 tab widget 文件均存在~~ — 不实施，改为 Vite 分包优化

## MonitorPage 懒加载 — 已放弃
- [ ] ~~依赖代码拆分结果，不独立实施~~

## Widget React.memo — 已放弃
- [ ] ~~依赖代码拆分，不独立实施~~

## ECharts 按需渲染 — 待后续实施
- [ ] `src/workers/var-worker.ts` 已创建但未集成到 PositionBuilder

## Monte Carlo Worker — Worker 文件就绪，未集成
- [x] `src/workers/var-worker.ts` 存在，内含独立 BS + Monte Carlo 函数
- [ ] PositionBuilder 中尚未调用 Worker

## Vite 分包
- [x] `vendor-echarts` 分包已添加到 vite.config.ts
- [x] `vendor-plotly` 分包已从 vite.config.ts 移除
- [x] `plotly.js-dist` 和 `zustand` 已从 package.json 移除
- [x] `npm run build` 产物中 `vendor-echarts` 独立分块 (1,147KB)

## 构建与检查
- [x] `npm run lint` 零错误
- [x] `npm run build` 成功 (2.86s)
- [ ] `npm run dev` 未在本地运行验证（需用户手动确认）
