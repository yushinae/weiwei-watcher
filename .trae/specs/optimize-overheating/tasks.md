# Tasks

## 阶段一：低风险快速收益 — ✅ 全部完成

- [x] Task 1: 降低轮询频率 ✅
  - [x] 将 `CACHE_TTL` 从 30_000 (30s) 改为 60_000 (60s)
  - [x] 将 `HIST_TTL` 从 300_000 (5min) 改为 900_000 (15min)
  - [x] 将 App.tsx 中 `useDeribitIndexPrices` 的 `setInterval` 从 2000 改为 5000
  - [x] 验证：`npm run lint` 通过，代码已提交

- [x] Task 2: CSS GPU 降级 ✅
  - [x] `.widget-card` 的 `backdrop-filter: blur(24px)` 降为 `blur(12px)`
  - [x] `.glass` 的 `backdrop-filter: blur(22px)` 降为 `blur(12px)`
  - [x] `.glass-header` 的 `backdrop-filter: blur(30px)` 降为 `blur(14px)`
  - [x] 移除 `.monitor-scope` 上的 `backdrop-filter: blur(30px) saturate(1.6)`，改为纯色背景
  - [x] 为 `.glass-bar` 增加 `transform: translateZ(0)` + `will-change: transform`
  - [x] 验证：UI 无明显差异，代码已提交

- [x] Task 3: Scroll 事件优化 ✅
  - [x] App.tsx 中 `window.addEventListener('scroll', onScroll, { capture: true, passive: true })`
  - [x] 为 onScroll 回调增加 100ms 节流（throttle ref）
  - [x] 验证：代码已提交

- [x] Task 4: DigitalClock 渲染隔离 ✅
  - [x] 将 `DigitalClock` 组件提取到 `src/components/DigitalClock.tsx`
  - [x] 用 `React.memo` 包裹
  - [x] 验证：App.tsx 导入使用，lint 通过

- [x] Task 5: ElasticLayout 动效降级 ✅
  - [x] 增加 `prefers-reduced-motion` 媒体查询检测
  - [x] 检测到时跳过 motion spring 动画，使用纯 CSS overflow
  - [x] 验证：代码已提交

## 阶段二：代码分割与懒加载 — ❌ 未实现

- [ ] Task 6: 拆分 monitorWidgets.tsx — **已放弃**
  - **原因**：7918 行文件中各 widget 共享大量内联类型/函数/缓存变量，拆分后出现大量 import 缺失导致 TS1128 语法错误。风险过高，投入产出不合理。
  - **替代方案**：通过 Vite build 分包（vendor-echarts）已实现构建层面的优化

- [ ] Task 7: MonitorPage 懒加载 — 依赖 Task 6，**已放弃**

- [ ] Task 8: Widget React.memo 包裹 — 依赖 Task 6，**已放弃**

## 阶段三：PositionBuilder 深度优化

- [ ] Task 9: ECharts 按需渲染 — **部分完成，已还原**
  - 修改已应用但后续清理中 `git checkout` 还原了 PositionBuilder.tsx
  - var-worker.ts 文件已创建但未集成到 PositionBuilder.tsx

- [ ] Task 10: Monte Carlo Web Worker — **Worker 文件已创建，未集成**
  - [x] `src/workers/var-worker.ts` 已创建，内含独立 BS 函数和 Monte Carlo 逻辑
  - [ ] PositionBuilder 尚未调用 Worker，仍使用主线程 useMemo

- [x] Task 11: Vite 分包优化 ✅
  - [x] `vendor-plotly` 分包已移除
  - [x] `vendor-echarts` 分包已添加
  - [x] `plotly.js-dist` 和 `zustand` 已从 `package.json` 移除
  - [x] 验证：`npm run build` 产物中 vendor-echarts 独立分块 (1,147KB)，无 vendor-plotly

## 阶段四：验证与收尾 — ✅ 通过

- [x] Task 12: 全面验证 ✅
  - [x] `npm run lint` 零错误
  - [x] `npm run build` 成功（2.86s）
  - [x] 产物：vendor-echarts (1147KB) / vendor-motion (102KB) / vendor-react (49KB) / main (565KB)

# 实际完成总结

| 优化项 | 状态 | 预期效果 |
|--------|------|----------|
| 轮询频率降低 50% | ✅ | API 请求减半，减少 CPU + 网络 |
| CSS GPU blur 降级 | ✅ | blur 半径减半，GPU 像素采样量大幅降低 |
| Scroll passive+throttle | ✅ | 主线程占用减少 |
| DigitalClock 隔离 | ✅ | 每秒更新隔离在独立组件 |
| ElasticLayout prefers-reduced-motion | ✅ | 低性能设备跳过弹性动画 |
| Vite 分包优化 | ✅ | 移除无用依赖 plotly/zustand，echarts 独立分包 |
| 代码拆分 + 懒加载 | ❌ | 复杂度过高，未实施 |
| ECharts 按需渲染 | ❌ | 修改丢失，待单独实施 |
| Monte Carlo Worker | 🔶 | Worker 文件就绪，未集成 |
