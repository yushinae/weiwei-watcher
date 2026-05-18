## Summary
按你的新反馈回滚重构方向：**把“期权链”入口加回组件库**（用组件库添加/配置），并在期权链页面顶部实现你截图那种交互——**关闭 X 悬浮在标题字上方靠右（hover 显示）**、**标题字下方有滑块（underline）表示选中**。同时严格保证：在 `/options-chain` 页通过组件库“添加期权链”时只会**在右侧追加新 Tab**，不会切走/替换当前 Tab，也不会改 URL。

---

## Current State Analysis
1) 组件库由 `WIDGET_REGISTRY` 驱动，入口在：
   - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/registry/index.tsx)
   - 组件库弹窗逻辑在：
   - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/App.tsx)
2) 期权链页面 Tab 状态存于 store：
   - `optionsChainTabs` / `activeOptionsTabId`
   - `appendOptionsChainTab`（追加不切换） / `openOptionsChainTab`（打开并激活）
   - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/store/useWorkspaceStore.ts)
3) 期权链页面顶部 Tab UI 在：
   - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/pages/OptionsChainPage.tsx)
4) 目前项目里存在一个“期权链页专用新增弹窗”组件（需要撤销/不再作为主入口）：
   - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/pages/AddOptionsChainTabModal.tsx)

---

## Proposed Changes
> 设计原则（frontend-design）：暗色终端风格要克制、密度高但不拥挤；交互反馈明确（hover/focus/active）；动效短促干净（transform/opacity，避免影响布局）。

### 1) 组件库加回“期权链”入口（Registry 层）
文件：`src/registry/index.tsx`
1. 在 `WidgetDefinition` 扩展一个可选字段用于区分“真实 widget”与“动作入口”：
   - `kind?: 'widget' | 'action'`（默认 `widget`）
2. 新增 `WIDGET_REGISTRY['options-chain']`：
   - `category: 'options'`（出现在“期权”分类）
   - `label: '期权链'`
   - `kind: 'action'`
   - `configSchema` 支持：
     - `coinId`（BTC-USD/ETH-USD/BTC-USDC/…；展示规则：币本位显示 BTC/ETH，大写；U 本位显示 BTC-USDC，大写）
     - `expiry`（复用 OptionsChainPage 的 expiry 字符串格式，例如 `15 MAY 26`）
   - `preview` 做一个轻量暗色预览（不需要真实渲染期权链）

### 2) App：组件库“添加”按钮对 action 做分支（追加期权链 Tab）
文件：`src/App.tsx`
1. 在“添加组件”确认按钮处，保留现有 `finalProps` 组装逻辑（从 configSchema 读取）。
2. 若 `defn.kind === 'action' && defn.id === 'options-chain'`：
   - 调用 `appendOptionsChainTab(finalProps.coinId, finalProps.expiry)`（只追加）
   - 关闭组件库弹窗
   - **不** `navigate`，**不** 修改 `activeOptionsTabId`
3. 其它 widget 仍按原逻辑调用 `addInstance(...)`。

### 3) 期权链页：撤销“专用新增弹窗”作为主入口，改为打开组件库并预选期权链
文件：`src/pages/OptionsChainPage.tsx`
1. 移除/停用 `AddOptionsChainTabModal` 相关 import、state、JSX（它不再作为主入口）。
2. 顶部 “+” 按钮：改为打开组件库弹窗，并预选：
   - category：`options`
   - widgetId：`options-chain`
   - initialConfig：`{ coinId: 当前 active 的 coinId, expiry: 当前 active 的 expiry }`
3. 为此需要一个“跨页面打开组件库并带预选值”的轻量信号通道（推荐放 store）：
   - `openComponentLibrary(preset)` / `closeComponentLibrary()`
   - `componentLibraryPreset`（包含 category/widgetId/initialConfig）
   - 注意：这些 UI 状态不持久化（persist partialize 排除）
4. App 监听 `componentLibraryPreset` 打开组件库，并按 preset 设置：
   - `setIsAddWidgetModalOpen(true)`
   - `setActiveWidgetCategory(preset.category)`
   - `setSelectedWidgetId(preset.widgetId)`
   - `setWidgetConfig(preset.initialConfig)`

### 4) 顶部 Tab UI：underline 滑块 + 悬浮关闭 X（不挤布局）
文件：`src/pages/OptionsChainPage.tsx`
1. 在顶部 tab 容器中新增“underline 滑块”：
   - 使用 `useLayoutEffect` + ref map 获取当前 active tab 的 `offsetLeft/offsetWidth`
   - underline 为 `position:absolute; bottom:0; height:2px;`，用 `left/width` 过渡移动
   - 动效：`transition-[left,width] duration-150 ease-out`（短促干净）
2. 关闭 X（hover 显示，悬浮在文字上方靠右）：
   - 每个 tab 外层 `position:relative`
   - X 为 `position:absolute; right:2px; top:-6px`（或 top + translateY 微调），默认 `opacity:0; pointer-events:none`
   - `group-hover:opacity-100 group-hover:pointer-events-auto`
   - 点击 `stopPropagation`，只关闭 tab 不触发切换
3. 最后一个 tab 不可关闭：
   - UI 层：当 `optionsChainTabs.length === 1` 时不渲染 X
   - store 层：`removeOptionsChainTab` 兜底拒绝删到 0

### 5) 处理遗留文件：AddOptionsChainTabModal
文件：`src/pages/AddOptionsChainTabModal.tsx`
- 保留文件但不再引用（后续你若想彻底删，可单独清理 PR）。
- 可在文件头加 `@deprecated` 注释避免被重新引入。

---

## Assumptions & Decisions
1. 你说的“顶部 tab 条”和“标题行”在实际布局上属于同一块顶部区域（tab + + + X）；本次统一按“顶部 tab 条”实现 underline 与悬浮 X。
2. “通过组件库添加期权链”只做 append，不切换；切换仅由用户点击 tab（或 URL 直达触发 open）产生。
3. 组件库里恢复“期权链”后，它是 **action 入口**，不是一个会被 addInstance 放进工作台网格的 widget。

---

## Verification Steps
1. **组件库恢复期权链**
   - 打开组件库 → 分类「期权」 → 能看到“期权链”
2. **添加只追加不切换**
   - 在 `/options-chain` 页打开组件库，选择“期权链”，配置 coinId/expiry，点“添加组件”
   - 期望：顶部 tab 右侧新增一个 tab；当前 tab 不变；URL 不变
3. **underline 滑块与悬浮 X**
   - 点击不同 tab：underline 在标题下方平滑移动到当前 tab
   - hover tab：X 出现在标题字上方靠右，不挤压布局
4. **至少 1 个 tab**
   - 只剩 1 个 tab 时：X 不显示；即使触发删除也不会删到 0

