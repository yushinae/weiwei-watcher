# widget-card 卡片体系优化计划

## Summary（目标概述）
在现有“暗色交易终端”设计系统基础上，**统一优化全站 `widget-card` 卡片容器体系**，覆盖：
1) **动效与交互手感**：hover/active/focus/drag/fullscreen/overlay 动效参数统一、手感更细腻克制。  
2) **图标交互与可发现性**：卡片 actions（fullscreen/close/更多）在鼠标/触屏/键盘场景下都“可见、可达、可理解”。  
3) **加载/空态/错误态**：统一 skeleton、empty、error、stale（实时数据断连但保留最后值）展示模型，为后续接真实数据打底。  
4) **性能与可扩展**：减少无关重渲染、提供可控 props API，为 WebSocket 高频数据接入准备订阅粒度与状态模型。

设计方向遵循 `frontend-design`：**克制终端感 + 可记忆细节**（低对比边线、轻微 lift、信号高亮、统一 easing/时长），避免模板化后台卡片。

---

## Current State Analysis（现状分析）

### 1) 卡片容器现状（存在多套“卡片壳”）
- 全局卡片外观基线：`src/index.css` 的 `.widget-card`
  - 目前 `transition`/`ease` 写死（`150ms ease`），与 Popup/Drawer 的动效曲线不一致。
- Dashboard 卡片：`src/pages/DashboardPage.tsx` 内联 `WidgetContainer`
  - 标题条=拖拽把手（`.widget-drag-handle`）+ 右上角 actions hover 才显现。
- Monitor 卡片：`src/pages/MonitorPage.tsx` 内自定义 `Card()`（同用 `.widget-card`，但 header/padding/action slot 与 Dashboard 不同）。

### 2) Overlay 动效基线已经存在，但未与卡片统一
- `src/components/popup/Popup.tsx` 已有统一曲线 `POPUP_EASE = [0.22, 1, 0.36, 1]`，并使用 `duration: 0.14`。
- `src/components/popup/popup.css` 的 popup token（`--popup-card-bg` 等）与 `src/index.css` 的 `@theme` token 体系尚未完全映射统一。

### 3) Skeleton/状态呈现分散
- Monitor 内已有 skeleton 实现：`src/features/monitor/components/Skeletons.tsx`，但不是全站统一入口。
- 目前缺少统一的：`empty/error/stale/retry` 状态框架（尤其是为 WebSocket 断连准备的 stale 状态）。

### 4) 为 WebSocket 高频数据接入的潜在风险
- 项目中已有 WS 接入范例（App 内）：`src/App.tsx`（`useBinanceTickers`）
  - 典型风险：用数组存 tickers 时，高频更新会导致引用频繁变化 → 订阅该 slice 的 UI 组件大量重渲染。
- Dashboard 使用 `react-grid-layout`，卡片数量多时重渲染放大效应明显，需要更细粒度 selector 与 memo 策略。

---

## Proposed Changes（改造方案与文件级变更）

### A) 统一 Card 组件：用一个 `WidgetCard` 取代“Dashboard 内联 + Monitor 内联”
**目标**：统一结构约束（header、actions、内容 padding、状态层），但允许内容布局个性化（避免“模板化”）。

#### A1. 新增通用组件与 hooks（新增文件）
1. `src/components/card/WidgetCard.tsx`
   - 提供统一卡片结构：header（title/icon/subtitle）+ actions 区 + content 区 + status overlay（可选）
   - 支持 `dragHandle` slot（保留 Dashboard 的拖拽区域规则）
   - 支持 `variant`（如 `default/fullscreen`，用于 is-fullscreen 外观一致性）

2. `src/components/card/WidgetCardSkeleton.tsx`
   - 统一 skeleton 基础样式（shimmer、层级、圆角、分隔线）
   - 允许传入 `layoutPreset`（如 `metrics/chart/table`）或 `children` 自定义，以适配不同 widget 内容密度

3. `src/components/card/useWidgetCardActions.ts`
   - 统一 actions 可发现性策略（hover/focus/触屏 pointer coarse）
   - 统一 tooltip/aria-label 约束，确保键盘可达与可理解

4. `src/components/card/useCardStateMachine.ts`
   - 轻量 reducer：`loading/ready/empty/error/stale`
   - 输出：`status`、`retry()`、`refresh()`、`lastUpdatedAt`、`staleSince`
   - stale 策略：WS 断连/超时 → UI 保留最后值并标记 stale（终端更符合预期）

#### A2. Dashboard 接入统一卡片（修改文件）
**修改** `src/pages/DashboardPage.tsx`
- 用 `WidgetCard` 替换内联 `WidgetContainer`
- 将 actions（fullscreen/close）通过 `WidgetCard` 的 `actions` 注入，保持：
  - `.widget-drag-handle` 仍只挂在 header 左侧指定区域，避免拖拽与内容点击冲突
  - hover 才显示 actions 的策略改为“常态低不透明度 + hover/focus 提亮”（可发现性更好）

#### A3. Monitor 接入统一卡片（修改文件）
**修改** `src/pages/MonitorPage.tsx`
- 删除本地 `Card()` 壳，替换为 `WidgetCard`
- Monitor 的 header 高度与 padding 通过 `WidgetCard` props 控制（如 `headerDensity="compact"`），而不是 Monitor 自己维护结构

---

### B) Motion/动效 token 化：让 widget-card 与 Popup/Drawer 同一套参数
**目标**：一个项目只有一套“动效语言”（duration、ease、位移幅度、hover lift、focus ring）。

