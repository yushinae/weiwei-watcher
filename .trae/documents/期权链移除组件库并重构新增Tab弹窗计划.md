## Summary
用户在本地 dev 反复验证后确认：通过“组件库→期权链→添加组件”新增期权链 Tab 的链路始终不稳定（表现为替换当前 Tab/无法稳定追加）。本计划将**彻底移除组件库中的“期权链”入口**，并在 `/options-chain` 页面内实现一个**专用“新增期权链 Tab”弹窗**（符合现有暗色交易终端风格），其新增行为为：**只在标题栏右侧追加新 Tab，不切换、不改 URL**；同时保证页面永远至少存在 1 个期权链 Tab。

---

## Current State Analysis
### 已确认问题与风险点
1) 组件库（AddWidget modal）是全局通道，用于“添加工作台组件”，但期权链 Tab 属于页面内状态；复用同一个组件库通道会引入：
   - 持久化 rehydrate 时序问题（zustand persist）
   - URL ↔ store 同步的副作用
   - 用户体验上“添加组件=替换当前 tab”这种误判/真问题
2) 用户希望“两个入口都试过（顶部添加/期权链页+）仍不行”，因此需要**切断与组件库的耦合**，让期权链 tab 的新增成为页面自管理功能。

### 相关代码位置（便于执行者定位）
- 组件库弹窗 / 添加组件按钮逻辑：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/App.tsx)
- 组件库注册表（WIDGET_REGISTRY）：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/registry/index.tsx)
- 期权链页面 Tab bar 与“+”按钮：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/pages/OptionsChainPage.tsx)
- optionsChainTabs store：  
  [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/store/useWorkspaceStore.ts)

---

## Proposed Changes
> 设计原则（来自 frontend-design）：在现有暗色交易终端风格中，组件的层级、字重、间距、对比要克制一致；交互清晰优先于花哨动画；弹窗/按钮须有明确 hover/focus 状态与可访问标签。

### 1) 移除组件库中的“期权链”入口（彻底切断耦合）
文件：`src/registry/index.tsx`
- 删除 `WIDGET_REGISTRY['options-chain']` 整个配置块（label/preview/configSchema 等）
- 移除其相关 import（例如 `OptionsChainWidget`）
- 结果：组件库列表中不再出现“期权链”，搜索也不应命中。

文件（可选清理）：`src/registry/optionsWidgets.tsx`
- 若 `OptionsChainWidget` 仅用于组件库预览，可删除或保留（保留不影响，但必须确保没有入口引用）。

### 2) App 回归“只负责添加工作台组件”，删除期权链的特殊分支
文件：`src/App.tsx`
- 删除与 `options-chain` 相关的特殊处理分支（曾用于在 `/options-chain` 时走 append tab）
- 若存在 `widgetLibraryRequested` 这类“跨层信号”专为期权链服务，移除相关逻辑（只保留工作台组件添加通道）
- 目标：AddWidget modal 不再承担期权链 tab 管理职责。

### 3) Store：保证“至少一个 tab”的不变量（双保险的底线）
文件：`src/store/useWorkspaceStore.ts`
- `removeOptionsChainTab(id)`：若删除后会导致 `optionsChainTabs.length === 0`，则拒绝删除（return 原 state / return {}）
- 保持 `appendOptionsChainTab` 语义：只追加，不改变 active
- 保持 `openOptionsChainTab` 语义：用于 URL 直达 / 用户点击 tab 切换

> 说明：即使 UI 层做了“最后一个 tab 不显示关闭按钮”，store 仍兜底，防止未来改 UI 或事件冒泡造成空 tab。

### 4) 新增专用弹窗：AddOptionsChainTabModal（页面内新增 Tab 的唯一入口）
新增文件（推荐）：`src/pages/AddOptionsChainTabModal.tsx`

功能与交互（决策已确定，无需执行者再问）：
- 展示形式：居中 modal，风格沿用现有 AddWidget modal（深色、轻边框、圆角、标题字重更高）。
- 表单字段：
  - 标的（coinId）：下拉选择（币本位：`BTC-USD/ETH-USD` 显示 `BTC/ETH`；U 本位显示 `BTC-USDC` 等全称大写）
  - 到期日（expiry）：下拉选择（来源复用 OptionsChainPage 内已有 expiry 列表；若后续扩展可抽常量）
- 操作按钮：
  - 取消：关闭弹窗
  - 添加：调用 `appendOptionsChainTab(coinId, expiry)`，然后关闭弹窗；**不切换、不改 URL**
- 重复添加：
  - 若 store 判定已存在（append no-op），仍直接关闭弹窗（保持“添加但不切换”的一致体验；后续如需 toast 再加）

可访问性（按 web-interface-guidelines）：
- icon-only/关键按钮必须有 `aria-label`
- 所有可交互元素需 `focus-visible` 样式（ring/border）

### 5) OptionsChainPage 改为使用专用弹窗，而非 requestOpenWidgetLibrary
文件：`src/pages/OptionsChainPage.tsx`
- 将两个“+”入口（标题栏右上角、tab bar 右侧）统一改为：`setAddOpen(true)` 打开 `AddOptionsChainTabModal`
- 期权链 tab 新增的唯一逻辑：在 modal 的 onAdd 里调用 `appendOptionsChainTab`
- “关闭 tab”的 UI：
  - 当 `optionsChainTabs.length === 1` 时隐藏/禁用 tab 内的关闭按钮（并可加 title 提示“至少保留一个 Tab”）

（可选增强，但建议做）：
- 追加成功后 tab bar 自动滚到最右，确保用户立即看到新增 tab（减少“没新增”的误判）。

---

## Assumptions & Decisions
- “新增一个期权链页面”在当前架构中等价于“新增一个 OptionsChain Tab”，不是新增 route。
- 用户明确要求：**添加只追加，不切换**；切换必须由用户手动点击 tab（或外部跳转/URL 直达）。
- 组件库是“工作台组件库”，不再承担“页面内 tabs 管理”。

---

## Verification Steps
1) **组件库不再包含期权链**
   - 打开任意入口的组件库，确认列表中不存在“期权链”，搜索也搜不到。
2) **期权链页新增 Tab（只追加不切换）**
   - 进入 `/options-chain?...`，记录当前 active（例如 BTC）
   - 点击期权链页右上角“+”打开新增 Tab 弹窗
   - 选择 ETH + 任意 expiry，点击“添加”
   - 期望：tab 数量 +1，新增 tab 在最右；当前内容仍是 BTC；URL 不变
3) **点击 tab 才切换**
   - 点击新增 tab
   - 期望：内容切换；URL replace 更新为新 tab 的 coin/expiry
4) **至少一个 tab**
   - 当只剩 1 个 tab：UI 不显示/不可用关闭按钮；即便触发删除动作，store 也拒绝删除到 0
5) **刷新恢复**
   - 刷新页面，期望：tabs 与 active 恢复一致，不出现“刷新后跳动/替换感”

