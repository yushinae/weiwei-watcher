## Summary
将“新增期权链 Tab”的交互做减法：**新增时只选标的 coinId，不再选择到期日**；新增 Tab 的 `expiry` 采用“预置列表的最近一档”（列表第一项）；Tab 文案仅显示标的（币本位显示 `BTC/ETH`，U 本位显示 `BTC-USDC` 全称）。同时在**期权链页内标题栏下方**保留/强化“滑块 underline”，清晰提示当前选中的期权链 Tab。

---

## Current State Analysis
### 现状痛点（来自用户反馈）
1) 新增 Tab 时还要选到期日，界面“太多太乱”，尤其是到期日下面那块可调控的内容被认为多余。
2) 新开标签希望“只显示标的”，不要把到期日等信息堆在 Tab 上。
3) 当前页面需要更明确的“我现在在哪个 Tab”的指示（标题栏下方滑块）。

### 相关代码位置（执行时用于定位）
- 组件库期权链 action 定义（含 configSchema）：  
  `src/registry/index.tsx`（`WIDGET_REGISTRY['options-chain']`）
- 组件库点击“添加组件”的动作分支（options-chain → append）：  
  `src/App.tsx`
- 期权链页 URL 解析、expiry 默认值、Tab bar 与 underline 逻辑：  
  `src/pages/OptionsChainPage.tsx`
- store 的 optionsChainTabs 结构与 append/open 行为：  
  `src/store/useWorkspaceStore.ts`

---

## Proposed Changes
> 设计原则（frontend-design）：暗色终端风格下减少噪音；控件数量越少越好；状态指示要“明确且不占空间”；动效只用 opacity/transform 或轻量位置过渡。

### 1) 组件库：期权链 action 只保留 coinId 配置
文件：`src/registry/index.tsx`
- 在 `WIDGET_REGISTRY['options-chain']` 的 `configSchema` 中：
  - **保留** `coinId`
  - **删除** `expiry`
- 期望效果：组件库右侧配置面板不再出现“到期日”的下拉，也不会出现到期日相关的额外调节区。

### 2) 新增 Tab 的 expiry 规则统一：默认 = 预置列表第一项（最近一档）
文件：`src/pages/OptionsChainPage.tsx`
- 将原本组件内的 `deribitExpiries` 列表提升为**组件外导出常量**（例如 `export const DERIBIT_EXPIRIES = [...] as const`）。
- URL 缺省 expiry 改为：
  - `params.get('expiry') ?? DERIBIT_EXPIRIES[0]`
  - 避免当前代码里 hardcode `'08 MAY 26'` 与列表第一项不一致。

文件：`src/App.tsx`
- 在处理 `options-chain(action)` 的分支中：
  - 只读取 `finalProps.coinId`
  - `expiry` 固定取 `DERIBIT_EXPIRIES[0]`
  - 调用：`appendOptionsChainTab(coinId, defaultExpiry)`

### 3) Tab 文案：只显示标的，不显示到期日
文件：`src/pages/OptionsChainPage.tsx`
- 保持/确保 Tab 文案规则为：
  - 币本位：`BTC-USD` → `BTC`（显示 base）
  - U 本位：`BTC-USDC` → `BTC-USDC`（显示全称大写）
- 明确：**Tab 文案不包含 expiry**（无论 nexus/deribit 两种布局）。

### 4) 标题栏下方滑块（underline）强化：在期权链页内清晰标记当前 Tab
文件：`src/pages/OptionsChainPage.tsx`
- 复用现有“underline”实现（基于 `tabScrollRef + tabBtnRefs + useLayoutEffect`）：
  - 确保在期权链页内的顶部 Tab 区域均渲染 underline
  - 切换 Tab 时滑块平滑移动到当前 Tab 下方
  - 横向滚动 Tab 条时滑块位置正确（underline 放在同一个 scroll 容器内）

---

## Assumptions & Decisions
1) “新增 Tab 不选到期日”并不意味着系统不再使用 expiry；只是不再让用户在新增时配置。Tab 内仍保留 expiry 字段用于数据/去重。
2) “默认到期日 = 最近一档”定义为：使用预置列表 `DERIBIT_EXPIRIES` 的第一项（在代码中唯一来源）。
3) “当前页面标题栏下方滑块”指期权链页顶部 Tab 区域（而非全局导航）。

---

## Verification Steps
1) **组件库简化**
   - 打开组件库 → 选择“期权链”
   - 期望：配置区只有“标的(coinId)”一个下拉，不出现到期日与额外调节项
2) **新增只追加、不切换**
   - 在 `/options-chain` 页打开组件库预选“期权链”，只选 coinId，点“添加组件”
   - 期望：右侧新增 Tab；当前视图不切换；URL 不变
3) **默认到期日生效**
   - 点击新追加的 Tab 进行切换
   - 期望：该 Tab 的 expiry 为 `DERIBIT_EXPIRIES[0]`（最近一档）
4) **Tab 文案**
   - `BTC-USD` 显示 `BTC`
   - `BTC-USDC` 显示 `BTC-USDC`
   - 不显示到期日
5) **滑块提示当前 Tab**
   - 切换不同 Tab：underline 在标题栏下方平滑移动到对应 Tab
6) **构建验证**
   - `npm run build` 通过