#### B1. 收敛 motion 常量（新增文件）
**新增** `src/motion/tokens.ts`
- 导出统一曲线（复用 Popup 的 `POPUP_EASE`）：`EASE_EMPHASIS = [0.22, 1, 0.36, 1]`
- 导出统一时长：`DUR_FAST / DUR_POP / DUR_CARD`（用于 hover、drawer、fullscreen、淡入淡出）

#### B2. CSS 侧 token 化（修改文件）
**修改** `src/index.css`
- 为 `.widget-card` 的 `transition` 使用 CSS 变量：
  - `--dur-card`, `--ease-emphasis`, `--lift-card` 等
- 统一 focus ring（键盘导航时 actions/按钮可见且一致）

#### B3. Popup/Drawer 动效与 token 对齐（修改文件）
**修改** `src/components/popup/Popup.tsx`
- 将 `POPUP_EASE`/duration 改为从 `src/motion/tokens.ts` 引用（单一规范源）

**修改（可选但推荐）** `src/components/popup/popup.css`
- 将 popup 的背景/边线相关 CSS 变量与 `@theme` token 语义对齐（至少做到：surface/border/shadow 与全局一致）

---

### C) 图标交互与可发现性（actions 体系）
**目标**：不依赖“完全 hover 才出现”，新用户也能发现；同时不破坏终端的克制感。

**在 `WidgetCard` 中落地规则：**
- 鼠标（pointer fine + hover true）：actions 默认 `opacity ~ 0.35`，hover/focus 提到 `1`
- 触屏（pointer coarse 或 hover false）：actions 常显（避免“永远找不到按钮”）
- keyboard：Tab 到 actions 时必须可见，并有统一 focus ring
- actions 必须有 `aria-label`，并支持可选 tooltip（短 label、终端风格）

涉及文件：
- 新增 `src/components/card/useWidgetCardActions.ts`
- 修改 `src/pages/DashboardPage.tsx`、`src/pages/MonitorPage.tsx` 以使用统一 actions 模式

---

### D) 加载/空态/错误态/断连（stale）统一
**目标**：为后续 WS 接入准备“每张卡片都有统一状态层”，避免业务组件各自处理。

#### D1. 统一状态渲染（WidgetCard 内置）
在 `WidgetCard.tsx` 中内置：
- `status: 'loading' | 'ready' | 'empty' | 'error' | 'stale'`
- loading：显示 skeleton，但 header 仍显示 title/icon（用户知道在加载什么）
- empty：显示短文案 + 1 个行动按钮（可选），避免大插画
- error：显示短错误 + retry action；详细信息放 tooltip/折叠（保持克制）
- stale：保留旧内容 + header 小 pill（提示“数据可能过期/断连”）+ tooltip

#### D2. 迁移/复用现有 skeleton
**修改** `src/features/monitor/components/Skeletons.tsx`
- 改为调用共享 `WidgetCardSkeleton` 或迁移为共享组件实现（避免重复体系继续扩散）

---

### E) 为 WebSocket 高频数据做准备（store 与订阅粒度规划）
> 本次为“准备工作”给出明确落点与约束：实现可并行/可逐步落地，不强制一次性把所有实时数据接入完成。

#### E1. 建议新增 realtime store（新增文件）
**新增（规划）**：
- `src/store/useRealtimeStore.ts`：存储 `tickersBySymbol`（Record/Map），并包含 `connectionStatus/lastMessageAt`
- `src/services/wsHub.ts`（或同类命名）：统一管理 WS 连接、topic subscribe/unsubscribe

#### E2. selector 级 hook（新增文件或在 store 内导出）
- `useTicker(symbol)`：只订阅单个 symbol，避免数组引用变化导致全局重渲染
- `useConnectionStatus()`：给卡片 `stale` 判断提供数据源

#### E3. 卡片“可见性”扩展点（为降采样/暂停订阅准备）
在 `WidgetCard` 内提供可选的可见性 hook 接口（IntersectionObserver）：
- `onVisibilityChange?(visible: boolean)`
后续 WS subscribe 可用 `active: visible` 控制订阅或降采样。

---

## Assumptions & Decisions（关键假设与决策）
1) 本次优化范围明确为：**`widget-card` 卡片体系**（Dashboard/Monitor 等通用面板容器），不扩展到所有列表项/PopupCard 以外的“所有卡片化 UI”。
2) 风格方向：**克制终端感**，强调统一手感与可发现性，不引入“玻璃拟物”等高性能成本视觉。
3) 后续数据以 **WebSocket 实时** 为主，因此引入 `stale` 状态与更细粒度 selector 作为准备；本次计划不要求立即完成所有实时数据迁移，但会为其提供明确落点与 API。
4) 动效规范：以 `Popup.tsx` 已存在的 `POPUP_EASE` 作为全局标准曲线来源，并将 `.widget-card` CSS 动效 token 化对齐。

---

## Verification（验证与验收步骤）

### 1) UI 交互与可用性
1. Dashboard：卡片 hover 手感统一、actions 在 hover/focus 下可见；拖拽把手区域不干扰内容点击。
2. Monitor：所有卡片 header/padding/actions 行为与 Dashboard 一致；Inspector/Drawer 打开关闭动效与卡片一致。
3. 键盘可达：Tab 导航到卡片 actions 时按钮可见且有 focus ring；actions 有 aria-label。

### 2) 状态一致性
1. 将任意 widget 强制设为 `loading/empty/error/stale` 时，展示符合统一规范：
   - loading 有 skeleton 且不抖动
   - error 有 retry action
   - stale 保留最后值并提示“可能过期”

### 3) 性能与工程质量
1. `npm run lint` 通过（tsc noEmit）。
2. `npm run build` 通过（vite build）。
3. React Profiler/观察：WS 高频更新（模拟）时，不会导致无关卡片重渲染（通过 selector + memo + actions useMemo 达成）。

